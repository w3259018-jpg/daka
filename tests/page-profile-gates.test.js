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
    toast() {},
    async secCheck(value) {
      secChecks.push(value);
      return { safe: true };
    }
  };

  const stubProfileGuard = {
    requireProfile(page) {
      calls.push('requireProfile');
      if (!profileAllowed) page.setData({ showLoginPopup: true });
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
      showToast() {},
      stopPullDownRefresh() {},
      navigateTo(options) {
        navigations.push(plain(options));
      },
      redirectTo(options) {
        navigations.push(plain(options));
      },
      switchTab(options) {
        navigations.push(plain(options));
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
  for (const pageName of ['tasks', 'taskboard', 'create', 'join']) {
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
