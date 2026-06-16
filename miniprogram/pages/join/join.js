const { request, ensureLogin, toast } = require('../../utils/api');

Page({
  data: { code: '', taskId: 0, taskName: '', realName: '', genders: ['男','女','其他'], gIdx: 0, age: '' },

  async onLoad(q) {
    await ensureLogin();
    const code = (q.code || '').toUpperCase();
    let taskId = +q.id || 0, taskName = decodeURIComponent(q.name || '');
    if (code && !taskId) {
      try { const t = await request('/api/tasks/by-code/' + encodeURIComponent(code)); taskId = t.id; taskName = t.name; }
      catch { return toast('邀请码无效'); }
    }
    this.setData({ code, taskId, taskName });
  },

  onInput(e) { this.setData({ [e.currentTarget.dataset.k]: e.detail.value }); },
  pickG(e) { this.setData({ gIdx: +e.detail.value }); },

  async submit() {
    const { code, realName, genders, gIdx, age, taskId } = this.data;
    if (!realName.trim()) return toast('请填写姓名');
    try {
      await request('/api/tasks/join', { method: 'POST',
        data: { invite_code: code, real_name: realName, gender: genders[gIdx], age } });
      toast('加入成功', 'success');
      setTimeout(() => wx.redirectTo({ url: '/pages/task/task?id=' + taskId }), 600);
    } catch (e) { toast(e.err || '加入失败'); }
  }
});
