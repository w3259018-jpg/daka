// 文件存储抽象：disk 用本地磁盘（开发期），cos 用腾讯云对象存储（生产）
//
// 切换：环境变量 STORAGE_DRIVER=cos 时启用 COS。COS 必填环境变量：
//   COS_SECRET_ID    腾讯云 API 密钥
//   COS_SECRET_KEY   腾讯云 API 密钥
//   COS_BUCKET       桶名 例：daka-prod-1300000000
//   COS_REGION       例：ap-shanghai / ap-guangzhou
//   COS_PUBLIC_HOST  访问域名，可选；不填会用 https://{bucket}.cos.{region}.myqcloud.com
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const cryptoJs = require('crypto');
const { mimeFromName } = require('./media-metadata');

const DRIVER = (process.env.STORAGE_DRIVER || 'cos').toLowerCase();
const UP_DIR = path.join(__dirname, 'uploads');

const extOf = (name = '', mime = '') => {
  const e = path.extname(name).toLowerCase();
  if (e) return e;
  if (mime.includes('mp4'))  return '.mp4';
  if (mime.includes('mpeg')) return '.mp3';
  if (mime.includes('jpeg')) return '.jpg';
  if (mime.includes('png'))  return '.png';
  if (mime.includes('markdown')) return '.md';
  return '';
};

const makeKey = (originalName, mime) => {
  const ts = Date.now();
  const rand = crypto.randomBytes(6).toString('hex');
  return `${ts}_${rand}${extOf(originalName, mime)}`;
};

const publicMediaPath = (key) => `/media/${encodeURIComponent(key)}`;

const safeKey = (key) => {
  const normalized = path.basename(String(key || ''));
  if (!normalized || normalized !== key) throw new Error('invalid media key');
  return normalized;
};

const parseRange = (rangeHeader, size) => {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader || ''));
  if (!match) return null;
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= size) {
    return null;
  }
  return { start, end };
};

// COS 签名算法（V5 版本）
const getCosAuth = (method, key, secretId, secretKey, bucket, region) => {
  const host = `${bucket}.cos.${region}.myqcloud.com`;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600; // 1小时有效期
  const keyTime = `${now};${exp}`;
  
  // SignKey
  const signKey = cryptoJs.createHmac('sha1', secretKey).update(keyTime).digest('hex');
  
  // HttpString
  const httpString = `${method.toLowerCase()}\n/${key}\n\nhost=${host}\n`;
  const sha1HttpString = cryptoJs.createHash('sha1').update(httpString).digest('hex');
  
  // StringToSign
  const stringToSign = `sha1\n${keyTime}\n${sha1HttpString}\n`;
  
  // Signature
  const signature = cryptoJs.createHmac('sha1', signKey).update(stringToSign).digest('hex');
  
  // Authorization
  const auth = `q-sign-algorithm=sha1&q-ak=${secretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=host&q-url-param-list=&q-signature=${signature}`;
  
  return auth;
};

let driver;
if (DRIVER === 'cos') {
  const secretId = process.env.COS_SECRET_ID;
  const secretKey = process.env.COS_SECRET_KEY;
  const bucket = process.env.COS_BUCKET;
  const region = process.env.COS_REGION;
  const publicHost = (process.env.COS_PUBLIC_HOST || `https://${bucket}.cos.${region}.myqcloud.com`).replace(/\/+$/, '');

  if (!secretId || !secretKey || !bucket || !region) {
    throw new Error('[storage] STORAGE_DRIVER=cos but missing required COS_* environment variables');
  }

  const put = async (buffer, originalName, mime, fixedKey) => {
    const Key = fixedKey || makeKey(originalName, mime);
    const url = `https://${bucket}.cos.${region}.myqcloud.com/${Key}`;
    
    try {
      const auth = getCosAuth('PUT', Key, secretId, secretKey, bucket, region);
      
      await axios.put(url, buffer, {
        headers: {
          'Authorization': auth,
          'Content-Type': mime || 'application/octet-stream',
          'Host': `${bucket}.cos.${region}.myqcloud.com`
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });
      
      return publicMediaPath(Key);
    } catch (err) {
      console.error('[storage] COS上传失败:', err.response?.data || err.message);
      throw new Error('COS上传失败');
    }
  };

  const get = async (key, range) => {
    const Key = safeKey(key);
    const url = `https://${bucket}.cos.${region}.myqcloud.com/${Key}`;
    const auth = getCosAuth('GET', Key, secretId, secretKey, bucket, region);
    const headers = {
      Authorization: auth,
      Host: `${bucket}.cos.${region}.myqcloud.com`,
      ...(range && { Range: range })
    };
    const response = await axios.get(url, {
      headers,
      responseType: 'stream',
      validateStatus: status => (status >= 200 && status < 300) || status === 206
    });
    return {
      status: response.status,
      headers: response.headers,
      stream: response.data
    };
  };

  driver = { mode: 'cos', put, get };
} else {
  if (DRIVER !== 'disk') {
    throw new Error(`[storage] unsupported STORAGE_DRIVER=${DRIVER}`);
  }
  fs.mkdirSync(UP_DIR, { recursive: true });
  const put = async (buffer, originalName, mime, fixedKey) => {
    const Key = fixedKey || makeKey(originalName, mime);
    fs.writeFileSync(path.join(UP_DIR, Key), buffer);
    return publicMediaPath(Key);
  };
  const get = async (key, range) => {
    const Key = safeKey(key);
    const file = path.join(UP_DIR, Key);
    const stat = fs.statSync(file);
    const parsedRange = range ? parseRange(range, stat.size) : null;
    if (range && !parsedRange) {
      return {
        status: 416,
        headers: { 'content-range': `bytes */${stat.size}` },
        stream: null
      };
    }
    const stream = parsedRange
      ? fs.createReadStream(file, { start: parsedRange.start, end: parsedRange.end })
      : fs.createReadStream(file);
    return {
      status: parsedRange ? 206 : 200,
      headers: {
        'content-type': mimeFromName(Key),
        'accept-ranges': 'bytes',
        'content-length': parsedRange ? parsedRange.end - parsedRange.start + 1 : stat.size,
        ...(parsedRange && { 'content-range': `bytes ${parsedRange.start}-${parsedRange.end}/${stat.size}` })
      },
      stream
    };
  };
  driver = { mode: 'disk', dir: UP_DIR, put, get };
}

console.log('[storage] driver=' + driver.mode);
module.exports = driver;
