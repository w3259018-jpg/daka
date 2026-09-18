const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  completeProfile: realCompleteProfile
} = require('../miniprogram/utils/profile-guard');

const componentFile = path.join(
  __dirname,
  '../miniprogram/components/login-popup/login-popup.js'
);
const wxmlFile = path.join(
  __dirname,
  '../miniprogram/components/login-popup/login-popup.wxml'
);
const wxmlSource = fs.readFileSync(wxmlFile, 'utf8');
const wxssFile = path.join(
  __dirname,
  '../miniprogram/components/login-popup/login-popup.wxss'
);
const wxssSource = fs.readFileSync(wxssFile, 'utf8');

const plain = value => (
  value === undefined ? undefined : JSON.parse(JSON.stringify(value))
);

const loadComponent = ({
  requestImpl,
  completeProfileImpl,
  setGuestModeImpl,
  triggerEventImpl
} = {}) => {
  let definition;
  const events = [];
  const requests = [];
  const navigations = [];
  const toasts = [];
  const guardCalls = {
    completedUsers: [],
    guestModes: []
  };

  const request = async (url, options) => {
    requests.push({ url, options: plain(options) });
    if (requestImpl) return requestImpl(url, options);
    return { id: 7, nickname: options.data.nickname };
  };

  const profileGuard = {
    createFallbackNickname: () => '自在用户1000',
    completeProfile(user) {
      guardCalls.completedUsers.push(plain(user));
      if (completeProfileImpl) return completeProfileImpl(user);
      return { ...user, cached: true };
    },
    setGuestMode(enabled) {
      guardCalls.guestModes.push(enabled);
      if (setGuestModeImpl) return setGuestModeImpl(enabled);
    }
  };

  vm.runInNewContext(fs.readFileSync(componentFile, 'utf8'), {
    Component(value) {
      definition = value;
    },
    require(id) {
      if (id === '../../utils/api') return { request };
      if (id === '../../utils/profile-guard') return profileGuard;
      throw new Error(`Unexpected dependency: ${id}`);
    },
    wx: {
      navigateTo(options) {
        navigations.push(plain(options));
      },
      showToast(options) {
        toasts.push(plain(options));
      }
    }
  }, { filename: componentFile });

  const context = {
    data: plain(definition.data),
    setData(patch) {
      Object.assign(this.data, plain(patch));
    },
    triggerEvent(name, detail) {
      if (triggerEventImpl) triggerEventImpl(name, detail);
      events.push({ name, detail: plain(detail) });
    }
  };
  Object.assign(context, definition.methods);

  return {
    context,
    definition,
    events,
    requests,
    navigations,
    toasts,
    guardCalls
  };
};

test('empty nickname submits fallback, completes profile, and emits success', async () => {
  const { context, events, requests, guardCalls } = loadComponent();

  await context.onConfirm();

  assert.deepEqual(requests, [{
    url: '/api/me/profile',
    options: { method: 'PUT', data: { nickname: '自在用户1000' } }
  }]);
  assert.deepEqual(guardCalls.completedUsers, [{ id: 7, nickname: '自在用户1000' }]);
  assert.deepEqual(guardCalls.guestModes, []);
  assert.deepEqual(events, [{
    name: 'profilesuccess',
    detail: { user: { id: 7, nickname: '自在用户1000', cached: true } }
  }]);
  assert.equal(context.data.loading, false);
});

test('typed nickname keeps spaces while editing and submits the trimmed value', async () => {
  const { context, requests } = loadComponent();

  context.onNicknameInput({ detail: { value: '  小林  ' } });
  assert.equal(context.data.nickname, '  小林  ');

  await context.onConfirm();

  assert.deepEqual(requests[0], {
    url: '/api/me/profile',
    options: { method: 'PUT', data: { nickname: '小林' } }
  });
});

test('failed request relies on request toast, preserves input, and restores loading', async () => {
  const { context, events, toasts } = loadComponent({
    requestImpl: async () => {
      throw new Error('request failed');
    }
  });
  context.data.nickname = '  小林  ';

  await context.onConfirm();

  assert.equal(context.data.nickname, '  小林  ');
  assert.deepEqual(events, []);
  assert.deepEqual(toasts, []);
  assert.equal(context.data.loading, false);
});

for (const failure of [
  {
    name: 'completeProfile',
    options: { completeProfileImpl: () => { throw new Error('profile completion failed'); } }
  },
  {
    name: 'triggerEvent',
    options: { triggerEventImpl: () => { throw new Error('event failed'); } }
  }
]) {
  test(`${failure.name} failure shows local error without emitting success`, async () => {
    const { context, events, toasts } = loadComponent(failure.options);
    context.data.nickname = '  小林  ';

    await context.onConfirm();

    assert.equal(context.data.nickname, '  小林  ');
    assert.deepEqual(events, []);
    assert.deepEqual(toasts, [{ title: '资料保存失败，请重试', icon: 'none' }]);
    assert.equal(context.data.loading, false);
  });
}

