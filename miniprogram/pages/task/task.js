const { request, ensureLogin, upload, toast, fullUrl, secCheck } = require('../../utils/api');
const { requireProfile, profilePopupHandlers } = require('../../utils/profile-guard');

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

const bytesToUtf8 = (bytes) => {
  let encoded = '';
  for (let i = 0; i < bytes.length; i++) {
    encoded += '%' + bytes[i].toString(16).padStart(2, '0');
  }
  try {
    return decodeURIComponent(encoded);
  } catch (_) {
    return String.fromCharCode.apply(null, bytes);
  }
};

const decodeExportText = (contentBase64) => {
  if (!contentBase64) return '';
  try {
    if (wx.base64ToArrayBuffer) {
      return bytesToUtf8(new Uint8Array(wx.base64ToArrayBuffer(contentBase64)));
    }
  } catch (_) {}
  try {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(contentBase64, 'base64').toString('utf8');
    }
  } catch (_) {}
  return '';
};

Page({
  ...profilePopupHandlers,

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
    mediaUrl: '',
    mediaFileName: '',
    showLoginPopup: false
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
    this._mediaUploadVersion = (this._mediaUploadVersion || 0) + 1;
    this.setData({ mtIdx: +e.detail.value, mediaUrl: '', mediaFileName: '' });
  },

  toggleAdd() {
    this.setData({ showAdd: !this.data.showAdd });
  },

  toggleManage() {
    this.setData({ showManage: !this.data.showManage });
  },

  chooseMedia() {
    if (!requireProfile(this)) return;
    const isAudio = this.data.mediaTypes[this.data.mtIdx] === 'audio';

    wx.showActionSheet({
      itemList: ['从微信聊天中选择'],
      success: ({ tapIndex }) => {
        const pick = isAudio ? this.pickAudioFile() : this.pickVideoFile();
        pick.then(file => this.uploadPickedMedia(file)).catch(err => this.handlePickError(err));
      },
      fail: err => this.handlePickError(err)
    });
  },

  pickAudioFile() {
    return this.pickMessageFile({
      type: 'file',
      extension: ['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg']
    });
  },

  pickVideoFile() {
    return this.pickMessageFile({
      type: 'video'
    });
  },

  pickMessageFile(options) {
    return new Promise((resolve, reject) => {
      if (!wx.chooseMessageFile) return reject({ errMsg: 'chooseMessageFile:fail not supported' });
      wx.chooseMessageFile({
        count: 1,
        ...options,
        success: (r) => {
          const file = r.tempFiles && r.tempFiles[0];
          const filePath = file && (file.path || file.tempFilePath);
          if (!filePath) return reject({ errMsg: 'chooseMessageFile:fail empty file' });
          resolve({ filePath, name: file.name || this.fileNameFromPath(filePath) });
        },
        fail: reject
      });
    });
  },

  fileNameFromPath(filePath) {
    return String(filePath || '').split('/').pop() || '已选择文件';
  },

  async uploadPickedMedia(file) {
    if (!file || !file.filePath) return toast('未选择文件');
    const uploadVersion = (this._mediaUploadVersion || 0) + 1;
    this._mediaUploadVersion = uploadVersion;
    this._activeMediaUploads = (this._activeMediaUploads || 0) + 1;
    wx.showLoading({ title: '上传中' });
    try {
      const result = await upload(file.filePath, { originalName: file.name });
      if (uploadVersion !== this._mediaUploadVersion) return;
      if (!result || !result.url) throw { err: result && result.err };
      this.setData({ mediaUrl: result.url, mediaFileName: file.name || this.fileNameFromPath(file.filePath) });
      toast('上传成功', 'success');
    } catch (err) {
      if (uploadVersion !== this._mediaUploadVersion) return;
      toast((err && err.err) || '上传失败');
    } finally {
      this._activeMediaUploads -= 1;
      if (this._activeMediaUploads === 0) wx.hideLoading();
    }
  },

  handlePickError(err) {
    const msg = (err && (err.errMsg || err.message || err.err)) || '';
    if (/cancel/i.test(msg)) return;
    console.warn('[choose media]', err);
    toast('无法打开选择器，请升级微信或在真机中重试');
  },

  async publish() {
    if (!requireProfile(this)) return;
    if ((this._activeMediaUploads || 0) > 0) return toast('文件上传中，请稍候');
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
      this._mediaUploadVersion = (this._mediaUploadVersion || 0) + 1;
      toast('已发布', 'success');
      this.setData({ showAdd: false, title: '', mediaUrl: '', mediaFileName: '' });
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
    if (!requireProfile(this)) return;
    try {
      const result = await request(`/api/tasks/${this.data.id}/admin-export`, { method: 'POST' });
      const content = decodeExportText(result.content_base64);
      if (!content) return toast('导出内容为空');
      wx.setClipboardData({
        data: content,
        success: () => toast('导出内容已复制', 'success'),
        fail: () => toast('复制失败，请重试')
      });
    } catch (err) {
      toast(err.err || '导出失败');
    }
  },

  async setRole(e) {
    if (!requireProfile(this)) return;
    const { uid, role } = e.currentTarget.dataset;
    try {
      await request(`/api/tasks/${this.data.id}/members/${uid}/role`, { method: 'POST', data: { role } });
      await this.load();
    } catch (err) {
      toast(err.err || '操作失败');
    }
  },

  removeMember(e) {
    if (!requireProfile(this)) return;
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
    if (!requireProfile(this)) return;
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
