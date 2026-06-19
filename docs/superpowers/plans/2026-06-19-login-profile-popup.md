# Login Profile Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a branded bottom-sheet profile popup with default avatar, optional nickname input, generated fallback nickname, persistent guest mode, and consistent write-action gating.

**Architecture:** Keep silent login unchanged. Put profile-state rules in a CommonJS utility, profile submission and rendering in one native mini-program component, and page-specific business behavior in existing pages guarded by the shared utility. No backend changes are required.

**Tech Stack:** Native WeChat Mini Program (WXML/WXSS/JS), CommonJS, Node.js `node:test`, existing `utils/api.js` request wrapper.

---

## File Map

- Create `miniprogram/utils/profile-guard.js`: profile completion, guest persistence, fallback nickname, popup gating, shared popup callbacks.
- Create `tests/profile-guard.test.js`: pure and stateful guard behavior.
- Create `miniprogram/components/login-popup/login-popup.{js,json,wxml,wxss}`: B-layout bottom sheet and submission flow.
- Create `tests/login-popup.test.js`: component behavior in a VM harness.
- Modify `miniprogram/app.js`: initialize guest state on every launch path.
- Modify `miniprogram/app.json`: register `login-popup` globally.
- Modify `miniprogram/pages/tasks/*`: initial popup and create-entry gate.
- Modify `miniprogram/pages/taskboard/*`: create-entry gate.
- Modify `miniprogram/pages/records/*`: export gate.
- Modify `miniprogram/pages/create/*`: create-task gate.
- Modify `miniprogram/pages/join/*`: join-task gate.
- Modify `miniprogram/pages/item/*`: silent watched-write suppression and submit gate.
- Modify `miniprogram/pages/task/*`: publish and administrator write gates; preserve current uncommitted user edits.
- Modify `miniprogram/pages/profile/*`: default avatar fallback and guest-mode clearing after nickname save.
- Create `tests/page-profile-gates.test.js`: VM-backed page gate tests.
- Modify `check-miniprogram.js`: require globally registered component files to exist.

### Task 1: Profile State Guard

**Files:**
- Create: `tests/profile-guard.test.js`
- Create: `miniprogram/utils/profile-guard.js`

- [ ] **Step 1: Write failing guard tests**

```js
// tests/profile-guard.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const storage = new Map();
global.wx = {
  getStorageSync: key => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: key => storage.delete(key),
  showToast: () => {}
};

const guard = require('../miniprogram/utils/profile-guard');

test.beforeEach(() => storage.clear());

test('profile completion depends only on a non-empty nickname', () => {
  assert.equal(guard.hasProfile({ avatar: '/a.png', nickname: '' }), false);
  assert.equal(guard.hasProfile({ nickname: '  小林  ' }), true);
});

test('fallback nickname uses a four-digit suffix', () => {
  assert.equal(guard.createFallbackNickname(() => 0), '自在用户1000');
  assert.equal(guard.createFallbackNickname(() => 0.9999), '自在用户9999');
});

test('guest mode is persisted and cleared with app state', () => {
  const app = { globalData: {} };
  guard.setGuestMode(true, app);
  assert.equal(app.globalData.guestMode, true);
  assert.equal(storage.get('guestMode'), true);
  guard.setGuestMode(false, app);
  assert.equal(app.globalData.guestMode, false);
  assert.equal(storage.has('guestMode'), false);
});

test('initial popup is suppressed only for completed or skipped users', () => {
  assert.equal(guard.shouldPromptProfile({}, false), true);
  assert.equal(guard.shouldPromptProfile({}, true), false);
  assert.equal(guard.shouldPromptProfile({ nickname: '自在用户1234' }, false), false);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/profile-guard.test.js`

Expected: FAIL with `Cannot find module '../miniprogram/utils/profile-guard'`.

- [ ] **Step 3: Implement the minimal guard**

