const { apiBase, env } = require('./utils/config');

App({
  globalData: {
    apiBase,
    env,
    token: '',
    user: null,
    loginReady: null
  },

  onLaunch() {
    const t = wx.getStorageSync('token');
    const u = wx.getStorageSync('user');
    if (t) { this.globalData.token = t; this.globalData.user = u; }
    this.globalData.loginReady = this.silentLogin();
  },

  // 任何未捕获的 promise 拒绝，吞下并打印 warn，避免冒红色 MiniProgramError
  onUnhandledRejection({ reason }) {
    const msg = (reason && (reason.err || reason.errMsg || reason.message)) || reason;
    console.warn('[unhandled rejection]', msg);
  },

  onError(err) { console.warn('[app error]', err); },

  // 静默登录：用 wx.login 拿到的 code 换后端 token；不再弹窗申请用户授权。
  // 同一个微信用户每次都会被后端按 openid/unionid 命中同一个账号。
  silentLogin() {
    return this._loginAttempt(0);
  },

  _loginAttempt(attempt) {
    return new Promise((resolve) => {
      wx.login({
        timeout: 30000,
        success: ({ code }) => {
          if (!code) return resolve(this.globalData.user);
          wx.request({
            url: this.globalData.apiBase + '/api/login',
            method: 'POST',
            data: { code },
            timeout: 30000,
            header: { 'content-type': 'application/json' },
            success: (r) => {
              if (r.statusCode < 300 && r.data && r.data.token) {
                this.globalData.token = r.data.token;
                this.globalData.user = r.data.user;
                wx.setStorageSync('token', r.data.token);
                wx.setStorageSync('user', r.data.user);
                return resolve(r.data.user);
              }
              this._retryOrGiveUp(attempt, resolve);
            },
            fail: () => this._retryOrGiveUp(attempt, resolve)
          });
        },
        fail: () => this._retryOrGiveUp(attempt, resolve)
      });
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

  // 401 时由 utils/api.js 调用，重新触发一次静默登录
  refreshLogin() {
    this.globalData.loginReady = this.silentLogin();
    return this.globalData.loginReady;
  }
});
