const { request, ensureLogin, toast, fullUrl, safe } = require('../../utils/api');

Page({
  data: { user: {}, tasks: [], names: [], idx: 0, taskId: 0,
          startDate: '', endDate: '', records: [], filtered: [], selected: {} },

  async onShow() {
    await ensureLogin();
    const [user, tasks] = await Promise.all([
      safe(request('/api/me'), this.data.user || {}),
      safe(request('/api/tasks'), [])
    ]);
    const cur = wx.getStorageSync('curTaskId');
    let idx = cur ? Math.max(0, tasks.findIndex(t => t.id === cur)) : 0;
    if (idx < 0) idx = 0;
    this.setData({ user, tasks, names: tasks.map(t => t.name), idx });
    if (tasks.length) this.load(tasks[idx].id);
  },

  pick(e) { const idx = +e.detail.value; this.setData({ idx }); this.load(this.data.tasks[idx].id); },
  pickStart(e) { this.setData({ startDate: e.detail.value }, () => this.applyFilter()); },
  pickEnd(e)   { this.setData({ endDate: e.detail.value }, () => this.applyFilter()); },
  clearDate()  { this.setData({ startDate: '', endDate: '' }, () => this.applyFilter()); },

  async load(taskId) {
    wx.setStorageSync('curTaskId', taskId);
    const records = await safe(request(`/api/tasks/${taskId}/my-records`), []);
    this.setData({ taskId, records, selected: {} });
    this.applyFilter();
  },

  applyFilter() {
    const { records, startDate, endDate } = this.data;
    const inRange = (ms) => {
      const d = new Date(ms).toISOString().slice(0, 10);
      if (startDate && d < startDate) return false;
      if (endDate && d > endDate) return false;
      return true;
    };
    const filtered = records.filter(r => inRange(r.submitted_at)).map(r => ({
      ...r, date: new Date(r.submitted_at).toLocaleString('zh-CN')
    }));
    this.setData({ filtered });
  },

  toggle(e) {
    const id = +e.currentTarget.dataset.id;
    const selected = { ...this.data.selected, [id]: !this.data.selected[id] };
    this.setData({ selected });
  },

  async exportNotes() {
    if (!this.data.taskId) return;
    const ids = Object.keys(this.data.selected).filter(k => this.data.selected[k]).map(Number);
    wx.showLoading({ title: '生成中' });
    try {
      const r = await request(`/api/tasks/${this.data.taskId}/export`, { method: 'POST', data: { record_ids: ids } });
      wx.hideLoading();
      this.handleExport(fullUrl(r.url), r.filename);
    } catch (e) { wx.hideLoading(); /* toast 已提示 */ }
  },

  handleExport(url, filename) {
    wx.showActionSheet({
      itemList: ['保存到本地', '复制链接（可粘贴到微信笔记）'],
      success: ({ tapIndex }) => {
        if (tapIndex === 0) {
          wx.downloadFile({ url, success: r => {
            if (r.statusCode !== 200) return toast('下载失败');
            wx.saveFile({ tempFilePath: r.tempFilePath,
              success: s => { toast('已保存：' + s.savedFilePath, 'success');
                wx.openDocument({ filePath: s.savedFilePath, showMenu: true, fail: () => {} }); },
              fail: () => toast('保存失败')
            });
          }, fail: () => toast('下载失败') });
        } else {
          wx.setClipboardData({ data: url, success: () => toast('链接已复制', 'success') });
        }
      }
    });
  },

  goPost(e) { const id = e.currentTarget.dataset.id; if (id) wx.navigateTo({ url: '/pages/post/post?id=' + id }); },

  goPrivacy() { wx.navigateTo({ url: '/pages/privacy/privacy' }); },
  goAgreement() { wx.navigateTo({ url: '/pages/agreement/agreement' }); }
});
