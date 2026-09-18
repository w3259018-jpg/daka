const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const realProfileGuard = require('../miniprogram/utils/profile-guard');

const plain = value => (
  value === undefined ? undefined : JSON.parse(JSON.stringify(value))
);

const loadPage = (pageName, {
  profileAllowed = true,
  shouldPromptProfileImpl = () => false,
  user = { nickname: 'Alice' },
  guestMode = false,
  requestImpl,
  ensureLoginImpl,
  uploadImpl,
  uploadResult = { url: '/uploaded-media' },
  chooseMessageFileTempFiles = [],
  useRealProfileGuard = false
} = {}) => {
  const pageFile = path.join(
    __dirname,
    `../miniprogram/pages/${pageName}/${pageName}.js`
  );
  let definition;
  const calls = [];
  const requests = [];
  const secChecks = [];
  const navigations = [];
  const modals = [];
  const actionSheets = [];
  const toasts = [];
  const wxToasts = [];
  const clipboardWrites = [];
  const uploads = [];
  const chooseMessageFileCalls = [];
  const showLoadingCalls = [];
  const audioContexts = [];
  let hideLoadingCalls = 0;
  const profileGuardOptions = [];
  const app = { globalData: { user: plain(user), guestMode } };

  const api = {
    async request(url, options) {
      requests.push({ url, options: plain(options) });
      if (requestImpl) return requestImpl(url, options);
      if (url === '/api/me') return plain(user);
      if (url === '/api/tasks') return [];
      if (url.startsWith('/api/tasks/by-code/')) return { id: 7, name: 'Morning' };
      return { id: 7 };
    },
    async ensureLogin() {
      calls.push('ensureLogin');
      if (ensureLoginImpl) return ensureLoginImpl();
    },
    async safe(value, fallback) {
      try {
        return await value;
      } catch (_) {
        return fallback;
      }
    },
    toast(title, icon) {
      toasts.push({ title, icon });
    },
    fullUrl(value) {
      return value;
    },
    async upload(filePath, options = {}) {
      uploads.push({ filePath, options: plain(options) });
      if (uploadImpl) return uploadImpl(filePath, options);
      return plain(uploadResult);
    },
    async secCheck(value) {
      secChecks.push(value);
      return { safe: true };
    }
  };

  const stubProfileGuard = {
    requireProfile(page, options = {}) {
      calls.push('requireProfile');
      profileGuardOptions.push(plain(options));
      if (!profileAllowed && !options.silent) page.setData({ showLoginPopup: true });
      return profileAllowed;
    },
    shouldPromptProfile(profileUser, profileGuestMode) {
      calls.push('shouldPromptProfile');
      return shouldPromptProfileImpl(profileUser, profileGuestMode);
    },
    profilePopupHandlers: {
      onProfileSuccess() {
        this.setData({ showLoginPopup: false });
      },
      onProfileSkip() {
        this.setData({ showLoginPopup: false });
      }
    }
  };
  const profileGuard = useRealProfileGuard ? realProfileGuard : stubProfileGuard;

  vm.runInNewContext(fs.readFileSync(pageFile, 'utf8'), {
    Page(value) {
      definition = value;
    },
    require(id) {
      if (id === '../../utils/api') return api;
      if (id === '../../utils/profile-guard') return profileGuard;
      throw new Error(`Unexpected dependency: ${id}`);
    },
    getApp: () => app,
    wx: {
      showLoading(options) {
        showLoadingCalls.push(plain(options));
      },
      hideLoading() {
        hideLoadingCalls++;
      },
      showToast(options) {
        wxToasts.push(plain(options));
      },
      setClipboardData(options) {
        clipboardWrites.push({ data: options.data });
        if (options.success) options.success();
      },
      stopPullDownRefresh() {},
      navigateTo(options) {
        navigations.push(plain(options));
      },
      redirectTo(options) {
        navigations.push(plain(options));
      },
      switchTab(options) {
        navigations.push(plain(options));
      },
      showModal(options) {
        modals.push(options);
      },
      showActionSheet(options) {
        actionSheets.push(options);
      },
      chooseMessageFile(options) {
        const { success, fail, ...recordedOptions } = options;
        chooseMessageFileCalls.push(plain(recordedOptions));
        success({ tempFiles: plain(chooseMessageFileTempFiles) });
      },
      createInnerAudioContext() {
        const handlers = {};
        const audio = {
          src: '',
          duration: 0,
          currentTime: 0,
          playbackRate: 1,
          destroyed: false,
          playCount: 0,
          pauseCount: 0,
          seekCalls: [],
          onPlay(handler) {
            handlers.play = handler;
          },
          onTimeUpdate(handler) {
            handlers.timeUpdate = handler;
          },
          onCanplay(handler) {
            handlers.canplay = handler;
          },
          onEnded(handler) {
            handlers.ended = handler;
          },
          onError(handler) {
            handlers.error = handler;
          },
          play() {
            this.playCount++;
            if (handlers.play) handlers.play();
          },
          pause() {
            this.pauseCount++;
          },
          seek(position) {
            this.seekCalls.push(position);
            this.currentTime = position;
          },
          destroy() {
            this.destroyed = true;
          },
          triggerCanplay() {
            if (handlers.canplay) handlers.canplay();
          },
          triggerTimeUpdate() {
            if (handlers.timeUpdate) handlers.timeUpdate();
          },
          triggerEnded() {
            if (handlers.ended) handlers.ended();
          },
          triggerError(error) {
            if (handlers.error) handlers.error(error);
          }
        };
        audioContexts.push(audio);
        return audio;
      }
    },
    setTimeout() {},
    console: { log() {}, warn() {}, error() {} },
    Date,
    Buffer,
    Promise,
    encodeURIComponent,
    decodeURIComponent
  }, { filename: pageFile });

  const context = {
    data: plain(definition.data),
    setData(patch) {
      Object.assign(this.data, plain(patch));
    }
  };
  Object.assign(context, definition);
  context.data = plain(definition.data);

  return {
    context,
    definition,
    calls,
    requests,
    secChecks,
    navigations,
    modals,
    actionSheets,
    toasts,
    wxToasts,
    clipboardWrites,
    uploads,
    chooseMessageFileCalls,
    showLoadingCalls,
    audioContexts,
    get hideLoadingCalls() {
      return hideLoadingCalls;
    },
    profileGuardOptions,
    app
  };
};

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const flushPromises = () => new Promise(resolve => setImmediate(resolve));

