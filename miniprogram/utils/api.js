const app = getApp();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const ensureLogin = () => {
  if (app.globalData.token) return Promise.resolve(app.globalData.user);
  if (app.globalData.loginReady) return app.globalData.loginReady;
  return app.refreshLogin();
};

const callCloud = (url, opts = {}) => new Promise((resolve) => {
  if (!wx.cloud || !wx.cloud.callFunction) {
    resolve({ statusCode: 0, data: null, errMsg: 'cloud:fail unavailable' });
    return;
  }
  wx.cloud.callFunction({
    name: 'api',
    data: {
      url,
      method: opts.method || 'GET',
      data: opts.data || {}
    },
    success: (r) => {
      const result = (r && r.result) || {};
      if (typeof result.statusCode === 'number') resolve(result);
      else resolve({ statusCode: 200, data: result });
    },
    fail: e => resolve({ statusCode: 0, data: null, errMsg: (e && e.errMsg) || 'cloud:fail' })
  });
});

const callOnce = (url, opts = {}) => callCloud(url, opts);

const rawRequest = async (url, opts = {}) => {
  const maxRetry = opts.method && opts.method !== 'GET' ? 0 : 1;
  let r = await callOnce(url, opts);
  let attempt = 0;
  while (r.statusCode === 0 && attempt < maxRetry) {
    attempt++;
    await sleep(600);
    r = await callOnce(url, opts);
  }
  if (r.statusCode === 0) {
    return Promise.reject({ status: 0, err: r.errMsg || 'network error', data: null });
  }
  if (r.statusCode < 300) return r.data;
  const err = (r.data && r.data.err) || ('http ' + r.statusCode);
  return Promise.reject({ status: r.statusCode, err, data: r.data });
};

const request = async (url, opts = {}) => {
  if (!app.globalData.token && url !== '/api/login') {
    await ensureLogin();
  }
  try {
    return await rawRequest(url, opts);
  } catch (e) {
    if (e.status === 401 && url !== '/api/login' && !opts._retried) {
      try { await app.refreshLogin(); } catch (_) {}
      try {
        return await rawRequest(url, { ...opts, _retried: true });
      } catch (err) {
        if (!opts._silent) wx.showToast({ title: err.err || '请稍后重试', icon: 'none' });
        return Promise.reject(err);
      }
    }
    if (!opts._silent) {
      const tip = e.status === 0 ? '网络异常，请稍后重试' : (e.err || ('http ' + e.status));
      wx.showToast({ title: tip, icon: 'none' });
    }
    return Promise.reject(e);
  }
};

const cloudPathFor = (filePath, originalName) => {
  const source = String(originalName || filePath || '');
  const match = /\.([A-Za-z0-9]+)(?:[?#].*)?$/.exec(source);
  const ext = match ? `.${match[1].toLowerCase()}` : '';
  const rand = Math.random().toString(16).slice(2, 10);
  return `uploads/${Date.now()}_${rand}${ext}`;
};

const uploadCloud = (filePath, options = {}) => new Promise((resolve, reject) => {
  if (!wx.cloud || !wx.cloud.uploadFile) {
    reject({ status: 0, err: 'cloud upload unavailable', data: null });
    return;
  }
  wx.cloud.uploadFile({
    cloudPath: cloudPathFor(filePath, options.originalName),
    filePath,
    success: res => resolve({ url: res.fileID, fileID: res.fileID }),
    fail: e => reject({ status: 0, err: (e && e.errMsg) || 'upload:fail', data: null })
  });
});

const upload = (filePath, options = {}) => uploadCloud(filePath, options);

const toast = (title, icon = 'none') => wx.showToast({ title, icon });

const fullUrl = (u) => {
  if (!u) return '';
  if (/^(https?:)?\/\//.test(u) || u.startsWith('cloud://')) return u;
  return u;
};

const safe = (p, fallback) => p.then(v => (v == null ? fallback : v), () => fallback);

const secCheck = async (text) => {
  const content = (text || '').trim();
  if (!content) return { safe: true };
  try {
    const r = await request('/api/sec-check', { method: 'POST', data: { content }, _silent: true });
    return { safe: r && r.safe !== false, reason: (r && r.reason) || '' };
  } catch (_) {
    return { safe: true };
  }
};

module.exports = { request, ensureLogin, upload, toast, fullUrl, safe, secCheck };
