const { request, ensureLogin, safe } = require('../../utils/api');

Page({
  data: { tasks: [], names: [], idx: 0, list: [] },

  async onShow() {
    await ensureLogin();
    const tasks = await safe(request('/api/tasks'), []);
    const cur = wx.getStorageSync('curTaskId');
    let idx = cur ? Math.max(0, tasks.findIndex(t => t.id === cur)) : 0;
    if (idx < 0) idx = 0;
    this.setData({ tasks, names: tasks.map(t => t.name), idx });
    if (tasks.length) this.load(tasks[idx].id);
    else this.setData({ list: [] });
  },

  pick(e) {
    const idx = +e.detail.value;
    this.setData({ idx });
    this.load(this.data.tasks[idx].id);
  },

  async load(taskId) {
    wx.setStorageSync('curTaskId', taskId);
    const list = await safe(request(`/api/tasks/${taskId}/rank`), []);
    this.setData({ list });
  }
});
