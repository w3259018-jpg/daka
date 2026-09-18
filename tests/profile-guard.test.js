const test = require('node:test');
const assert = require('node:assert/strict');

const storage = new Map();
const storageFailures = {
  set: new Set(),
  remove: new Set()
};

global.wx = {
  getStorageSync(key) {
    return storage.get(key);
  },
  setStorageSync(key, value) {
    if (storageFailures.set.has(key)) throw new Error(`set ${key} failed`);
    storage.set(key, value);
  },
  removeStorageSync(key) {
    if (storageFailures.remove.has(key)) throw new Error(`remove ${key} failed`);
    storage.delete(key);
  },
  showToast() {}
};

const {
  hasProfile,
  createFallbackNickname,
  shouldPromptProfile,
  setGuestMode,
  cacheUser,
  completeProfile,
  requireProfile,
  profilePopupHandlers
} = require('../miniprogram/utils/profile-guard');

test.beforeEach(() => {
  storage.clear();
  storageFailures.set.clear();
  storageFailures.remove.clear();
  wx.showToast = () => {};
});

test('hasProfile ignores avatar and requires a trimmed non-empty nickname', () => {
  assert.equal(hasProfile({ avatar: '/avatar.png' }), false);
  assert.equal(hasProfile({ avatar: '/avatar.png', nickname: '   ' }), false);
  assert.equal(hasProfile({ avatar: '', nickname: '  Alice  ' }), true);
});

test('createFallbackNickname maps the injected random value to the expected suffix', () => {
  assert.equal(createFallbackNickname(() => 0), '自在用户1000');
  assert.equal(createFallbackNickname(() => 0.9999), '自在用户9999');
});

test('setGuestMode synchronizes app state and storage', () => {
  const app = { globalData: {} };

  setGuestMode(true, app);
  assert.equal(app.globalData.guestMode, true);
  assert.equal(storage.get('guestMode'), true);

  setGuestMode(false, app);
  assert.equal(app.globalData.guestMode, false);
  assert.equal(storage.has('guestMode'), false);
});

test('shouldPromptProfile prompts only users without a profile who are not guests', () => {
  assert.equal(shouldPromptProfile({}, false), true);
  assert.equal(shouldPromptProfile({}, true), false);
  assert.equal(shouldPromptProfile({ nickname: '自在用户1234' }, false), false);
});

test('cacheUser merges the global user and writes the merged user to storage', () => {
  const app = { globalData: { user: { id: 7, avatar: '/old.png' } } };

  const user = cacheUser({ nickname: 'Alice' }, app);

  assert.deepEqual(user, { id: 7, avatar: '/old.png', nickname: 'Alice' });
  assert.deepEqual(app.globalData.user, user);
  assert.deepEqual(storage.get('user'), user);
});

test('cacheUser leaves app state unchanged when user storage fails', () => {
  const originalUser = { id: 7, avatar: '/old.png' };
  const app = { globalData: { user: originalUser } };
  storage.set('user', originalUser);
  storageFailures.set.add('user');

  assert.throws(
    () => cacheUser({ nickname: 'Alice' }, app),
    /set user failed/
  );

  assert.strictEqual(app.globalData.user, originalUser);
  assert.strictEqual(storage.get('user'), originalUser);
});

test('setGuestMode leaves app state unchanged when guest storage removal fails', () => {
  const app = { globalData: { guestMode: true } };
  storage.set('guestMode', true);
  storageFailures.remove.add('guestMode');

  assert.throws(() => setGuestMode(false, app), /remove guestMode failed/);

  assert.equal(app.globalData.guestMode, true);
  assert.equal(storage.get('guestMode'), true);
});

test('completeProfile caches a completed user and exits guest mode', () => {
  const app = {
    globalData: {
      user: { id: 7, avatar: '/old.png' },
      guestMode: true
    }
  };
  storage.set('guestMode', true);

  const user = completeProfile({ nickname: '小林' }, app);

  assert.deepEqual(user, { id: 7, avatar: '/old.png', nickname: '小林' });
  assert.deepEqual(app.globalData.user, user);
  assert.deepEqual(storage.get('user'), user);
  assert.equal(app.globalData.guestMode, false);
  assert.equal(storage.has('guestMode'), false);
});

test('completeProfile caches an incomplete user without exiting guest mode', () => {
  const app = {
    globalData: {
      user: { id: 7 },
      guestMode: true
    }
  };
  storage.set('guestMode', true);

  const user = completeProfile({ avatar: '/new.png' }, app);

  assert.deepEqual(user, { id: 7, avatar: '/new.png' });
  assert.deepEqual(app.globalData.user, user);
  assert.deepEqual(storage.get('user'), user);
  assert.equal(app.globalData.guestMode, true);
  assert.equal(storage.get('guestMode'), true);
});

test('completeProfile rolls back user and guest state when clearing guest mode fails', () => {
  const originalUser = { id: 7, avatar: '/old.png' };
  const app = {
    globalData: {
      user: originalUser,
      guestMode: true
    }
  };
  storage.set('user', originalUser);
  storage.set('guestMode', true);
  storageFailures.remove.add('guestMode');

  assert.throws(
    () => completeProfile({ nickname: '小林' }, app),
    /remove guestMode failed/
  );

  assert.strictEqual(app.globalData.user, originalUser);
  assert.equal(app.globalData.guestMode, true);
  assert.strictEqual(storage.get('user'), originalUser);
  assert.equal(storage.get('guestMode'), true);
});

test('requireProfile returns true without prompting when the page user has a nickname', () => {
  let setDataCalled = false;
  const page = {
    data: { user: { nickname: 'Alice' } },
    setData() { setDataCalled = true; }
  };

  assert.equal(requireProfile(page), true);
  assert.equal(setDataCalled, false);
});

test('requireProfile prompts for a missing profile unless silent', () => {
  const toasts = [];
  const updates = [];
  wx.showToast = options => toasts.push(options);
  const page = {
    data: { user: {} },
    setData(update) { updates.push(update); }
  };

  assert.equal(requireProfile(page), false);
  assert.deepEqual(toasts, [{ title: '请先完善个人资料', icon: 'none' }]);
  assert.deepEqual(updates, [{ showLoginPopup: true }]);

  toasts.length = 0;
  updates.length = 0;
  assert.equal(requireProfile(page, { silent: true }), false);
  assert.deepEqual(toasts, []);
  assert.deepEqual(updates, []);
});

test('profile popup handlers close the popup and success updates a supplied user', () => {
  const updates = [];
  const page = { setData(update) { updates.push(update); } };

  profilePopupHandlers.onProfileSuccess.call(page, {
    detail: { user: { nickname: 'Alice' } }
  });
  profilePopupHandlers.onProfileSkip.call(page);

  assert.deepEqual(updates, [
    { showLoginPopup: false, user: { nickname: 'Alice' } },
    { showLoginPopup: false }
  ]);
});
