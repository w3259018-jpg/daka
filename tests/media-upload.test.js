const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const apiFile = path.join(__dirname, '../miniprogram/utils/api.js');
const metadataFile = path.join(__dirname, '../server/media-metadata.js');
const { normalizeMediaMetadata } = require(metadataFile);

const plain = value => JSON.parse(JSON.stringify(value));

const loadMediaMetadataWithPath = pathImpl => {
  const module = { exports: {} };

  vm.runInNewContext(fs.readFileSync(metadataFile, 'utf8'), {
    module,
    require(id) {
      if (id === 'node:path') return pathImpl;
      throw new Error(`Unexpected dependency: ${id}`);
    }
  }, { filename: metadataFile });

  return module.exports;
};

const loadApi = () => {
  let uploadOptions;
  const module = { exports: {} };

  vm.runInNewContext(fs.readFileSync(apiFile, 'utf8'), {
    getApp: () => ({
      globalData: {
        apiBase: 'https://example.test',
        token: 'token',
        useCloud: true
      }
    }),
    module,
    wx: {
      cloud: {
        uploadFile(options) {
          uploadOptions = options;
          options.success({ fileID: 'cloud://env/uploads/123_lesson.mp4' });
        }
      }
    }
  }, { filename: apiFile });

  return {
    api: module.exports,
    getUploadOptions: () => uploadOptions
  };
};

const loadStorage = ({ env = {}, axiosImpl } = {}) => {
  const module = { exports: {} };
  const putCalls = [];
  const getCalls = [];
  const axios = axiosImpl || {
    async put(url, buffer, options) {
      putCalls.push({ url, buffer, options });
    },
    async get(url, options) {
      getCalls.push({ url, options });
      return {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-range': 'bytes 0-1/2',
          'content-length': '2'
        },
        data: 'stream'
      };
    }
  };
  const crypto = {
    randomBytes() {
      return Buffer.from('abcdef');
    },
    createHmac() {
      return {
        update() { return this; },
        digest() { return 'signature'; }
      };
    },
    createHash() {
      return {
        update() { return this; },
        digest() { return 'hash'; }
      };
    }
  };

  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server/storage.js'), 'utf8'), {
    module,
    console: { log() {}, warn() {}, error() {} },
    Buffer,
    __dirname: path.join(__dirname, '../server'),
    Date: { now: () => 123 },
    process: {
      env: {
        STORAGE_DRIVER: 'cos',
        COS_SECRET_ID: 'sid',
        COS_SECRET_KEY: 'skey',
        COS_BUCKET: 'bucket-123',
        COS_REGION: 'ap-guangzhou',
        ...env
      }
    },
    require(id) {
      if (id === 'fs') return {
        mkdirSync() {},
        writeFileSync() {},
        statSync() { return { size: 2 }; },
        createReadStream() { return 'disk-stream'; }
      };
      if (id === 'path') return path;
      if (id === 'crypto') return crypto;
      if (id === 'axios') return axios;
      if (id === './media-metadata') return { mimeFromName: name => (
        path.extname(name).toLowerCase() === '.mp4' ? 'video/mp4' : 'application/octet-stream'
      ) };
      throw new Error(`Unexpected dependency: ${id}`);
    }
  }, { filename: path.join(__dirname, '../server/storage.js') });

  return { storage: module.exports, putCalls, getCalls };
};

test('upload sends media to cloud storage using the original file extension', async () => {
  const { api, getUploadOptions } = loadApi();

  await api.upload('wxfile://tmp/no-extension', { originalName: 'lesson.mp4' });

  const options = getUploadOptions();
  assert.equal(options.filePath, 'wxfile://tmp/no-extension');
  assert.match(options.cloudPath, /^uploads\/\d+_[a-f0-9]+\.mp4$/);
});

test('upload can use the selected file path when no original name is provided', async () => {
  const { api, getUploadOptions } = loadApi();

  await api.upload('wxfile://tmp/voice.m4a');

  assert.equal(getUploadOptions().filePath, 'wxfile://tmp/voice.m4a');
  assert.match(getUploadOptions().cloudPath, /^uploads\/\d+_[a-f0-9]+\.m4a$/);
});

test('normalizes an MP4 basename and infers its MIME type', () => {
  assert.deepEqual(
    normalizeMediaMetadata('../lesson.mp4', 'application/octet-stream'),
    { originalName: 'lesson.mp4', mime: 'video/mp4' }
  );
});

test('infers MPEG audio MIME from an MP3 filename', () => {
  assert.deepEqual(
    normalizeMediaMetadata('voice.mp3', 'application/octet-stream'),
    { originalName: 'voice.mp3', mime: 'audio/mpeg' }
  );
});

test('preserves an explicit MIME type', () => {
  assert.deepEqual(
    normalizeMediaMetadata('clip.mp4', 'video/custom'),
    { originalName: 'clip.mp4', mime: 'video/custom' }
  );
});

test('strips Windows path segments under POSIX path semantics', () => {
  const posixMetadata = loadMediaMetadataWithPath(path.posix);

  assert.deepEqual(
    plain(posixMetadata.normalizeMediaMetadata('..\\evil.mp4', 'application/octet-stream')),
    { originalName: 'evil.mp4', mime: 'video/mp4' }
  );
});

for (const genericMime of [
  'Application/Octet-Stream',
  ' Application/Octet-Stream; charset=binary '
]) {
  test(`infers media MIME for generic MIME variant: ${genericMime}`, () => {
    assert.deepEqual(
      normalizeMediaMetadata('lesson.mp4', genericMime),
      { originalName: 'lesson.mp4', mime: 'video/mp4' }
    );
  });
}

test('covers every supported media extension mapping', () => {
  const expectedByExtension = {
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    wav: 'audio/wav',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    m4v: 'video/x-m4v',
    avi: 'video/x-msvideo',
    wmv: 'video/x-ms-wmv',
    mkv: 'video/x-matroska',
    webm: 'video/webm'
  };

  for (const [extension, mime] of Object.entries(expectedByExtension)) {
    assert.deepEqual(
      normalizeMediaMetadata(`media.${extension}`, undefined),
      { originalName: `media.${extension}`, mime },
      extension
    );
  }
});

test('falls back to application/octet-stream for an unknown extension and missing MIME', () => {
  assert.deepEqual(
    normalizeMediaMetadata('archive.bin', undefined),
    { originalName: 'archive.bin', mime: 'application/octet-stream' }
  );
});

test('COS storage returns app-relative media URLs instead of raw COS domains', async () => {
  const { storage } = loadStorage();

  const url = await storage.put(Buffer.from('media'), 'lesson.mp4', 'video/mp4');

  assert.equal(url, '/media/123_616263646566.mp4');
});

test('COS storage can stream media with Range forwarded for mini-program playback', async () => {
  const { storage, getCalls } = loadStorage();

  const result = await storage.get('123_616263646566.mp4', 'bytes=0-1');

  assert.equal(result.status, 206);
  assert.equal(result.headers['content-type'], 'video/mp4');
  assert.equal(result.stream, 'stream');
  assert.equal(getCalls[0].options.headers.Range, 'bytes=0-1');
});