test('createTask opens profile popup before security check or request', async () => {
  const page = loadPage('create', { profileAllowed: false });
  page.context.data.name = 'Morning routine';

  await page.context.createTask();

  assert.equal(page.context.data.showLoginPopup, true);
  assert.deepEqual(page.secChecks, []);
  assert.deepEqual(page.requests, []);
  assert.deepEqual(page.calls, ['requireProfile']);
});

test('join submit opens profile popup before making a request', async () => {
  const page = loadPage('join', { profileAllowed: false });
  Object.assign(page.context.data, {
    code: 'ABC123',
    taskId: 7,
    realName: 'Alice'
  });

  await page.context.submit();

  assert.equal(page.context.data.showLoginPopup, true);
  assert.deepEqual(page.requests, []);
  assert.deepEqual(page.calls, ['requireProfile']);
});

for (const [pageName, method] of [
  ['tasks', 'openCreate'],
  ['taskboard', 'create']
]) {
  test(`${pageName}.${method} opens profile popup instead of navigating`, () => {
    const page = loadPage(pageName, { profileAllowed: false });

    page.context[method]();

    assert.equal(page.context.data.showLoginPopup, true);
    assert.deepEqual(page.navigations, []);
    assert.deepEqual(page.calls, ['requireProfile']);
  });
}