```js
// miniprogram/utils/profile-guard.js
const hasProfile = user => !!String((user && user.nickname) || '').trim();

const createFallbackNickname = (random = Math.random) => {
  const suffix = 1000 + Math.floor(random() * 9000);
  return `自在用户${suffix}`;
};

const shouldPromptProfile = (user, guestMode) => !hasProfile(user) && !guestMode;

const setGuestMode = (enabled, app = getApp()) => {
  app.globalData.guestMode = !!enabled;
  if (enabled) wx.setStorageSync('guestMode', true);
  else wx.removeStorageSync('guestMode');
};

const cacheUser = (user, app = getApp()) => {
  app.globalData.user = { ...(app.globalData.user || {}), ...(user || {}) };
  wx.setStorageSync('user', app.globalData.user);
  return app.globalData.user;
};

const requireProfile = (page, options = {}) => {
  const app = getApp();
  if (hasProfile(app.globalData.user)) return true;
  if (!options.silent) {
    wx.showToast({ title: '请先完善个人资料', icon: 'none' });
    page.setData({ showLoginPopup: true });
  }
  return false;
};

const profilePopupHandlers = {
  onProfileSuccess(e) {
    this.setData({ showLoginPopup: false });
    const user = e && e.detail && e.detail.user;
    if (user && this.data && this.data.user) this.setData({ user });
  },
  onProfileSkip() {
    this.setData({ showLoginPopup: false });
  }
};

module.exports = {
  hasProfile,
  createFallbackNickname,
  shouldPromptProfile,
  setGuestMode,
  cacheUser,
  requireProfile,
  profilePopupHandlers
};
```

- [ ] **Step 4: Run the guard tests and verify GREEN**

Run: `node --test tests/profile-guard.test.js`

Expected: 4 tests pass.

- [ ] **Step 5: Commit the guard**

```powershell
git add -- miniprogram/utils/profile-guard.js tests/profile-guard.test.js
git commit -m "feat: add profile completion guard"
```

### Task 2: Login Popup Component

**Files:**
- Create: `tests/login-popup.test.js`
- Create: `miniprogram/components/login-popup/login-popup.js`
- Create: `miniprogram/components/login-popup/login-popup.json`
- Create: `miniprogram/components/login-popup/login-popup.wxml`
- Create: `miniprogram/components/login-popup/login-popup.wxss`

- [ ] **Step 1: Write failing component tests**

Use `vm.runInNewContext` to capture the object passed to `Component()`. Stub `../../utils/api` and `../../utils/profile-guard`, then instantiate a context with `data`, `setData`, and `triggerEvent`.

```js
// tests/login-popup.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const componentFile = path.join(__dirname, '../miniprogram/components/login-popup/login-popup.js');

const loadComponent = ({ requestImpl = async () => ({ nickname: '自在用户1000' }) } = {}) => {
  let definition;
  const events = [];
  const app = { globalData: { user: {} } };
  const profileGuard = {
    createFallbackNickname: () => '自在用户1000',
    cacheUser: user => { app.globalData.user = user; return user; },
    setGuestMode: enabled => { app.globalData.guestMode = enabled; }
  };
  vm.runInNewContext(fs.readFileSync(componentFile, 'utf8'), {
    Component: value => { definition = value; },
    getApp: () => app,
    setTimeout: fn => fn(),
    require: id => id.includes('profile-guard') ? profileGuard : { request: requestImpl },
    wx: { navigateTo() {} }
  }, { filename: componentFile });
  const context = {
    data: { nickname: '', loading: false },
    setData(patch) { Object.assign(this.data, patch); },
    triggerEvent(name, detail) { events.push({ name, detail }); }
  };
  Object.assign(context, definition.methods);
  return { context, events, app };
};

test('empty nickname is replaced and saved once', async () => {
  let payload;
  const { context, events } = loadComponent({
    requestImpl: async (_url, options) => { payload = options.data; return { nickname: options.data.nickname }; }
  });
  await context.onConfirm();
  assert.deepEqual(payload, { nickname: '自在用户1000' });
  assert.equal(events[0].name, 'profilesuccess');
  assert.equal(context.data.loading, false);
});

test('failed save keeps input and restores loading state', async () => {
  const { context, events } = loadComponent({ requestImpl: async () => { throw new Error('fail'); } });
  context.data.nickname = '小林';
  await context.onConfirm();
  assert.equal(context.data.nickname, '小林');
  assert.equal(context.data.loading, false);
  assert.equal(events.length, 0);
});

test('skip persists guest mode and emits event', () => {
  const { context, events, app } = loadComponent();
  context.onSkip();
  assert.equal(app.globalData.guestMode, true);
  assert.equal(events[0].name, 'skipsuccess');
});
```

