const app = getApp();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ensureLogin = () => {
  if (app.globalData.token) return Promise.resolve(app.globalData.user);
  if (app.globalData.loginReady) return app.globalData.loginReady;
  return app.refreshLogin();
};

// 单次请求，不做业务级处理
const callOnce = (url, opts = {}) => new Promise((resolve, reject) => {
  wx.request({
    url: app.globalData.apiBase + url,
    method: opts.method || 'GET',
    data: opts.data,
    timeout: opts.timeout || 30000,
    header: {
      'content-type': 'application/json',
      ...(app.globalData.token && { Authorization: 'Bearer ' + app.globalData.token })
    },
    success: r => resolve(r),
    fail: e => resolve({ statusCode: 0, data: null, errMsg: (e && e.errMsg) || 'request:fail' })
  });
});

// 网络层失败自动重试，避免冷启动 / 弱网首次超时直接报错
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
    return Promise.reject({ status: 0, err: r.errMsg || '网络异常', data: null });
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

const upload = (filePath) => new Promise((resolve, reject) => {
  wx.uploadFile({
    url: app.globalData.apiBase + '/api/upload',
    filePath, name: 'file',
    timeout: 60000,
    header: { Authorization: 'Bearer ' + app.globalData.token },
    success: res => { try { resolve(JSON.parse(res.data)); } catch { reject(res); } },
    fail: e => reject({ status: 0, err: (e && e.errMsg) || 'upload:fail', data: null })
  });
});

const toast = (title, icon = 'none') => wx.showToast({ title, icon });
const fullUrl = (u) => (u && u.startsWith('http')) ? u : (app.globalData.apiBase + (u || ''));

// 安全 await：把异常吞掉返回 fallback，避免页面里大量 try/catch 模板代码
const safe = (p, fallback) => p.then(v => (v == null ? fallback : v), () => fallback);

module.exports = { request, ensureLogin, upload, toast, fullUrl, safe };
