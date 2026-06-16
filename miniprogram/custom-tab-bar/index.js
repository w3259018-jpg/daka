Component({
  data: {
    selected: 0,
    tabs: [
      { path: '/pages/tasks/tasks', text: '今天', icon: '今', i: 0 },
      { path: '/pages/taskboard/taskboard', text: '计划', icon: '计', i: 1 },
      { path: '/pages/records/records', text: '记录', icon: '记', i: 2 },
      { path: '/pages/profile/profile', text: '我的', icon: '我', i: 3 }
    ]
  },

  methods: {
    switchTab(e) {
      const { path, i } = e.currentTarget.dataset;
      this.setData({ selected: +i });
      wx.switchTab({ url: path });
    }
  }
});