- [ ] **Step 2: Run component tests and verify RED**

Run: `node --test tests/login-popup.test.js`

Expected: FAIL because `login-popup.js` does not exist.

- [ ] **Step 3: Implement component behavior**

```js
// miniprogram/components/login-popup/login-popup.js
const { request } = require('../../utils/api');
const { createFallbackNickname, cacheUser, setGuestMode } = require('../../utils/profile-guard');

Component({
  properties: { show: { type: Boolean, value: false } },
  data: { nickname: '', loading: false },
  methods: {
    onNicknameInput(e) {
      this.setData({ nickname: (e.detail.value || '').trimStart() });
    },
    async onConfirm() {
      if (this.data.loading) return;
      const nickname = this.data.nickname.trim() || createFallbackNickname();
      this.setData({ loading: true });
      try {
        const saved = await request('/api/me/profile', { method: 'PUT', data: { nickname } });
        const user = cacheUser(saved);
        setGuestMode(false);
        this.triggerEvent('profilesuccess', { user });
      } catch (_) {
        // request() already shows the error.
      } finally {
        this.setData({ loading: false });
      }
    },
    onSkip() {
      setGuestMode(true);
      this.triggerEvent('skipsuccess');
    },
    openAgreement() { wx.navigateTo({ url: '/pages/agreement/agreement' }); },
    openPrivacy() { wx.navigateTo({ url: '/pages/privacy/privacy' }); },
    stop() {}
  }
});
```

- [ ] **Step 4: Add component metadata and B-layout markup**

```json
// miniprogram/components/login-popup/login-popup.json
{ "component": true }
```

```xml
<!-- miniprogram/components/login-popup/login-popup.wxml -->
<view wx:if="{{show}}" class="login-mask" catchtouchmove="stop">
  <view class="login-sheet" catchtap="stop">
    <view class="sheet-handle"></view>
    <view class="brand-avatar">为一</view>
    <view class="login-title">欢迎加入为一自在</view>
    <view class="login-subtitle">设置你的资料，开始打卡吧</view>
    <view class="default-avatar">为一</view>
    <input class="nickname-input" type="nickname" maxlength="20"
      value="{{nickname}}" placeholder="输入你的昵称（可选）" bindinput="onNicknameInput" />
    <button class="confirm-button" loading="{{loading}}" disabled="{{loading}}" bindtap="onConfirm">确认并开始使用</button>
    <button class="skip-button" disabled="{{loading}}" bindtap="onSkip">暂时跳过</button>
    <view class="agreement-text">继续即表示同意
      <text class="agreement-link" bindtap="openAgreement">《用户协议》</text>和
      <text class="agreement-link" bindtap="openPrivacy">《隐私保护指引》</text>
    </view>
  </view>
</view>
```

