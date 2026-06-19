const { request, ensureLogin, safe } = require('../../utils/api');
const {
  requireProfile,
  shouldPromptProfile,
  profilePopupHandlers
} = require('../../utils/profile-guard');

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

const formatDateRange = (task) => {
  const start = task.start_date || '不限';
  const end = task.end_date || '不限';
  return `${start} - ${end}`;
};

const normalizeTask = (task) => {
  const total = Number(task.item_count || 0);
  const completed = Number(task.my_completed_count || 0);
  const currentItem = task.current_item || null;
  const role = task.role === 'admin' ? 'admin' : 'member';

  return {
    ...task,
    current_item: currentItem,
    role,
    roleText: role === 'admin' ? '管理员' : '成员',
    progressText: `${completed}/${total}`,
    dateText: formatDateRange(task),
    currentTitle: currentItem ? currentItem.title : '暂无待打卡内容',
    isComplete: total > 0 && completed >= total
  };
};

Page({
  ...profilePopupHandlers,

  data: {
    user: {},
    tasks: [],
    pending: [],
    managed: [],
    primaryTask: null,
    remainingCount: 0,
    completedCount: 0,
    todayText: '',
    week: [],
    showJoin: false,
    joinCode: '',
    showLoginPopup: false
  },

  async onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 0 });

    await ensureLogin();
    const app = getApp();
    const globalData = (app && app.globalData) || {};
    this.setData({
      user: globalData.user || {},
      showLoginPopup: shouldPromptProfile(globalData.user, globalData.guestMode)
    });
    await this.load();
  },

  async onPullDownRefresh() {
    await this.load();
    wx.stopPullDownRefresh();
  },

  async load() {
    const app = getApp();
    const cachedUser = (app && app.globalData && app.globalData.user) || {};
    const loadStartUser = { ...cachedUser };
    const [serverUser, rawTasks] = await Promise.all([
      safe(request('/api/me'), loadStartUser),
      safe(request('/api/tasks'), [])
    ]);

    const currentUser = (app && app.globalData && app.globalData.user) || {};
    const user = { ...loadStartUser, ...(serverUser || {}) };
    Object.keys(currentUser).forEach(key => {
      const changedWhileLoading = !Object.prototype.hasOwnProperty.call(loadStartUser, key) ||
        currentUser[key] !== loadStartUser[key];
      if (changedWhileLoading) user[key] = currentUser[key];
    });
    if (app && app.globalData) {
      app.globalData.user = user;
    }

    const tasks = (rawTasks || []).map(normalizeTask);
    const pending = tasks.filter(task => !!task.current_item);
    const completed = tasks.filter(task => task.isComplete);
    const managed = tasks.filter(task => task.role === 'admin');
    const now = new Date();
    const personalDoneCount = tasks.reduce((sum, task) => sum + Number(task.my_completed_count || 0), 0);
    const week = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(now.getDate() - 6 + i);
      return {
        key: `${d.getMonth() + 1}-${d.getDate()}`,
        label: WEEK[d.getDay()],
        day: d.getDate(),
        today: i === 6,
        done: i >= Math.max(0, 7 - Math.min(personalDoneCount, 7))
      };
    });

    this.setData({
      user,
      showLoginPopup: shouldPromptProfile(
        user,
        app && app.globalData && app.globalData.guestMode
      ),
      tasks,
      pending,
      managed,
      primaryTask: pending[0] || null,
      remainingCount: pending.length,
      completedCount: completed.length,
      todayText: `${now.getMonth() + 1}月${now.getDate()}日 周${WEEK[now.getDay()]}`,
      week
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

  openTask(e) {
    wx.navigateTo({ url: '/pages/task/task?id=' + e.currentTarget.dataset.id });
  },

  openCurrent(e) {
    const itemId = e.currentTarget.dataset.itemId;
    if (!itemId) return;
    wx.navigateTo({ url: '/pages/item/item?id=' + itemId });
  },

  openFirstPending() {
    const task = this.data.primaryTask;
    if (!task || !task.current_item) {
      wx.showToast({ title: '今天暂无待打卡内容', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/item/item?id=' + task.current_item.id });
  },

  openCreate() {
    if (!requireProfile(this)) return;
    wx.navigateTo({ url: '/pages/create/create' });
  }
});
