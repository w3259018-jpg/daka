const { request, ensureLogin, upload, toast, fullUrl } = require('../../utils/api');

Page({
  data: { id: 0, task: null, showAdd: false, title: '', mediaTypes: ['audio','video'], mtIdx: 0, mediaUrl: '' },

  onLoad(q) { this.setData({ id: +q.id }); },
  async onShow() { await ensureLogin(); await this.load(); },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh(); },

  async load() {
    try { this.setData({ task: await request('/api/tasks/' + this.data.id) }); }
    catch (e) { toast(e.err || '加载失败'); }
  },

  onInput(e) { this.setData({ [e.currentTarget.dataset.k]: e.detail.value }); },
  pickMt(e) { this.setData({ mtIdx: +e.detail.value }); },
  toggleAdd() { this.setData({ showAdd: !this.data.showAdd }); },

  chooseMedia() {
    const isAudio = this.data.mediaTypes[this.data.mtIdx] === 'audio';
    const pick = isAudio
      ? new Promise((res, rej) => wx.chooseMessageFile({ count: 1, type: 'file', extension: ['mp3','m4a','wav','aac'], success: r => res(r.tempFiles[0].path), fail: rej }))
      : new Promise((res, rej) => wx.chooseMedia({ count: 1, mediaType: ['video'], success: r => res(r.tempFiles[0].tempFilePath), fail: rej }));
    pick.then(async p => {
      wx.showLoading({ title: '上传中' });
      try { const r = await upload(p); this.setData({ mediaUrl: r.url }); toast('上传成功', 'success'); }
      catch { toast('上传失败'); }
      finally { wx.hideLoading(); }
    }).catch(() => {});
  },

  async publish() {
    const { title, mediaTypes, mtIdx, mediaUrl, id } = this.data;
    if (!title || !mediaUrl) return toast('请填写标题并上传媒体');
    try {
      await request(`/api/tasks/${id}/items`, { method: 'POST', data: { title, media_type: mediaTypes[mtIdx], media_url: mediaUrl } });
      toast('已发布', 'success');
      this.setData({ showAdd: false, title: '', mediaUrl: '' });
      this.load();
    } catch (_) { /* toast 已提示 */ }
  },

  openItem(e) { wx.navigateTo({ url: '/pages/item/item?id=' + e.currentTarget.dataset.id }); },
  goRank()    { wx.switchTab({ url: '/pages/rank/rank' }); wx.setStorageSync('curTaskId', this.data.id); },
  goForum()   { wx.switchTab({ url: '/pages/forum/forum' }); wx.setStorageSync('curTaskId', this.data.id); },
  goProfile() { wx.switchTab({ url: '/pages/profile/profile' }); wx.setStorageSync('curTaskId', this.data.id); },

  copyCode() { wx.setClipboardData({ data: this.data.task.invite_code }); },

  async setRole(e) {
    const { uid, role } = e.currentTarget.dataset;
    try { await request(`/api/tasks/${this.data.id}/members/${uid}/role`, { method: 'POST', data: { role } }); this.load(); }
    catch (err) { toast(err.err || '操作失败'); }
  },

  removeMember(e) {
    const uid = e.currentTarget.dataset.uid;
    wx.showModal({ title: '确认移除该成员?', success: r => { if (!r.confirm) return;
      request(`/api/tasks/${this.data.id}/members/${uid}`, { method: 'DELETE' }).then(() => this.load())
        .catch(err => toast(err.err || '移除失败')); } });
  },

  dissolve() {
    wx.showModal({ title: '确认解散任务? 数据将不可恢复', success: r => { if (!r.confirm) return;
      request(`/api/tasks/${this.data.id}`, { method: 'DELETE' }).then(() => {
        toast('已解散', 'success');
        setTimeout(() => wx.switchTab({ url: '/pages/tasks/tasks' }), 600);
      }).catch(err => toast(err.err || '解散失败')); } });
  },

  onShareAppMessage() {
    const t = this.data.task;
    return { title: `邀你加入「${t.name}」打卡任务`, path: `/pages/join/join?code=${t.invite_code}&id=${t.id}&name=${encodeURIComponent(t.name)}` };
  }
});
