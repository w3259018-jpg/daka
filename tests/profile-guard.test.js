const test = require('node:test');
const assert = require('node:assert/strict');

const storage = new Map();

global.wx = {
  getStorageSync(key) {
    return storage.get(key);
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  removeStorageSync(key) {
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
  requireProfile,
  profilePopupHandlers
} = require('../miniprogram/utils/profile-guard');

test.beforeEach(() => {
  storage.clear();
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
