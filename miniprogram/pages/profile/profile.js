const { request, ensureLogin, toast, fullUrl, safe, upload } = require('../../utils/api');

Page({
  data: {
    user: {},
    tasks: [],
    overview: { tasks: 0, completed: 0, managed: 0 }
  },

  async onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 3 });

    await ensureLogin();
    await this.load();
  },

  async load() {
    const [user, tasks] = await Promise.all([
      safe(request('/api/me'), this.data.user || {}),
      safe(request('/api/tasks'), [])
    ]);
    const app = getApp();
    const userWithUrl = { ...user, avatar: user && user.avatar ? fullUrl(user.avatar) : '' };
    this.setData({
      user: userWithUrl,
      tasks,
      overview: {
        tasks: tasks.length,
        completed: tasks.reduce((sum, task) => sum + Number(task.my_completed_count || 0), 0),
        managed: tasks.filter(task => task.role === 'admin').length
      }
    });
    if (app && app.globalData) {
      app.globalData.user = { ...(app.globalData.user || {}), ...user };
    }
  },

  async onChooseAvatar(e) {
    const tmp = e && e.detail && e.detail.avatarUrl;
    if (!tmp) return;

    this.setData({ 'user.avatar': tmp });
    wx.showLoading({ title: '上传中', mask: true });
    try {
      const result = await upload(tmp);
      const remoteUrl = result && (result.url || result.path);
      if (!remoteUrl) throw new Error('upload no url');
      await request('/api/me/profile', { method: 'PUT', data: { avatar: remoteUrl } });
      const fullAvatar = fullUrl(remoteUrl);
      this.setData({ 'user.avatar': fullAvatar });
      const app = getApp();
      if (app && app.globalData) {
        app.globalData.user = { ...(app.globalData.user || {}), avatar: remoteUrl };
      }
      wx.hideLoading();
      toast('头像已更新', 'success');
    } catch (_) {
      wx.hideLoading();
      toast('头像上传失败');
    }
  },

  async onNicknameChange(e) {
    const val = ((e && e.detail && e.detail.value) || '').trim();
    if (!val || val === this.data.user.nickname) return;

    try {
      const user = await request('/api/me/profile', { method: 'PUT', data: { nickname: val } });
      this.setData({ 'user.nickname': user.nickname });
      const app = getApp();
      if (app && app.globalData) {
        app.globalData.user = { ...(app.globalData.user || {}), nickname: user.nickname };
      }
    } catch (_) {
      // request() 已展示错误提示。
    }
  },

  goRecords() {
    wx.switchTab({ url: '/pages/records/records' });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  goAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement' });
  }
});
