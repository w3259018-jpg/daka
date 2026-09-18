const { request, ensureLogin, toast, fullUrl, safe, upload } = require('../../utils/api');
const { completeProfile, cacheUser } = require('../../utils/profile-guard');

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
    let remoteUrl;
    try {
      const result = await upload(tmp);
      remoteUrl = result && (result.url || result.path);
      if (!remoteUrl) throw new Error('upload no url');
      await request('/api/me/profile', { method: 'PUT', data: { avatar: remoteUrl } });
    } catch (_) {
      wx.hideLoading();
      toast('头像上传失败');
      return;
    }

    try {
      cacheUser({ avatar: remoteUrl });
      const fullAvatar = fullUrl(remoteUrl);
      this.setData({ 'user.avatar': fullAvatar });
      wx.hideLoading();
      toast('头像已更新', 'success');
    } catch (_) {
      wx.hideLoading();
      toast('头像已保存，请重新进入页面同步');
    }
  },

  async onNicknameChange(e) {
    const val = ((e && e.detail && e.detail.value) || '').trim();
    if (!val) return;

    const writes = this._nicknameWrites || (this._nicknameWrites = []);
    const tail = writes[writes.length - 1];
    if (tail && tail.value === val) return tail.promise;
    if (!writes.length && val === this.data.user.nickname) return;

    const save = async () => {
      let saved;
      try {
        saved = await request('/api/me/profile', {
          method: 'PUT',
          data: { nickname: val }
        });
      } catch (_) {
        // request() 已展示错误提示。
        return;
      }

      try {
        const user = completeProfile({ nickname: saved.nickname });
        this.setData({ 'user.nickname': user.nickname });
      } catch (_) {
        toast('昵称已保存，请重新进入页面同步');
      }
    };

    const previous = this._nicknameWriteTail;
    const write = { value: val, promise: null };
    writes.push(write);
    write.promise = previous
      ? previous.catch(() => {}).then(save)
      : save();
    this._nicknameWriteTail = write.promise;

    const cleanup = () => {
      const index = writes.indexOf(write);
      if (index !== -1) writes.splice(index, 1);
      if (this._nicknameWriteTail === write.promise) this._nicknameWriteTail = null;
    };
    write.promise.then(cleanup, cleanup);
    return write.promise;
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