```css
/* miniprogram/components/login-popup/login-popup.wxss */
.login-mask { position:fixed; inset:0; z-index:1000; display:flex; align-items:flex-end; background:rgba(0,0,0,.5); }
.login-sheet { width:100%; box-sizing:border-box; padding:18rpx 40rpx calc(40rpx + env(safe-area-inset-bottom)); border-radius:32rpx 32rpx 0 0; background:#FFFDF9; text-align:center; animation:loginSheetIn .3s ease both; }
.sheet-handle { width:72rpx; height:8rpx; margin:0 auto 30rpx; border-radius:999rpx; background:#F0E7DC; }
.brand-avatar,.default-avatar { display:flex; align-items:center; justify-content:center; margin-left:auto; margin-right:auto; border-radius:50%; color:#E98243; font-weight:800; background:linear-gradient(135deg,#FBEFE4,#F2B36D); }
.brand-avatar { width:96rpx; height:96rpx; font-size:26rpx; }
.default-avatar { width:132rpx; height:132rpx; margin-top:34rpx; font-size:30rpx; border:4rpx solid #FFFDF9; box-shadow:0 10rpx 24rpx rgba(233,130,67,.18); }
.login-title { margin-top:22rpx; color:#30261E; font-size:38rpx; line-height:1.3; font-weight:800; }
.login-subtitle { margin-top:10rpx; color:#988878; font-size:25rpx; }
.nickname-input { height:88rpx; margin-top:24rpx; padding:0 24rpx; box-sizing:border-box; border:1rpx solid #F0E7DC; border-radius:22rpx; background:#fff; color:#30261E; font-size:28rpx; text-align:left; }
.confirm-button,.skip-button { width:100%; height:92rpx; margin-top:24rpx; padding:0; border-radius:999rpx; font-size:29rpx; line-height:92rpx; }
.confirm-button::after,.skip-button::after { border:0; }
.confirm-button { color:#fff; background:linear-gradient(135deg,#F2B36D,#E98243); box-shadow:0 12rpx 26rpx rgba(233,130,67,.24); }
.skip-button { color:#E98243; border:2rpx solid #F0E7DC; background:#FFFDF9; }
.agreement-text { margin-top:26rpx; color:#988878; font-size:22rpx; line-height:1.6; }
.agreement-link { color:#E98243; }
@keyframes loginSheetIn { from { transform:translateY(100%); } to { transform:translateY(0); } }
```

- [ ] **Step 5: Run component tests and verify GREEN**

Run: `node --test tests/login-popup.test.js`

Expected: 3 tests pass.

- [ ] **Step 6: Commit the component**

```powershell
git add -- miniprogram/components/login-popup tests/login-popup.test.js
git commit -m "feat: add login profile popup"
```

### Task 3: Application State and Registration

**Files:**
- Modify: `miniprogram/app.js`
- Modify: `miniprogram/app.json`
- Modify: `check-miniprogram.js`

- [ ] **Step 1: Add a failing static registration assertion**

Extend `check-miniprogram.js` after loading `app.json`:

```js
const loginPopupPath = app.usingComponents && app.usingComponents['login-popup'];
if (loginPopupPath === '/components/login-popup/login-popup') ok('login popup globally registered');
else ng('login popup must be globally registered');

for (const ext of ['.js', '.json', '.wxml', '.wxss']) {
  const file = path.join(ROOT, 'components', 'login-popup', 'login-popup' + ext);
  if (fs.existsSync(file)) ok('login popup file: ' + path.relative(ROOT, file));
  else ng('missing login popup file: ' + path.relative(ROOT, file));
}
```

- [ ] **Step 2: Run static checks and verify RED**

Run: `node check-miniprogram.js`

Expected: FAIL with `login popup must be globally registered`.

- [ ] **Step 3: Initialize guest state before either login branch**

In `app.js`, add `guestMode: false` to `globalData`, then make the first line of `onLaunch()`:

```js
this.globalData.guestMode = !!wx.getStorageSync('guestMode');
```

This must execute before checking the cached token so cached and fresh sessions behave identically.

- [ ] **Step 4: Register the component**

Add to `app.json` without changing `privacy-popup`:

```json
"login-popup": "/components/login-popup/login-popup"
```

- [ ] **Step 5: Run static checks and verify GREEN**

Run: `node check-miniprogram.js`

Expected: `0 failed`.

- [ ] **Step 6: Commit app wiring**

```powershell
git add -- miniprogram/app.js miniprogram/app.json check-miniprogram.js
git commit -m "feat: initialize guest profile state"
```

### Task 4: Page Gate Harness and Primary Flows

