const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const profileFile = path.join(
  __dirname,
  '../miniprogram/pages/profile/profile.js'
);

const plain = value => (
  value === undefined ? undefined : JSON.parse(JSON.stringify(value))
);

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const loadPage = ({
  requestImpl,
  uploadImpl,
  completeProfileImpl,
  cacheUserImpl,
  initialUser = {},
  appUser = initialUser,
  storedUser = appUser
} = {}) => {
  let definition;
  const requests = [];
  const completedProfiles = [];
  const cachedUsers = [];
  const toasts = [];
  const loading = [];
  const app = { globalData: { user: plain(appUser) } };
  const storage = new Map([['user', plain(storedUser)]]);

  const request = async (url, options) => {
    requests.push({ url, options: plain(options) });
    if (requestImpl) return requestImpl(url, options);
    return { ...(options && options.data) };
  };
  const upload = async file => (
    uploadImpl ? uploadImpl(file) : { url: '/avatar.png' }
  );
  const completeProfile = user => {
    completedProfiles.push(plain(user));
    if (completeProfileImpl) return completeProfileImpl(user, app, storage);
    const merged = { ...(app.globalData.user || {}), ...user };
    storage.set('user', plain(merged));
    app.globalData.user = merged;
    return merged;
  };
  const cacheUser = user => {
    cachedUsers.push(plain(user));
    if (cacheUserImpl) return cacheUserImpl(user, app, storage);
    const merged = { ...(app.globalData.user || {}), ...user };
    storage.set('user', plain(merged));
    app.globalData.user = merged;
    return merged;
  };

  vm.runInNewContext(fs.readFileSync(profileFile, 'utf8'), {
    Page(value) {
      definition = value;
    },
    require(id) {
      if (id === '../../utils/api') {
        return {
          request,
          ensureLogin: async () => {},
          toast(message, icon) {
            toasts.push({ message, icon });
          },
          fullUrl: value => `https://cdn.test${value}`,
          safe: async (value, fallback) => {
            try {
              return await value;
            } catch (_) {
              return fallback;
            }
          },
          upload
        };
      }
      if (id === '../../utils/profile-guard') return { completeProfile, cacheUser };
      throw new Error(`Unexpected dependency: ${id}`);
    },
    getApp: () => app,
    wx: {
      showLoading(options) {
        loading.push({ type: 'show', options: plain(options) });
      },
      hideLoading() {
        loading.push({ type: 'hide' });
      },
      switchTab() {},
      navigateTo() {}
    }
  }, { filename: profileFile });

  const context = {
    data: {
      ...plain(definition.data),
      user: plain(initialUser)
    },
    setData(patch) {
      for (const [key, value] of Object.entries(plain(patch))) {
        const parts = key.split('.');
        let target = this.data;
        while (parts.length > 1) {
          const part = parts.shift();
          target[part] = target[part] || {};
          target = target[part];
        }
        target[parts[0]] = value;
      }
    }
  };
  for (const [key, value] of Object.entries(definition)) {
    if (key !== 'data') context[key] = value;
  }

  return {
    app,
    cachedUsers,
    completedProfiles,
    context,
    loading,
    requests,
    storage,
    toasts
  };
};

test('duplicate nickname events share one pending request', async () => {
  const pending = deferred();
  const { context, requests } = loadPage({
    initialUser: { nickname: '旧昵称' },
    requestImpl: () => pending.promise
  });

  const change = context.onNicknameChange({ detail: { value: '小林' } });
  const blur = context.onNicknameChange({ detail: { value: '小林' } });

  assert.equal(requests.length, 1);

  pending.resolve({ nickname: '小林' });
  await Promise.all([change, blur]);
  assert.equal(context.data.user.nickname, '小林');
});

test('nickname completion persists only the authoritative nickname field', async () => {
  const { context, completedProfiles } = loadPage({
    initialUser: { nickname: '旧昵称', avatar: 'https://cdn.test/new.png' },
    requestImpl: async () => ({ nickname: '小林', avatar: '/stale.png', role: 'stale' })
  });

  await context.onNicknameChange({ detail: { value: '小林' } });

  assert.deepEqual(completedProfiles, [{ nickname: '小林' }]);
  assert.equal(context.data.user.avatar, 'https://cdn.test/new.png');
});

test('nickname local persistence failure shows explicit synchronization feedback', async () => {
  const { context, toasts } = loadPage({
    initialUser: { nickname: '旧昵称' },
    requestImpl: async () => ({ nickname: '小林' }),
    completeProfileImpl: () => {
      throw new Error('local persistence failed');
    }
  });

  await context.onNicknameChange({ detail: { value: '小林' } });

  assert.deepEqual(toasts, [{
    message: '昵称已保存，请重新进入页面同步',
    icon: undefined
  }]);
  assert.equal(context.data.user.nickname, '旧昵称');
});

test('distinct nickname writes are serialized and finish with the latest value', async () => {
  const first = deferred();
  const second = deferred();
  const pending = [first, second];
  const { app, context, completedProfiles, requests, storage } = loadPage({
    initialUser: { nickname: '旧昵称' },
    requestImpl: () => pending.shift().promise
  });

  const firstWrite = context.onNicknameChange({ detail: { value: '小林' } });
  const secondWrite = context.onNicknameChange({ detail: { value: '小周' } });

  assert.equal(requests.length, 1);

  first.resolve({ nickname: '小林' });
  await firstWrite;
  await Promise.resolve();

  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], {
    url: '/api/me/profile',
    options: { method: 'PUT', data: { nickname: '小周' } }
  });

  second.resolve({ nickname: '小周' });
  await secondWrite;

  assert.deepEqual(completedProfiles, [
    { nickname: '小林' },
    { nickname: '小周' }
  ]);
  assert.equal(context.data.user.nickname, '小周');
  assert.equal(app.globalData.user.nickname, '小周');
  assert.equal(storage.get('user').nickname, '小周');
});

