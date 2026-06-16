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
    if (t) {
      this.globalData.token = t;
      this.globalData.user = u;
      this.globalData.loginReady = Promise.resolve(u);
    } else {
    // 延迟 300ms 触发登录，避开开发者工具早期网络初始化问题
      setTimeout(() => {
        this.globalData.loginReady = this.silentLogin();
      }, 300);
    }
    this._registerPrivacyHandler();
  },

  // 隐私授权弹窗：当用户首次调用 chooseMedia/chooseMessageFile/uploadFile/saveFile/setClipboardData 等隐私 API
  // 时，微信会触发该回调。我们交给 components/privacy-popup 渲染自定义弹窗（含 open-type="agreePrivacyAuthorization" 按钮）。
  // 优先从栈顶页面 selectComponent 查找弹窗，找不到再回退到全局缓存引用。
  _registerPrivacyHandler() {
    if (!wx.onNeedPrivacyAuthorization) return;
    wx.onNeedPrivacyAuthorization((resolve) => {
      const pages = (typeof getCurrentPages === 'function') ? getCurrentPages() : [];
      for (let i = pages.length - 1; i >= 0; i--) {
        const p = pages[i];
        const popup = p && p.selectComponent && p.selectComponent('.privacy-popup');
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