test('guarded primary flows proceed when the profile guard allows them', async () => {
  const create = loadPage('create');
  create.context.data.name = 'Morning routine';
  await create.context.createTask();
  assert.deepEqual(create.secChecks, ['Morning routine']);
  assert.equal(create.requests[0].url, '/api/tasks');

  const join = loadPage('join');
  Object.assign(join.context.data, {
    code: 'ABC123',
    taskId: 7,
    realName: 'Alice'
  });
  await join.context.submit();
  assert.equal(join.requests[0].url, '/api/tasks/join');
  assert.deepEqual(join.requests[0].options.data, {
    invite_code: 'ABC123',
    real_name: 'Alice',
    gender: '男'
  });

  const tasks = loadPage('tasks');
  tasks.context.openCreate();
  assert.deepEqual(tasks.navigations, [{ url: '/pages/create/create' }]);

  const taskboard = loadPage('taskboard');
  taskboard.context.create();
  assert.deepEqual(taskboard.navigations, [{ url: '/pages/create/create' }]);
});

test('records.exportNotes opens the profile popup before validation or export request', async () => {
  const page = loadPage('records', { profileAllowed: false });

  await page.context.exportNotes();

  assert.equal(page.context.data.showLoginPopup, true);
  assert.deepEqual(page.requests, []);
  assert.deepEqual(page.toasts, []);
  assert.deepEqual(page.calls, ['requireProfile']);
});

