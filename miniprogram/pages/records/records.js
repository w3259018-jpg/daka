const { request, ensureLogin, safe, toast } = require('../../utils/api');
const { requireProfile, profilePopupHandlers } = require('../../utils/profile-guard');

const formatRecord = (record) => ({
  id: record.id,
  item_id: record.item_id,
  item_title: record.item_title || '',
  note: record.note || '',
  watched_at: record.watched_at || 0,
  submitted_at: record.submitted_at || 0,
  date: record.submitted_at ? new Date(record.submitted_at).toLocaleString('zh-CN') : ''
});

Page({
  ...profilePopupHandlers,

  data: {
    tasks: [],
    names: [],
    idx: 0,
    taskId: 0,
    startDate: '',
    endDate: '',
    records: [],
    filtered: [],
    selected: {},
    overview: { tasks: 0, records: 0, selected: 0 },
    showLoginPopup: false
  },

  async onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 2 });

    await ensureLogin();
    await this.loadTasks();
  },

  async onPullDownRefresh() {
    await this.loadTasks();
    wx.stopPullDownRefresh();
  },

  async loadTasks() {
    const tasks = await safe(request('/api/tasks'), []);
    const names = tasks.map(task => task.name);
    const cur = wx.getStorageSync('curTaskId');
    let idx = cur ? tasks.findIndex(task => task.id === cur) : 0;
    if (idx < 0) idx = 0;

    this.setData({
      tasks,
      names,
      idx,
      overview: {
        tasks: tasks.length,
        records: tasks.reduce((sum, task) => sum + Number(task.my_completed_count || 0), 0),
        selected: 0
      }
    });

    if (tasks.length) {
      await this.loadRecords(tasks[idx].id);
    } else {
      this.setData({ taskId: 0, records: [], filtered: [], selected: {} });
    }
  },

  pickTask(e) {
    const idx = +e.detail.value;
    const task = this.data.tasks[idx];
    if (!task) return;
    this.setData({ idx });
    this.loadRecords(task.id);
  },

  pickStart(e) {
    this.setData({ startDate: e.detail.value }, () => this.applyFilter());
  },

  pickEnd(e) {
    this.setData({ endDate: e.detail.value }, () => this.applyFilter());
  },

  clearDate() {
    this.setData({ startDate: '', endDate: '' }, () => this.applyFilter());
  },

  async loadRecords(taskId) {
    wx.setStorageSync('curTaskId', taskId);
    const records = (await safe(request(`/api/tasks/${taskId}/my-records`), [])).map(formatRecord);
    this.setData({ taskId, records, selected: {} });
    this.applyFilter();
  },

  applyFilter() {
    const { records, startDate, endDate } = this.data;
    const filtered = records.filter(record => {
      const day = new Date(record.submitted_at).toISOString().slice(0, 10);
      if (startDate && day < startDate) return false;
      if (endDate && day > endDate) return false;
      return true;
    });
    const selected = {};
    filtered.forEach(record => {
      if (this.data.selected[record.id]) selected[record.id] = true;
    });
    this.setData({
      filtered,
      selected,
      overview: {
        ...this.data.overview,
        selected: Object.keys(selected).length
      }
    });
  },

  toggle(e) {
    const id = +e.currentTarget.dataset.id;
    const selected = { ...this.data.selected, [id]: !this.data.selected[id] };
    const selectedCount = Object.keys(selected).filter(k => selected[k]).length;
    this.setData({
      selected,
      overview: { ...this.data.overview, selected: selectedCount }
    });
  },

  async exportNotes() {
    if (!requireProfile(this)) return;
    if (!this.data.taskId) return toast('请选择任务');
    const ids = Object.keys(this.data.selected).filter(k => this.data.selected[k]).map(Number);
    wx.showLoading({ title: '生成中' });
    try {
      const result = await request(`/api/tasks/${this.data.taskId}/export`, {
        method: 'POST',
        data: { record_ids: ids }
      });
      wx.hideLoading();
      this.handleExport(result.content_base64, result.filename);
    } catch (_) {
      wx.hideLoading();
    }
  },

  handleExport(contentBase64, filename) {
    if (!contentBase64) return toast('导出失败');
    const safeName = String(filename || 'export.md').replace(/[\\/]/g, '') || 'export.md';
    const filePath = `${wx.env.USER_DATA_PATH}/${safeName}`;
    wx.getFileSystemManager().writeFile({
      filePath,
      data: contentBase64,
      encoding: 'base64',
      success: () => wx.openDocument({
        filePath,
        showMenu: true,
        fail: () => wx.setClipboardData({
          data: filePath,
          success: () => toast('文件路径已复制', 'success')
        })
      }),
      fail: () => toast('保存失败')
    });
  }
});
