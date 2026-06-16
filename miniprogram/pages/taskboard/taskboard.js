const { request, ensureLogin, safe } = require('../../utils/api');

const formatDateRange = (task) => {
  const start = task.start_date || '不限';
  const end = task.end_date || '不限';
  return `${start} - ${end}`;
};

const normalizeTask = (task) => {
  const total = Number(task.item_count || 0);
  const completed = Number(task.my_completed_count || 0);
  const role = task.role === 'admin' ? 'admin' : 'member';

  return {
    ...task,
    role,
    roleText: role === 'admin' ? '管理员' : '成员',
    dateText: formatDateRange(task),
    progressText: `${completed}/${total}`,
    currentTitle: task.current_item ? task.current_item.title : '暂无待打卡内容',
    progressPercent: total ? Math.min(100, Math.round(completed * 100 / total)) : 0
  };
};

Page({
  data: {
    participating: [],
    managed: [],
    totalCount: 0,
    showJoin: false,
    joinCode: ''
  },

  async onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 1 });

    await ensureLogin();
    await this.load();
  },

  async onPullDownRefresh() {
    await this.load();
    wx.stopPullDownRefresh();
  },

  async load() {
    const tasks = (await safe(request('/api/tasks'), [])).map(normalizeTask);
    this.setData({
      participating: tasks.filter(task => task.role !== 'admin'),
      managed: tasks.filter(task => task.role === 'admin'),
      totalCount: tasks.length
    });
  },

  onInput(e) {
    this.setData({ [e.currentTarget.dataset.k]: e.detail.value });
  },

  toggleJoin() {
    this.setData({ showJoin: !this.data.showJoin });
  },

  async join() {
    const code = (this.data.joinCode || '').trim().toUpperCase();
    if (!code) {
      wx.showToast({ title: '请输入邀请码', icon: 'none' });
      return;
    }

    try {
      const task = await request('/api/tasks/by-code/' + encodeURIComponent(code));
      wx.navigateTo({
        url: `/pages/join/join?code=${encodeURIComponent(code)}&id=${task.id}&name=${encodeURIComponent(task.name)}`
      });
    } catch (_) {
      // request() 已展示错误提示。
    }
  },

  open(e) {
    wx.navigateTo({ url: '/pages/task/task?id=' + e.currentTarget.dataset.id });
  },

  create() {
    wx.navigateTo({ url: '/pages/create/create' });
  }
});
