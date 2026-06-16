// 全局隐私授权弹窗组件
// 通过 getApp()._privacyPopup 暴露给 app.js 中 wx.onNeedPrivacyAuthorization 调用
Component({
  data: {
    show: false,
    privacyContractName: '《隐私保护指引》'
  },
  lifetimes: {
    attached() {
      const app = getApp();
      if (app) app._privacyPopup = this;
      try {
        if (wx.getPrivacySetting) {
          wx.getPrivacySetting({
            success: (r) => {
              if (r && r.privacyContractName) {
                this.setData({ privacyContractName: '《' + r.privacyContractName + '》' });
              }
            },
            fail: () => {}
          });
        }
      } catch (_) {}
    },
    detached() {
      const app = getApp();
      if (app && app._privacyPopup === this) app._privacyPopup = null;
    }
  },
  methods: {
    show(resolve) {
      this._resolve = resolve;
      this.setData({ show: true });
    },
    onAgree() {
      this.setData({ show: false });
      const r = this._resolve;
      this._resolve = null;
      if (r) r({ event: 'agree', buttonId: 'agree-btn' });
    },
    onDisagree() {
      this.setData({ show: false });
      const r = this._resolve;
      this._resolve = null;
      if (r) r({ event: 'disagree' });
    },
    openContract() {
      if (wx.openPrivacyContract) {
        wx.openPrivacyContract({ fail: () => {} });
      } else {
        wx.navigateTo({ url: '/pages/privacy/privacy' });
      }
    },
    stop() {}
  }
});
