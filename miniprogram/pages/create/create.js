const { request, ensureLogin, toast, secCheck } = require('../../utils/api');

Page({
  data: { name: '', startDate: '', endDate: '' },

  async onShow() { await ensureLogin(); },

  onInput(e) { this.setData({ [e.currentTarget.dataset.k]: e.detail.value }); },
  pickStart(e) { this.setData({ startDate: e.detail.value }); },
  pickEnd(e) { this.setData({ endDate: e.detail.value }); },

  async createTask() {
    const { name, startDate, endDate } = this.data;
    const trimmed = name.trim();
    if (!trimmed) return toast('请填写任务名称');
    wx.showLoading({ title: '审核中', mask: true });
    const sec = await secCheck(trimmed);
    if (!sec.safe) {
      wx.hideLoading();
      return toast(sec.reason || '任务名称可能含有违规信息，请修改');
    }
    try {
      await request('/api/tasks', { method: 'POST', data: { name: trimmed, start_date: startDate, end_date: endDate } });
      wx.hideLoading();
      toast('任务已创建', 'success');
      setTimeout(() => wx.switchTab({ url: '/pages/tasks/tasks' }), 600);
    } catch (_) { wx.hideLoading(); /* toast 已提示 */ }
  }
});