**Files:**
- Create: `tests/page-profile-gates.test.js`
- Modify: `miniprogram/pages/tasks/tasks.js`
- Modify: `miniprogram/pages/tasks/tasks.wxml`
- Modify: `miniprogram/pages/taskboard/taskboard.js`
- Modify: `miniprogram/pages/taskboard/taskboard.wxml`
- Modify: `miniprogram/pages/create/create.js`
- Modify: `miniprogram/pages/create/create.wxml`
- Modify: `miniprogram/pages/join/join.js`
- Modify: `miniprogram/pages/join/join.wxml`

- [ ] **Step 1: Build a VM page loader and write failing gate tests**

In `tests/page-profile-gates.test.js`, use this VM loader before the test cases:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const loadPage = (relativePath, options = {}) => {
  const requests = [];
  let definition;
  const app = { globalData: { user: {}, guestMode: true } };
  const wx = {
    showToast() {}, showLoading() {}, hideLoading() {}, showModal() {},
    navigateTo() {}, redirectTo() {}, switchTab() {}, setStorageSync() {},
    getStorageSync() { return ''; }, createInnerAudioContext() { return { onPlay() {}, destroy() {} }; }
  };
  const api = {
    request: async (url, requestOptions) => { requests.push({ url, options: requestOptions }); return {}; },
    ensureLogin: async () => app.globalData.user,
    safe: async value => value,
    toast() {}, fullUrl: value => value, upload: async () => ({}),
    secCheck: async () => ({ safe: true })
  };
  const profileGuard = {
    requireProfile(page, guardOptions = {}) {
      if (options.allowProfile) return true;
      if (!guardOptions.silent) page.setData({ showLoginPopup: true });
      return false;
    },
    shouldPromptProfile: () => false,
    profilePopupHandlers: { onProfileSuccess() {}, onProfileSkip() {} }
  };
  const filename = path.join(__dirname, '../miniprogram', relativePath);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page: value => { definition = value; },
    getApp: () => app,
    require: id => id.includes('profile-guard') ? profileGuard : api,
    wx, console, setTimeout: fn => fn(), clearTimeout() {}, Date, Math, Promise, encodeURIComponent, decodeURIComponent
  }, { filename });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data || {})),
    requests,
    setData(patch) { Object.assign(this.data, patch); }
  };
  return page;
};
```

```js
test('create page blocks POST when profile is missing', async () => {
  const page = loadPage('pages/create/create.js');
  page.data.name = '早起';
  await page.createTask();
  assert.equal(page.requests.length, 0);
  assert.equal(page.data.showLoginPopup, true);
});

test('join page blocks POST when profile is missing', async () => {
  const page = loadPage('pages/join/join.js');
  page.data.realName = '小林';
  await page.submit();
  assert.equal(page.requests.length, 0);
  assert.equal(page.data.showLoginPopup, true);
});
```

- [ ] **Step 2: Run page tests and verify RED**

Run: `node --test tests/page-profile-gates.test.js`

Expected: FAIL because existing methods proceed without the profile guard.

- [ ] **Step 3: Add shared state and handlers to the four pages**

For each page import:

```js
const { requireProfile, shouldPromptProfile, profilePopupHandlers } = require('../../utils/profile-guard');
```

Add `showLoginPopup: false` to page data and spread `...profilePopupHandlers` into each Page definition.

For `tasks.onShow()`, after `await ensureLogin()` and after `load()` has merged the current user, set:

```js
const app = getApp();
this.setData({
  showLoginPopup: shouldPromptProfile(app.globalData.user, app.globalData.guestMode)
});
```

Guard `tasks.openCreate`, `taskboard.create`, `create.createTask`, and `join.submit` as the first method statement:

```js
if (!requireProfile(this)) return;
```

- [ ] **Step 4: Mount the popup in each WXML file**

Append after the existing page content:

```xml
<login-popup show="{{showLoginPopup}}"
  bind:profilesuccess="onProfileSuccess"
  bind:skipsuccess="onProfileSkip" />