test('real profile persistence failure shows local error and restores state', async () => {
  const hadWx = Object.prototype.hasOwnProperty.call(global, 'wx');
  const hadGetApp = Object.prototype.hasOwnProperty.call(global, 'getApp');
  const previousWx = global.wx;
  const previousGetApp = global.getApp;
  const originalUser = { id: 7, avatar: '/old.png' };
  const app = {
    globalData: {
      user: originalUser,
      guestMode: true
    }
  };
  const storage = new Map([
    ['user', originalUser],
    ['guestMode', true]
  ]);
  global.getApp = () => app;
  global.wx = {
    getStorageSync(key) {
      return storage.get(key);
    },
    setStorageSync(key, value) {
      storage.set(key, value);
    },
    removeStorageSync(key) {
      if (key === 'guestMode') throw new Error('guest removal failed');
      storage.delete(key);
    }
  };

  try {
    const { context, events, toasts } = loadComponent({
      completeProfileImpl: realCompleteProfile
    });
    context.data.nickname = '小林';

    await context.onConfirm();

    assert.deepEqual(events, []);
    assert.deepEqual(toasts, [{ title: '资料保存失败，请重试', icon: 'none' }]);
    assert.strictEqual(app.globalData.user, originalUser);
    assert.equal(app.globalData.guestMode, true);
    assert.strictEqual(storage.get('user'), originalUser);
    assert.equal(storage.get('guestMode'), true);
  } finally {
    if (hadWx) global.wx = previousWx;
    else delete global.wx;
    if (hadGetApp) global.getApp = previousGetApp;
    else delete global.getApp;
  }
});

test('second confirm during a pending request does not make another request', async () => {
  let resolveRequest;
  const pendingRequest = new Promise(resolve => {
    resolveRequest = resolve;
  });
  const { context, requests } = loadComponent({
    requestImpl: () => pendingRequest
  });

  const firstConfirm = context.onConfirm();
  const secondConfirm = context.onConfirm();

  assert.equal(context.data.loading, true);
  assert.equal(requests.length, 1);

  resolveRequest({ id: 7, nickname: '自在用户1000' });
  await Promise.all([firstConfirm, secondConfirm]);

  assert.equal(requests.length, 1);
  assert.equal(context.data.loading, false);
});

test('skip sets guest mode and emits skipsuccess', () => {
  const { context, events, guardCalls } = loadComponent();

  context.onSkip();

  assert.deepEqual(guardCalls.guestModes, [true]);
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'skipsuccess');
  assert.equal(events[0].detail, undefined);
});

test('skip does nothing while loading', () => {
  const { context, events, guardCalls } = loadComponent();
  context.data.loading = true;

  context.onSkip();

  assert.deepEqual(guardCalls.guestModes, []);
  assert.deepEqual(events, []);
});

test('failed guest mode storage keeps popup open and emits no skip success', () => {
  const { context, events, toasts, guardCalls } = loadComponent({
    setGuestModeImpl: () => {
      throw new Error('storage failed');
    }
  });
  context.data.show = true;

  assert.doesNotThrow(() => context.onSkip());

  assert.equal(context.data.show, true);
  assert.deepEqual(guardCalls.guestModes, [true]);
  assert.deepEqual(events, []);
  assert.deepEqual(toasts, [{
    title: '暂时无法进入游客模式，请重试',
    icon: 'none'
  }]);
});

test('agreement and privacy methods navigate to their existing pages', () => {
  const { context, navigations } = loadComponent();

  context.openAgreement();
  context.openPrivacy();

  assert.deepEqual(navigations, [
    { url: '/pages/agreement/agreement' },
    { url: '/pages/privacy/privacy' }
  ]);
});

test('markup uses a native scroll-view with modal accessibility semantics', () => {
  assert.match(wxmlSource, /<scroll-view\b(?=[^>]*class="login-sheet")(?=[^>]*scroll-y="true")(?=[^>]*aria-role="dialog")(?=[^>]*aria-label="[^"]+")[^>]*>/);
  assert.doesNotMatch(wxmlSource, /<view\b[^>]*class="login-sheet"/);
});

test('markup has a persistent accessible nickname label and labeled actions', () => {
  assert.match(wxmlSource, /<label\b[^>]*for="nickname"[^>]*>昵称<\/label>/);
  assert.match(wxmlSource, /<input\b(?=[^>]*id="nickname")(?=[^>]*aria-label="昵称")[^>]*>/);
  assert.match(wxmlSource, /<button\b(?=[^>]*class="confirm-button")(?=[^>]*aria-label="确认并开始使用")[^>]*>/);
  assert.match(wxmlSource, /<button\b(?=[^>]*class="skip-button")(?=[^>]*aria-label="暂时跳过")[^>]*>/);
});

test('agreement and privacy links are accessible buttons', () => {
  assert.match(wxmlSource, /<button\b(?=[^>]*class="agreement-link")(?=[^>]*bindtap="openAgreement")(?=[^>]*aria-label="查看用户协议")[^>]*>/);
  assert.match(wxmlSource, /<button\b(?=[^>]*class="agreement-link")(?=[^>]*bindtap="openPrivacy")(?=[^>]*aria-label="查看隐私政策")[^>]*>/);
  assert.doesNotMatch(wxmlSource, /<text\b[^>]*class="agreement-link"/);
});

test('agreement and privacy buttons have at least 88rpx interactive height', () => {
  const rule = wxssSource.match(/\.agreement-link\s*\{([^}]*)\}/);
  assert.ok(rule, 'expected an .agreement-link style rule');

  const minHeight = rule[1].match(/min-height:\s*(\d+)rpx/);
  assert.ok(minHeight, 'expected agreement links to define min-height');
  assert.ok(Number(minHeight[1]) >= 88, 'agreement link min-height must be at least 88rpx');
  assert.match(rule[1], /background:\s*transparent/);
});
