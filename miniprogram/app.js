const { apiBase, cloudEnv, env, useCloud } = require('./utils/config');

const callCloudApi = (url, opts = {}) => new Promise((resolve, reject) => {
  if (!wx.cloud || !wx.cloud.callFunction) {
    reject({ err: 'cloud unavailable' });
    return;
  }
  wx.cloud.callFunction({
    name: 'api',
    data: {
      url,
      method: opts.method || 'GET',
      data: opts.data || {}
    },
    success: (r) => resolve((r && r.result) || {}),
    fail: (e) => reject(e)
  });
});

App({
  globalData: {
    apiBase,
    cloudEnv,
    env,
    useCloud,
    token: '',
    user: null,
    guestMode: false,
    loginReady: null
  },

  onLaunch() {
    if (useCloud && wx.cloud && wx.cloud.init) {
      wx.cloud.init({ env: cloudEnv, traceUser: true });
    }

    this.globalData.guestMode = !!wx.getStorageSync('guestMode');
    const cachedUser = wx.getStorageSync('user');
    if (cachedUser) this.globalData.user = cachedUser;

    setTimeout(() => {
      this.globalData.loginReady = this.silentLogin();
    }, 300);
    this._registerPrivacyHandler();
  },

  _registerPrivacyHandler() {
    if (!wx.onNeedPrivacyAuthorization) return;
    wx.onNeedPrivacyAuthorization((resolve) => {
      const pages = (typeof getCurrentPages === 'function') ? getCurrentPages() : [];
      for (let i = pages.length - 1; i >= 0; i--) {
        const page = pages[i];
        const popup = page && page.selectComponent && page.selectComponent('.privacy-popup');
        if (popup && typeof popup.show === 'function') {
          popup.show(resolve);
          return;
        }
      }
      if (this._privacyPopup && typeof this._privacyPopup.show === 'function') {
        this._privacyPopup.show(resolve);
      } else {
        resolve({ event: 'disagree' });
      }
    });
  },

  onUnhandledRejection({ reason }) {
    const msg = (reason && (reason.err || reason.errMsg || reason.message)) || reason;
    console.warn('[unhandled rejection]', msg);
  },

  onError(err) {
    console.warn('[app error]', err);
  },

  silentLogin() {
    return this._loginAttempt(0);
  },

  _loginAttempt(attempt) {
    return new Promise((resolve) => {
      callCloudApi('/api/login', { method: 'POST' }).then((r) => {
        const data = r && r.statusCode < 300 ? r.data : null;
        if (data && data.token) {
          this.globalData.token = data.token;
          this.globalData.user = data.user;
          wx.setStorageSync('token', data.token);
          wx.setStorageSync('user', data.user);
          return resolve(data.user);
        }
        this._retryOrGiveUp(attempt, resolve);
      }).catch(() => this._retryOrGiveUp(attempt, resolve));
    });
  },

  _retryOrGiveUp(attempt, resolve) {
    if (attempt < 1) {
      setTimeout(() => this._loginAttempt(attempt + 1).then(resolve), 800);
    } else {
      console.warn('[silentLogin] giving up after retries');
      resolve(this.globalData.user);
    }
  },

  refreshLogin() {
    this.globalData.loginReady = this.silentLogin();
    return this.globalData.loginReady;
  }
});