```

Keep existing `privacy-popup` instances unchanged and adjacent.

- [ ] **Step 5: Run page and static tests**

Run: `node --test tests/page-profile-gates.test.js tests/profile-guard.test.js tests/login-popup.test.js`

Expected: all tests pass.

Run: `node check-miniprogram.js`

Expected: `0 failed`.

- [ ] **Step 6: Commit primary flow gates**

```powershell
git add -- tests/page-profile-gates.test.js miniprogram/pages/tasks miniprogram/pages/taskboard miniprogram/pages/create miniprogram/pages/join
git commit -m "feat: gate profile-required task flows"
```

### Task 5: Records, Check-in, and Administrator Gates

**Files:**
- Modify: `tests/page-profile-gates.test.js`
- Modify: `miniprogram/pages/records/records.js`
- Modify: `miniprogram/pages/records/records.wxml`
- Modify: `miniprogram/pages/item/item.js`
- Modify: `miniprogram/pages/item/item.wxml`
- Modify: `miniprogram/pages/task/task.js`
- Modify: `miniprogram/pages/task/task.wxml`

- [ ] **Step 1: Add failing tests for remaining write operations**

Add VM tests proving that a missing profile prevents network writes from:

```js
records.exportNotes()
item.submit()
task.publish()
task.exportAdminData()
task.setRole({ currentTarget: { dataset: { uid: 2, role: 'admin' } } })
task.removeMember({ currentTarget: { dataset: { uid: 2 } } })
task.dissolve()
```

Add this separate expectation for playback:

```js
test('guest playback does not write watched state or open the popup', async () => {
  const page = loadPage('pages/item/item.js', { silentGuard: true });
  await page.markWatched();
  assert.equal(page.requests.length, 0);
  assert.equal(page.data.showLoginPopup, false);
});
```

- [ ] **Step 2: Run remaining page tests and verify RED**

Run: `node --test tests/page-profile-gates.test.js`

Expected: new cases fail because requests or modals still execute.

- [ ] **Step 3: Guard the remaining methods**

In each JS file import and attach the exact shared pieces:

```js
const { requireProfile, profilePopupHandlers } = require('../../utils/profile-guard');

// Inside data:
showLoginPopup: false

// Inside Page({...}):
...profilePopupHandlers,
```

Append this exact markup to `records.wxml`, `item.wxml`, and `task.wxml`, preserving each existing `privacy-popup`:

```xml
<login-popup show="{{showLoginPopup}}"
  bind:profilesuccess="onProfileSuccess"
  bind:skipsuccess="onProfileSkip" />
```

Use this first line for explicit user actions:

```js
if (!requireProfile(this)) return;
```

Apply it to `records.exportNotes`, `item.submit`, `task.publish`, `task.exportAdminData`, `task.setRole`, `task.removeMember`, and `task.dissolve`.

For automatic playback tracking only, use:

```js
if (!requireProfile(this, { silent: true })) return;
```

as the first line of `item.markWatched`, so media still plays without writing or interrupting the user.

When modifying `task.js` and `task.wxml`, preserve all pre-existing uncommitted user changes and insert only the guard-related imports, data, methods, checks, and popup markup.

- [ ] **Step 4: Run page and static tests**

Run: `node --test tests/page-profile-gates.test.js`

Expected: all page gate tests pass.

Run: `node check-miniprogram.js`

Expected: `0 failed`.

- [ ] **Step 5: Commit remaining gates**

```powershell
git add -- tests/page-profile-gates.test.js miniprogram/pages/records miniprogram/pages/item miniprogram/pages/task
git commit -m "feat: gate check-in and admin writes"
```

### Task 6: Profile Page Completion and Default Avatar

**Files:**
- Modify: `tests/profile-guard.test.js`
- Modify: `miniprogram/pages/profile/profile.js`
- Modify: `miniprogram/pages/profile/profile.wxml`
- Modify: `miniprogram/pages/profile/profile.wxss`

- [ ] **Step 1: Add a failing completion-state test**

```js
test('caching a completed user clears guest mode', () => {
  const app = { globalData: { guestMode: true, user: {} } };
  guard.completeProfile({ nickname: '小林' }, app);
  assert.equal(app.globalData.user.nickname, '小林');
  assert.equal(app.globalData.guestMode, false);
  assert.equal(storage.has('guestMode'), false);
});
```

- [ ] **Step 2: Run the guard test and verify RED**

Run: `node --test tests/profile-guard.test.js`

Expected: FAIL because `completeProfile` is not exported.

- [ ] **Step 3: Add and use `completeProfile`**

```js
const completeProfile = (user, app = getApp()) => {
  const cached = cacheUser(user, app);
  if (hasProfile(cached)) setGuestMode(false, app);
  return cached;
};
```

Export it, update `login-popup.js` to use it instead of calling `cacheUser` and `setGuestMode` separately, and update `profile.onNicknameChange()` to call `completeProfile(user)` after a successful request.

- [ ] **Step 4: Replace the empty profile avatar with the confirmed default**

In `profile.wxml`, change the empty branch from `+` to `为一` and add an accessibility-oriented label on the choose-avatar button:

```xml
<button class="avatar-btn" open-type="chooseAvatar" bindchooseavatar="onChooseAvatar" aria-label="设置头像">
  <image wx:if="{{user.avatar}}" class="avatar avatar-lg" src="{{user.avatar}}" mode="aspectFill"></image>
  <view wx:else class="avatar avatar-lg center avatar-empty">为一</view>
