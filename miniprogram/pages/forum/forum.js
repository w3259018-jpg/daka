const { request, ensureLogin, toast, safe } = require('../../utils/api');

Page({
  data: { tasks: [], names: [], idx: 0, taskId: 0, posts: [], showAdd: false, content: '' },

  async onShow() {
    await ensureLogin();
    const tasks = await safe(request('/api/tasks'), []);
    const cur = wx.getStorageSync('curTaskId');
    let idx = cur ? Math.max(0, tasks.findIndex(t => t.id === cur)) : 0;
    if (idx < 0) idx = 0;
    this.setData({ tasks, names: tasks.map(t => t.name), idx });
    if (tasks.length) await this.load(tasks[idx].id);
  },

  pick(e) {
    const idx = +e.detail.value;
    this.setData({ idx });
    this.load(this.data.tasks[idx].id);
  },

  async load(taskId) {
    const posts = await safe(request(`/api/tasks/${taskId}/posts`), []);
    this.setData({ taskId, posts });
    wx.setStorageSync('curTaskId', taskId);
  },

  toggleAdd() { this.setData({ showAdd: !this.data.showAdd, content: '' }); },
  onInput(e) { this.setData({ content: e.detail.value }); },

  async post() {
    if (!this.data.content.trim()) return toast('内容不能为空');
    try {
      await request(`/api/tasks/${this.data.taskId}/posts`, { method: 'POST', data: { content: this.data.content } });
      this.setData({ showAdd: false, content: '' });
      this.load(this.data.taskId);
    } catch (_) { /* toast 已提示 */ }
  },

  async like(e) {
    const id = +e.currentTarget.dataset.id;
    try {
      const r = await request(`/api/posts/${id}/like`, { method: 'POST' });
      const posts = this.data.posts.map(p => p.id === id
        ? { ...p, liked: r.liked, likes: p.likes + (r.liked ? 1 : -1) } : p);
      this.setData({ posts });
    } catch (_) { /* toast 已提示 */ }
  },

  open(e) { wx.navigateTo({ url: '/pages/post/post?id=' + e.currentTarget.dataset.id }); }
});
