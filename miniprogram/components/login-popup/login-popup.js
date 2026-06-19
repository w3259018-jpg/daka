const { request } = require('../../utils/api');
const {
  createFallbackNickname,
  cacheUser,
  setGuestMode
} = require('../../utils/profile-guard');

Component({
  properties: {
    show: {
      type: Boolean,
      value: false
    }
  },

  data: {
    nickname: '',
    loading: false
  },

  methods: {
    onNicknameInput(event) {
      const detail = event && event.detail;
      this.setData({ nickname: (detail && detail.value) || '' });
    },

    async onConfirm() {
      if (this.data.loading) return;

      const nickname = this.data.nickname.trim() || createFallbackNickname();
      this.setData({ loading: true });

      try {
        let saved;
        try {
          saved = await request('/api/me/profile', {
            method: 'PUT',
            data: { nickname }
          });
        } catch (_) {
          // request() already displays the request error toast.
          return;
        }

        try {
          const user = cacheUser(saved);
          setGuestMode(false);
          this.triggerEvent('profilesuccess', { user });
        } catch (_) {
          wx.showToast({ title: '资料保存失败，请重试', icon: 'none' });
        }
      } finally {
        this.setData({ loading: false });
      }
    },

    onSkip() {
      if (this.data.loading) return;
      try {
        setGuestMode(true);
        this.triggerEvent('skipsuccess');
      } catch (_) {
        wx.showToast({
          title: '暂时无法进入游客模式，请重试',
          icon: 'none'
        });
      }
    },

    openAgreement() {
      wx.navigateTo({ url: '/pages/agreement/agreement' });
    },

    openPrivacy() {
      wx.navigateTo({ url: '/pages/privacy/privacy' });
    },

    stop() {}
  }
});
