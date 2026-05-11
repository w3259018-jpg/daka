const { request, ensureLogin, toast, safe } = require('../../utils/api');

Page({
  data: { tasks: [], showCreate: false, name: '', startDate: '', endDate: '',
          showJoin: false, joinCode: '' },

  async onShow() {
    await ensureLogin();
    const tasks = await safe(request('/api/tasks'), []);
    this.setData({ tasks });
  },

  onInput(e) { this.setData({ [e.currentTarget.dataset.k]: e.detail.value }); },
  pickStart(e) { this.setData({ startDate: e.detail.value }); },
  pickEnd(e)   { this.setData({ endDate: e.detail.value }); },
  toggleCreate() { this.setData({ showCreate: !this.data.showCreate, showJoin: false }); },
  toggleJoin()   { this.setData({ showJoin: !this.data.showJoin, showCreate: false }); },

  async create() {
    const { name, startDate, endDate } = this.data;
    if (!name) return toast('请填写任务名称');
    try {
      await request('/api/tasks', { method: 'POST', data: { name, start_date: startDate, end_date: endDate } });
      toast('已创建', 'success');
      this.setData({ showCreate: false, name: '', startDate: '', endDate: '' });
      this.onShow();
    } catch (_) { /* toast 已提示 */ }
  },

  async join() {
    const code = (this.data.joinCode || '').trim().toUpperCase();
    if (!code) return;
    try {
      const t = await request('/api/tasks/by-code/' + code);
      wx.navigateTo({ url: `/pages/join/join?code=${code}&id=${t.id}&name=${encodeURIComponent(t.name)}` });
    } catch (_) { /* toast 已提示 */ }
  },

  open(e) { wx.navigateTo({ url: '/pages/task/task?id=' + e.currentTarget.dataset.id }); }
});