test('records.exportNotes copies decoded export content instead of a file path', async () => {
  const content = '# 打卡导出\n\n打卡任务名称：Morning\n';
  const page = loadPage('records', {
    requestImpl(url) {
      if (url === '/api/tasks/7/export') {
        return { content_base64: Buffer.from(content, 'utf8').toString('base64') };
      }
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  page.context.data.taskId = 7;

  await page.context.exportNotes();

  assert.deepEqual(page.clipboardWrites, [{ data: content }]);
  assert.equal(page.toasts.at(-1).title, '导出内容已复制');
});

test('task.exportAdminData copies decoded admin export content instead of a file path', async () => {
  const content = '任务\t成员\t打卡内容\t打卡日期\t打卡心得\nMorning\tAlice\tDay1\t2026/7/1\tDone';
  const page = loadPage('task', {
    requestImpl(url) {
      if (url === '/api/tasks/7/admin-export') {
        return { content_base64: Buffer.from(content, 'utf8').toString('base64') };
      }
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  page.context.data.id = 7;

  await page.context.exportAdminData();

  assert.deepEqual(page.clipboardWrites, [{ data: content }]);
  assert.equal(page.toasts.at(-1).title, '导出内容已复制');
});

test('item.submit opens the profile popup before validation, security check, or request', async () => {
  const page = loadPage('item', { profileAllowed: false });

  await page.context.submit();

  assert.equal(page.context.data.showLoginPopup, true);
  assert.deepEqual(page.requests, []);
  assert.deepEqual(page.secChecks, []);
  assert.deepEqual(page.toasts, []);
  assert.deepEqual(page.calls, ['requireProfile']);
});

test('item.markWatched silently skips the write while playback remains available', async () => {
  const page = loadPage('item', { profileAllowed: false });
  let playCount = 0;
  page.context._audio = { play() { playCount++; } };

  page.context.playAudio();
  await page.context.markWatched();

  assert.equal(playCount, 1);
  assert.equal(page.context.data.showLoginPopup, false);
  assert.deepEqual(page.requests, []);
  assert.deepEqual(page.toasts, []);
  assert.deepEqual(page.wxToasts, []);
  assert.deepEqual(page.calls, ['requireProfile']);
  assert.deepEqual(page.profileGuardOptions, [{ silent: true }]);
});

for (const method of ['publish', 'exportAdminData', 'setRole', 'removeMember', 'dissolve']) {
  test(`task.${method} opens the profile popup before validation, modal, or request`, async () => {
    const page = loadPage('task', { profileAllowed: false });
    Object.assign(page.context.data, {
      id: 7,
      title: 'New item',
      mediaUrl: '/uploaded-media'
    });
    const event = { currentTarget: { dataset: { uid: 9, role: 'admin' } } };

    await page.context[method](event);

    assert.equal(page.context.data.showLoginPopup, true);
    assert.deepEqual(page.requests, []);
    assert.deepEqual(page.secChecks, []);
    assert.deepEqual(page.modals, []);
    assert.deepEqual(page.calls, ['requireProfile']);
  });
}

test('task.chooseMedia blocks the picker and upload for an incomplete profile', () => {
  const page = loadPage('task', { profileAllowed: false });

  page.context.chooseMedia();

  assert.equal(page.context.data.showLoginPopup, true);
  assert.deepEqual(page.actionSheets, []);
  assert.deepEqual(page.uploads, []);
  assert.deepEqual(page.calls, ['requireProfile']);
});

for (const scenario of [
  {
    name: 'audio',
    mtIdx: 0,
    fileName: 'voice.mp3',
    expectedPickerOptions: {
      count: 1,
      type: 'file',
      extension: ['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg']
    }
  },
  {
    name: 'video',
    mtIdx: 1,
    fileName: 'lesson.mp4',
    expectedPickerOptions: {
      count: 1,
      type: 'video'
    }
  }
]) {
  test(`task.chooseMedia uploads the selected ${scenario.name} with its original filename`, async () => {
    const page = loadPage('task', {
      chooseMessageFileTempFiles: [{
        path: 'wxfile://tmp/no-extension',
        name: scenario.fileName
      }]
    });
    page.context.data.mtIdx = scenario.mtIdx;

    page.context.chooseMedia();

    assert.equal(page.actionSheets.length, 1);
    assert.deepEqual(plain(page.actionSheets[0].itemList), ['从微信聊天中选择']);

    page.actionSheets[0].success({ tapIndex: 0 });
    await flushPromises();

    assert.deepEqual(page.chooseMessageFileCalls, [scenario.expectedPickerOptions]);
    assert.deepEqual(page.uploads, [{
      filePath: 'wxfile://tmp/no-extension',
      options: { originalName: scenario.fileName }
    }]);
  });
}

for (const scenario of [
  { result: { err: 'unsupported' }, expectedToast: 'unsupported' },
  { result: {}, expectedToast: '上传失败' }
]) {
  test(`task.chooseMedia rejects an upload result without a URL: ${scenario.expectedToast}`, async () => {
    const page = loadPage('task', {
      uploadResult: scenario.result,
      chooseMessageFileTempFiles: [{
        path: 'wxfile://tmp/no-extension',
        name: 'voice.mp3'
      }]
    });

    page.context.chooseMedia();
    page.actionSheets[0].success({ tapIndex: 0 });
    await flushPromises();

    assert.equal(page.context.data.mediaUrl, '');
    assert.equal(page.context.data.mediaFileName, '');
    assert.deepEqual(page.toasts, [{ title: scenario.expectedToast, icon: undefined }]);
    assert.equal(page.hideLoadingCalls, 1);
  });
}

test('task.uploadPickedMedia keeps loading visible until all concurrent uploads settle', async () => {
  const pendingUploads = [deferred(), deferred()];
  let uploadIndex = 0;
  const page = loadPage('task', {
    uploadImpl: () => pendingUploads[uploadIndex++].promise
  });

  const uploadA = page.context.uploadPickedMedia({ filePath: 'wxfile://tmp/a', name: 'a.mp3' });
  const uploadB = page.context.uploadPickedMedia({ filePath: 'wxfile://tmp/b', name: 'b.mp3' });

  assert.equal(page.showLoadingCalls.length, 2);
  assert.equal(page.hideLoadingCalls, 0);

  pendingUploads[0].resolve({ url: '/a.mp3' });
  await uploadA;
  assert.equal(page.hideLoadingCalls, 0);

  pendingUploads[1].resolve({ url: '/b.mp3' });
  await uploadB;
  assert.equal(page.hideLoadingCalls, 1);
});

test('task.pickMt ignores completion from an upload started for the previous media type', async () => {
  const pendingUpload = deferred();
  const page = loadPage('task', {
    uploadImpl: () => pendingUpload.promise,
    chooseMessageFileTempFiles: [{
      path: 'wxfile://tmp/no-extension',
      name: 'voice.mp3'
    }]
  });

  page.context.chooseMedia();
  page.actionSheets[0].success({ tapIndex: 0 });
  await flushPromises();
  assert.equal(page.uploads.length, 1);

  page.context.pickMt({ detail: { value: '1' } });
  pendingUpload.resolve({ url: '/stale-audio.mp3' });
  await flushPromises();

  assert.equal(page.context.data.mtIdx, 1);
  assert.equal(page.context.data.mediaUrl, '');
  assert.equal(page.context.data.mediaFileName, '');
  assert.deepEqual(page.toasts, []);
});

test('task.pickMt ignores rejection from an upload started for the previous media type', async () => {
  const pendingUpload = deferred();
  const page = loadPage('task', {
    uploadImpl: () => pendingUpload.promise
  });

  const uploading = page.context.uploadPickedMedia({
    filePath: 'wxfile://tmp/no-extension',
    name: 'voice.mp3'
  });
  page.context.pickMt({ detail: { value: '1' } });
  pendingUpload.reject({ err: 'stale failure' });
  await uploading;

  assert.equal(page.context.data.mediaUrl, '');
  assert.equal(page.context.data.mediaFileName, '');
  assert.deepEqual(page.toasts, []);
});

test('task.publish invalidates the prior upload version before resetting media fields', async () => {
  const page = loadPage('task');
  Object.assign(page.context.data, {
    id: 7,
    title: 'Existing item',
    mediaUrl: '/existing.mp3',
    mediaFileName: 'existing.mp3'
  });
  page.context._mediaUploadVersion = 1;
  page.context.load = async () => {};

  await page.context.publish();

  assert.equal(page.context._mediaUploadVersion, 2);
  assert.equal(page.context.data.mediaUrl, '');
  assert.equal(page.context.data.mediaFileName, '');
  assert.deepEqual(page.toasts, [{ title: '已发布', icon: 'success' }]);
});

test('task.publish waits for an active media upload before validation or loading', async () => {
  const page = loadPage('task');
  page.context._activeMediaUploads = 1;
  Object.assign(page.context.data, {
    id: 7,
    title: 'New item',
    mediaUrl: '/existing.mp3'
  });

  await page.context.publish();

  assert.deepEqual(page.toasts, [{ title: '文件上传中，请稍候', icon: undefined }]);
  assert.deepEqual(page.secChecks, []);
  assert.deepEqual(page.requests, []);
  assert.deepEqual(page.showLoadingCalls, []);
});

test('item.setupAudio reports audio playback load errors', () => {
  const page = loadPage('item');

  page.context.setupAudio('/media/voice.mp3');
  page.audioContexts[0].triggerError({ errMsg: 'MEDIA_ERR_SRC_NOT_SUPPORTED' });

  assert.deepEqual(page.toasts, [{ title: '音频加载失败，请检查网络或文件格式', icon: undefined }]);
});

test('item audio progress follows playback and seeks when dragged', () => {
  const page = loadPage('item');

  page.context.setupAudio('/media/voice.mp3');
  const audio = page.audioContexts[0];
  audio.duration = 125;
  audio.currentTime = 25;
  audio.triggerCanplay();
  audio.triggerTimeUpdate();

  assert.equal(page.context.data.audioDuration, 125);
  assert.equal(page.context.data.audioCurrent, 25);
  assert.equal(page.context.data.audioProgress, 20);
  assert.equal(page.context.data.audioCurrentText, '00:25');
  assert.equal(page.context.data.audioDurationText, '02:05');

  assert.equal(typeof page.context.onAudioProgressChanging, 'function');
  assert.equal(typeof page.context.onAudioProgressChange, 'function');
  page.context.onAudioProgressChanging({ detail: { value: 40 } });
  page.context.onAudioProgressChange({ detail: { value: 40 } });

  assert.deepEqual(audio.seekCalls, [50]);
  assert.equal(page.context.data.audioCurrent, 50);
  assert.equal(page.context.data.audioProgress, 40);
  assert.equal(page.context.data.audioCurrentText, '00:50');
});

test('item audio speed picker updates the playback rate', () => {
  const page = loadPage('item');

  page.context.setupAudio('/media/voice.mp3');
  assert.deepEqual(page.context.data.audioSpeedOptions, [0.5, 1, 1.25, 1.5, 2]);
  assert.equal(page.audioContexts[0].playbackRate, 1);

  assert.equal(typeof page.context.setAudioPlaybackRate, 'function');
  page.context.setAudioPlaybackRate({ currentTarget: { dataset: { rate: '1.5' } } });

  assert.equal(page.context.data.audioPlaybackRate, 1.5);
  assert.equal(page.audioContexts[0].playbackRate, 1.5);
});

test('item.onVideoError reports video playback load errors', () => {
  const page = loadPage('item');

  page.context.onVideoError({ detail: { errMsg: 'MEDIA_ERR_SRC_NOT_SUPPORTED' } });

  assert.deepEqual(page.toasts, [{ title: '视频加载失败，请检查网络或文件格式', icon: undefined }]);
});

test('item page binds video playback errors to the page handler', () => {
  const source = fs.readFileSync(path.join(
    __dirname,
    '../miniprogram/pages/item/item.wxml'
  ), 'utf8');

  assert.match(source, /<video\b[^>]*\bbinderror="onVideoError"/);
});

test('newly guarded actions proceed when the profile guard allows them', async () => {
  const records = loadPage('records');
  records.context.data.taskId = 7;
  await records.context.exportNotes();
  assert.equal(records.requests[0].url, '/api/tasks/7/export');

  const item = loadPage('item');
  Object.assign(item.context.data, { id: 3, watched: true, note: 'Finished it' });
  await item.context.submit();
  assert.deepEqual(item.secChecks, ['Finished it']);
  assert.equal(item.requests[0].url, '/api/items/3/submit');

  const task = loadPage('task');
  Object.assign(task.context.data, { id: 7, title: 'New item', mediaUrl: '/media.mp3' });
  task.context.load = async () => {};
  await task.context.publish();
  assert.deepEqual(task.secChecks, ['New item']);
  assert.equal(task.requests[0].url, '/api/tasks/7/items');

  const admin = loadPage('task');
  admin.context.data.id = 7;
  admin.context.load = async () => {};
  await admin.context.setRole({ currentTarget: { dataset: { uid: 9, role: 'admin' } } });
  assert.equal(admin.requests[0].url, '/api/tasks/7/members/9/role');

  const picker = loadPage('task');
  picker.context.chooseMedia();
  assert.equal(picker.actionSheets.length, 1);
});

for (const scenario of [
  { name: 'incomplete user', user: {}, guestMode: false, prompt: true },
  { name: 'guest', user: {}, guestMode: true, prompt: false },
  { name: 'completed user', user: { nickname: 'Alice' }, guestMode: false, prompt: false }
]) {
  test(`tasks.onShow initializes profile popup for ${scenario.name} before task loading`, async () => {
    const promptArgs = [];
    const page = loadPage('tasks', {
      user: scenario.user,
      guestMode: scenario.guestMode,
      shouldPromptProfileImpl(profileUser, profileGuestMode) {
        promptArgs.push([plain(profileUser), profileGuestMode]);
        return scenario.prompt;
      }
    });
    page.context.load = async () => {
      page.calls.push('load');
    };

    await page.context.onShow();

    assert.equal(page.context.data.showLoginPopup, scenario.prompt);
    assert.deepEqual(page.calls, ['ensureLogin', 'shouldPromptProfile', 'load']);
    assert.deepEqual(promptArgs, [[scenario.user, scenario.guestMode]]);
  });
}

test('tasks.onShow exposes the completed global profile before pending API loading finishes', async t => {
  const login = deferred();
  const me = deferred();
  const tasksRequest = deferred();
  const page = loadPage('tasks', {
    user: { id: 7, nickname: 'Alice' },
    ensureLoginImpl: () => login.promise,
    requestImpl(url) {
      if (url === '/api/me') return me.promise;
      if (url === '/api/tasks') return tasksRequest.promise;
      throw new Error(`Unexpected request: ${url}`);
    },
    useRealProfileGuard: true
  });
  const previousGetApp = global.getApp;
  const previousWx = global.wx;
  global.getApp = () => page.app;
  global.wx = { showToast() {} };
  t.after(() => {
    global.getApp = previousGetApp;
    global.wx = previousWx;
  });

  const showing = page.context.onShow();
  login.resolve();
  await flushPromises();

  assert.equal(page.context.data.user.nickname, 'Alice');
  assert.equal(page.context.data.showLoginPopup, false);
  page.context.openCreate();
  assert.deepEqual(page.navigations, [{ url: '/pages/create/create' }]);

  me.resolve({ id: 7, nickname: 'Alice' });
  tasksRequest.resolve([]);
  await showing;
});

test('pending tasks load preserves a newer profile while accepting missing server fields', async t => {
  const me = deferred();
  const tasksRequest = deferred();
  const page = loadPage('tasks', {
    user: { id: 7 },
    requestImpl(url) {
      if (url === '/api/me') return me.promise;
      if (url === '/api/tasks') return tasksRequest.promise;
      throw new Error(`Unexpected request: ${url}`);
    },
    useRealProfileGuard: true
  });
  const previousGetApp = global.getApp;
  const previousWx = global.wx;
  global.getApp = () => page.app;
  global.wx = { showToast() {} };
  t.after(() => {
    global.getApp = previousGetApp;
    global.wx = previousWx;
  });

  const showing = page.context.onShow();
  await flushPromises();
  const savedUser = { id: 7, nickname: 'New nickname' };
  page.app.globalData.user = savedUser;
  page.context.onProfileSuccess({ detail: { user: savedUser } });

  me.resolve({ id: 7, nickname: 'Stale nickname', avatar: '/server.png' });
  tasksRequest.resolve([]);
  await showing;

  assert.deepEqual(page.context.data.user, {
    id: 7,
    nickname: 'New nickname',
    avatar: '/server.png'
  });
  assert.deepEqual(plain(page.app.globalData.user), page.context.data.user);
  assert.equal(page.context.data.showLoginPopup, false);
});

test('join page does not ask new users for age', () => {
  const source = fs.readFileSync(path.join(
    __dirname,
    '../miniprogram/pages/join/join.wxml'
  ), 'utf8');

  assert.doesNotMatch(source, /placeholder="年龄"/);
  assert.doesNotMatch(source, /data-k="age"/);
  assert.doesNotMatch(source, /value="\{\{age\}\}"/);
});

test('tasks load replaces unchanged incomplete cache with a completed server profile', async t => {
  const me = deferred();
  const tasksRequest = deferred();
  const page = loadPage('tasks', {
    user: { id: 7, avatar: '/cached.png', role: 'member' },
    requestImpl(url) {
      if (url === '/api/me') return me.promise;
      if (url === '/api/tasks') return tasksRequest.promise;
      throw new Error(`Unexpected request: ${url}`);
    },
    useRealProfileGuard: true
  });
  const previousGetApp = global.getApp;
  const previousWx = global.wx;
  global.getApp = () => page.app;
  global.wx = { showToast() {} };
  t.after(() => {
    global.getApp = previousGetApp;
    global.wx = previousWx;
  });

  const showing = page.context.onShow();
  await flushPromises();
  assert.equal(page.context.data.showLoginPopup, true);

  me.resolve({ id: 7, nickname: 'Server nickname', avatar: '/server.png' });
  tasksRequest.resolve([]);
  await showing;

  assert.deepEqual(page.context.data.user, {
    id: 7,
    avatar: '/server.png',
    role: 'member',
    nickname: 'Server nickname'
  });
  assert.deepEqual(plain(page.app.globalData.user), page.context.data.user);
  assert.equal(page.context.data.showLoginPopup, false);
});

test('all gated pages render the global login popup bindings', () => {
  for (const pageName of ['tasks', 'taskboard', 'create', 'join', 'records', 'item', 'task']) {
    const source = fs.readFileSync(path.join(
      __dirname,
      `../miniprogram/pages/${pageName}/${pageName}.wxml`
    ), 'utf8');
    const tag = source.match(/<login-popup\b[^>]*\/>/);
    assert.ok(tag, `${pageName} should render login-popup`);
    assert.match(tag[0], /\bshow="\{\{showLoginPopup\}\}"/);
    assert.match(tag[0], /\bbind:profilesuccess="onProfileSuccess"/);
    assert.match(tag[0], /\bbind:skipsuccess="onProfileSkip"/);
  }
});