test('non-adjacent repeated nickname intent remains queued in A B A order', async () => {
  const first = deferred();
  const second = deferred();
  const third = deferred();
  const pending = [first, second, third];
  const { app, context, requests, storage } = loadPage({
    initialUser: { nickname: '旧昵称' },
    requestImpl: () => pending.shift().promise
  });

  const firstWrite = context.onNicknameChange({ detail: { value: '小林' } });
  const secondWrite = context.onNicknameChange({ detail: { value: '小周' } });
  const thirdWrite = context.onNicknameChange({ detail: { value: '小林' } });

  assert.equal(requests.length, 1);

  first.resolve({ nickname: '小林' });
  await firstWrite;
  await Promise.resolve();
  assert.equal(requests.length, 2);

  second.resolve({ nickname: '小周' });
  await secondWrite;
  await Promise.resolve();
  assert.equal(requests.length, 3);

  third.resolve({ nickname: '小林' });
  await thirdWrite;

  assert.deepEqual(requests.map(call => call.options.data.nickname), [
    '小林',
    '小周',
    '小林'
  ]);
  assert.equal(context.data.user.nickname, '小林');
  assert.equal(app.globalData.user.nickname, '小林');
  assert.equal(storage.get('user').nickname, '小林');
});

test('avatar then nickname completion preserves both newest fields in memory and storage', async () => {
  const nicknameRequest = deferred();
  const avatarRequest = deferred();
  const { app, cachedUsers, context, loading, storage, toasts } = loadPage({
    initialUser: { nickname: '旧昵称', avatar: 'https://cdn.test/old.png' },
    appUser: { nickname: '旧昵称', avatar: '/old.png' },
    uploadImpl: async () => ({ url: '/new.png' }),
    requestImpl: (url, options) => (
      options.data.nickname ? nicknameRequest.promise : avatarRequest.promise
    )
  });

  const nickname = context.onNicknameChange({ detail: { value: '小林' } });
  const avatar = context.onChooseAvatar({ detail: { avatarUrl: '/tmp.png' } });
  await Promise.resolve();
  await Promise.resolve();

  avatarRequest.resolve({ nickname: '旧昵称', avatar: '/new.png' });
  await avatar;
  nicknameRequest.resolve({ nickname: '小林', avatar: '/old.png' });
  await nickname;

  assert.deepEqual(plain(context.data.user), {
    nickname: '小林',
    avatar: 'https://cdn.test/new.png'
  });
  assert.deepEqual(plain(app.globalData.user), {
    nickname: '小林',
    avatar: '/new.png'
  });
  assert.deepEqual(storage.get('user'), {
    nickname: '小林',
    avatar: '/new.png'
  });
  assert.deepEqual(cachedUsers, [{ avatar: '/new.png' }]);
  assert.deepEqual(toasts, [{ message: '头像已更新', icon: 'success' }]);
  assert.deepEqual(loading.map(entry => entry.type), ['show', 'hide']);
});

test('nickname then avatar completion preserves both newest fields in memory and storage', async () => {
  const nicknameRequest = deferred();
  const avatarRequest = deferred();
  const { app, cachedUsers, context, storage } = loadPage({
    initialUser: { nickname: '旧昵称', avatar: 'https://cdn.test/old.png' },
    appUser: { nickname: '旧昵称', avatar: '/old.png' },
    uploadImpl: async () => ({ url: '/new.png' }),
    requestImpl: (url, options) => (
      options.data.nickname ? nicknameRequest.promise : avatarRequest.promise
    )
  });

  const nickname = context.onNicknameChange({ detail: { value: '小林' } });
  const avatar = context.onChooseAvatar({ detail: { avatarUrl: '/tmp.png' } });
  await Promise.resolve();
  await Promise.resolve();

  nicknameRequest.resolve({ nickname: '小林', avatar: '/old.png' });
  await nickname;
  avatarRequest.resolve({ nickname: '旧昵称', avatar: '/new.png' });
  await avatar;

  assert.deepEqual(plain(app.globalData.user), {
    nickname: '小林',
    avatar: '/new.png'
  });
  assert.deepEqual(storage.get('user'), {
    nickname: '小林',
    avatar: '/new.png'
  });
  assert.deepEqual(cachedUsers, [{ avatar: '/new.png' }]);
});

test('avatar cache failure shows explicit feedback and no false success', async () => {
  const originalUser = { nickname: '旧昵称', avatar: '/old.png' };
  const { app, cachedUsers, context, storage, toasts } = loadPage({
    initialUser: { nickname: '旧昵称', avatar: 'https://cdn.test/old.png' },
    appUser: originalUser,
    storedUser: originalUser,
    uploadImpl: async () => ({ url: '/new.png' }),
    requestImpl: async () => ({ avatar: '/new.png' }),
    cacheUserImpl: () => {
      throw new Error('local cache failed');
    }
  });

  await context.onChooseAvatar({ detail: { avatarUrl: '/tmp.png' } });

  assert.deepEqual(cachedUsers, [{ avatar: '/new.png' }]);
  assert.deepEqual(plain(app.globalData.user), originalUser);
  assert.deepEqual(storage.get('user'), originalUser);
  assert.deepEqual(toasts, [{
    message: '头像已保存，请重新进入页面同步',
    icon: undefined
  }]);
});