</button>
```

Keep the existing optional avatar upload behavior. Adjust `.avatar-empty` font size so two Chinese characters fit without clipping.

- [ ] **Step 5: Run all automated checks**

Run: `node --test tests/profile-guard.test.js tests/login-popup.test.js tests/page-profile-gates.test.js`

Expected: all tests pass.

Run: `node check-miniprogram.js`

Expected: `0 failed`.

- [ ] **Step 6: Commit profile completion**

```powershell
git add -- miniprogram/utils/profile-guard.js miniprogram/components/login-popup/login-popup.js miniprogram/pages/profile tests/profile-guard.test.js
git commit -m "feat: complete guest profile from nickname"
```

### Task 7: Final Verification

**Files:**
- Verify all modified mini-program and test files.

- [ ] **Step 1: Run the complete Node test suite**

Run: `node --test tests/*.test.js`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run the mini-program static checker**

Run: `node check-miniprogram.js`

Expected: final line reports `0 failed`.

- [ ] **Step 3: Inspect the exact diff and unrelated changes**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git status --short`

Expected: pre-existing unrelated changes remain untouched; only intended login-popup files appear in this work's diff.

- [ ] **Step 4: Manual WeChat Developer Tools verification**

Verify these exact cases on a phone-sized viewport and a device with bottom safe area:

1. Fresh user without nickname sees the B-layout popup after silent login.
2. Empty nickname confirmation saves a name matching `^自在用户\d{4}$`.
3. Typed nickname is preserved exactly after trimming outer whitespace.
4. Skip survives app restart and does not auto-open the popup.
5. Create, join, export, submit, publish, and administrator writes reopen the popup for an incomplete user.
6. Guest media playback continues but does not create a watched record.
7. Agreement and privacy links open existing pages.
8. Submission failure leaves the sheet open and preserves the input.
9. Completing nickname in either the popup or profile page clears guest mode.
10. Existing `privacy-popup` still appears for its original privacy-sensitive APIs.

- [ ] **Step 5: Commit any verification-only corrections**

If verification required code corrections, repeat the relevant RED/GREEN test cycle, then commit only those files:

```powershell
git add -- miniprogram/app.js miniprogram/app.json miniprogram/utils/profile-guard.js miniprogram/components/login-popup miniprogram/pages/tasks miniprogram/pages/taskboard miniprogram/pages/records miniprogram/pages/profile miniprogram/pages/create miniprogram/pages/join miniprogram/pages/item miniprogram/pages/task tests check-miniprogram.js
git commit -m "fix: finalize login profile popup"
```
