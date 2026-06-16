const { request, ensureLogin, upload, toast, fullUrl, secCheck } = require('../../utils/api');

const roleText = (role, isCreator) => {
  if (isCreator || role === 'creator') return '创建者';
  if (role === 'admin') return '管理员';
  return '成员';
};

const formatDateRange = (task) => {
  const start = task.start_date || '不限';
  const end = task.end_date || '不限';
  return `${start} - ${end}`;
};

const formatTime = (ts) => ts ? new Date(ts).toLocaleString('zh-CN') : '';

Page({
  data: {
    id: 0,
    task: null,
    items: [],
    currentItem: null,
    myStats: { completed: 0, total: 0, percent: 0 },
    adminSummary: null,
    members: [],
    memberRecords: [],
    selectedMemberName: '',
    showMemberRecords: false,
    showAdd: false,
    showManage: true,
    title: '',
    mediaTypes: ['audio', 'video'],
    mediaLabels: ['音频', '视频'],
    mtIdx: 0,
    mediaUrl: ''
  },

  onLoad(q) {
    this.setData({ id: +q.id || 0 });
  },

  async onShow() {
    await ensureLogin();
    await this.load();
  },

  async onPullDownRefresh() {
    await this.load();
    wx.stopPullDownRefresh();
  },

  async load() {
    try {
      const task = await request('/api/tasks/' + this.data.id);
      this.setData(this.buildViewData(task));
    } catch (e) {
      toast(e.err || '加载失败');
    }
  },

  buildViewData(task) {
    const items = (task.items || []).map(item => ({
      ...item,
      mediaText: item.media_type === 'audio' ? '音频' : '视频',
      statusText: item.done ? '已完成' : '待打卡'
    }));
    const completed = items.filter(item => item.done).length;
    const total = items.length;
    const currentItem = items.slice().reverse().find(item => !item.done) || items[0] || null;
    const isAdmin = !!task.is_admin;
    const taskRoleText = task.is_creator ? '创建者' : (isAdmin ? '管理员' : '成员');
    const members = isAdmin ? (task.members || []).map(member => ({
      ...member,
      displayName: member.real_name || member.nickname || '未命名成员',
      initial: (member.real_name || member.nickname || '成').slice(0, 1),
      roleText: roleText(member.role, member.role === 'creator'),
      statusText: member.current_done ? '当前已完成' : '当前未完成'
    })) : [];

    return {
      task: {
        ...task,
        dateText: formatDateRange(task),
        roleText: taskRoleText
      },
      items,
      currentItem,
      myStats: {
        completed,
        total,
        percent: total ? Math.round(completed / total * 100) : 0
      },
      adminSummary: isAdmin ? (task.admin_summary || null) : null,
      members,
      memberRecords: [],
      selectedMemberName: '',
      showMemberRecords: false
    };
  },

  onInput(e) {
    this.setData({ [e.currentTarget.dataset.k]: e.detail.value });
  },

  pickMt(e) {
    this.setData({ mtIdx: +e.detail.value });
  },

  toggleAdd() {
    this.setData({ showAdd: !this.data.showAdd });
  },

  toggleManage() {
    this.setData({ showManage: !this.data.showManage });
  },

  chooseMedia() {
    const isAudio = this.data.mediaTypes[this.data.mtIdx] === 'audio';
    const pick = isAudio
      ? new Promise((resolve, reject) => wx.chooseMessageFile({
          count: 1,
          type: 'file',
          extension: ['mp3', 'm4a', 'wav', 'aac'],
          success: r => resolve(r.tempFiles[0].path),
          fail: reject
        }))
      : new Promise((resolve, reject) => wx.chooseMedia({
          count: 1,
          mediaType: ['video'],
          success: r => resolve(r.tempFiles[0].tempFilePath),
          fail: reject
        }));

    pick.then(async (filePath) => {
      wx.showLoading({ title: '上传中' });
      try {
        const result = await upload(filePath);
        this.setData({ mediaUrl: result.url });
        toast('上传成功', 'success');
      } catch (_) {
        toast('上传失败');
      } finally {
        wx.hideLoading();
      }
    }).catch(() => {});
  },

  async publish() {
    const { title, mediaTypes, mtIdx, mediaUrl, id } = this.data;
    if (!title.trim() || !mediaUrl) return toast('请填写标题并上传媒体');

    wx.showLoading({ title: '审核中', mask: true });
    const sec = await secCheck(title);
    if (!sec.safe) {
      wx.hideLoading();
      return toast(sec.reason || '标题可能包含违规信息，请修改');
    }

    try {
      await request(`/api/tasks/${id}/items`, {
        method: 'POST',
        data: { title: title.trim(), media_type: mediaTypes[mtIdx], media_url: mediaUrl }
      });
      wx.hideLoading();
      toast('已发布', 'success');
      this.setData({ showAdd: false, title: '', mediaUrl: '' });
      await this.load();
    } catch (_) {
      wx.hideLoading();
    }
  },

  openItem(e) {
    wx.navigateTo({ url: '/pages/item/item?id=' + e.currentTarget.dataset.id });
  },

  openToday() {
    if (!this.data.currentItem) return toast('暂无可打卡内容');
    wx.navigateTo({ url: '/pages/item/item?id=' + this.data.currentItem.id });
  },

  goRecords() {
    wx.setStorageSync('curTaskId', this.data.id);
    wx.switchTab({ url: '/pages/records/records' });
  },

  copyCode() {
    const code = this.data.task && this.data.task.invite_code;
    if (!code) return;
    wx.setClipboardData({ data: code, success: () => toast('邀请码已复制', 'success') });
  },

  async openMemberRecords(e) {
    const uid = e.currentTarget.dataset.uid;
    const name = e.currentTarget.dataset.name || '成员';
    try {
      const records = await request(`/api/tasks/${this.data.id}/members/${uid}/records`);
      this.setData({
        memberRecords: records.map(record => ({
          ...record,
          submittedText: formatTime(record.submitted_at)
        })),
        selectedMemberName: name,
        showMemberRecords: true
      });
    } catch (err) {
      toast(err.err || '加载成员记录失败');
    }
  },

  closeMemberRecords() {
    this.setData({ showMemberRecords: false, memberRecords: [], selectedMemberName: '' });
  },

  noop() {},

  async exportAdminData() {
    try {
      const result = await request(`/api/tasks/${this.data.id}/admin-export`, { method: 'POST' });
      if (!result.content_base64) return toast('导出内容为空');

      const fs = wx.getFileSystemManager();
      const filePath = `${wx.env.USER_DATA_PATH}/${result.filename || ('admin_export_' + this.data.id + '.tsv')}`;
      fs.writeFile({
        filePath,
        data: result.content_base64,
        encoding: 'base64',
        success: () => {
          wx.setClipboardData({
            data: filePath,
            success: () => toast('导出文件路径已复制', 'success')
          });
        },
        fail: () => toast('写入导出文件失败')
      });
    } catch (err) {
      toast(err.err || '导出失败');
    }
  },

  async setRole(e) {
    const { uid, role } = e.currentTarget.dataset;
    try {
      await request(`/api/tasks/${this.data.id}/members/${uid}/role`, { method: 'POST', data: { role } });
      await this.load();
    } catch (err) {
      toast(err.err || '操作失败');
    }
  },

  removeMember(e) {
    const uid = e.currentTarget.dataset.uid;
    wx.showModal({
      title: '确认移除成员',
      content: '移除后，该成员不能继续查看或提交本任务。',
      success: (r) => {
        if (!r.confirm) return;
        request(`/api/tasks/${this.data.id}/members/${uid}`, { method: 'DELETE' })
          .then(() => this.load())
          .catch(err => toast(err.err || '移除失败'));
      }
    });
  },

  dissolve() {
    wx.showModal({
      title: '确认解散任务',
      content: '任务、打卡内容和记录将被删除，且不可恢复。',
      success: (r) => {
        if (!r.confirm) return;
        request(`/api/tasks/${this.data.id}`, { method: 'DELETE' }).then(() => {
          toast('已解散', 'success');
          setTimeout(() => wx.switchTab({ url: '/pages/tasks/tasks' }), 600);
        }).catch(err => toast(err.err || '解散失败'));
      }
    });
  },

  onShareAppMessage() {
    const task = this.data.task || {};
    return {
      title: `邀请你加入「${task.name || '打卡任务'}」`,
      path: `/pages/join/join?code=${encodeURIComponent(task.invite_code || '')}&id=${task.id || ''}&name=${encodeURIComponent(task.name || '')}`
    };
  }
});
