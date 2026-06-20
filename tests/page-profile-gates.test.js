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
  const uploads = [];
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
    async upload(filePath) {
      uploads.push(filePath);
      if (uploadImpl) return uploadImpl(filePath);
      return { url: '/uploaded-media' };
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
      showLoading() {},
      hideLoading() {},
      showToast(options) {
        wxToasts.push(plain(options));
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
      }
    },
    setTimeout() {},
    console,
    Date,
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
    uploads,
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
