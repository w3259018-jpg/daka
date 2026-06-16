const { request, ensureLogin, toast, fullUrl, secCheck } = require('../../utils/api');

Page({
  data: {
    id: 0,
    item: null,
    mediaSrc: '',
    watched: false,
    submitted: false,
    note: '',
    stars: [],
    celebrating: false
  },

  onLoad(q) {
    this.setData({ id: +q.id || 0 });
  },

  async onShow() {
    await ensureLogin();
    await this.load();
  },

  async load() {
    try {
      const item = await request('/api/items/' + this.data.id);
      const my = item.my_record || {};
      this.setData({
        item: {
          ...item,
          mediaText: item.media_type === 'audio' ? '音频内容' : '视频内容'
        },
        mediaSrc: fullUrl(item.media_url),
        watched: !!my.watched_at,
        submitted: !!my.submitted_at,
        note: my.note || ''
      });

      if (item.media_type === 'audio') {
        this.setupAudio(item.media_url);
      }
    } catch (e) {
      toast(e.err || '加载失败');
    }
  },

  setupAudio(url) {
    if (this._audio) this._audio.destroy();
    const audio = wx.createInnerAudioContext();
    audio.src = fullUrl(url);
    audio.onPlay(() => this.markWatched());
    this._audio = audio;
  },

  onUnload() {
    if (this._audio) {
      this._audio.destroy();
      this._audio = null;
    }
  },

  playAudio() {
    if (this._audio) this._audio.play();
  },

  pauseAudio() {
    if (this._audio) this._audio.pause();
  },

  onVideoPlay() {
    this.markWatched();
  },

  async markWatched() {
    if (this.data.watched) return;
    try {
      await request(`/api/items/${this.data.id}/watched`, { method: 'POST' });
      this.setData({ watched: true });
    } catch (e) {
      toast(e.err || '记录失败');
    }
  },

  onNote(e) {
    this.setData({ note: e.detail.value });
  },

  async submit() {
    if (!this.data.watched) return toast('请先播放并确认观看');
    const note = (this.data.note || '').trim();
    if (!note) return toast('请填写心得');
    if (this.data.submitted) return toast('已提交过');

    wx.showLoading({ title: '审核中', mask: true });
    const sec = await secCheck(note);
    if (!sec.safe) {
      wx.hideLoading();
      return toast(sec.reason || '内容可能包含违规信息，请修改后重试');
    }

    try {
      await request(`/api/items/${this.data.id}/submit`, { method: 'POST', data: { note } });
      wx.hideLoading();
      this.setData({ submitted: true });
      this.celebrate();
    } catch (e) {
      wx.hideLoading();
      toast(e.err || '提交失败');
    }
  },

  celebrate() {
    const chars = ['★', '✓', '✦', '●'];
    const colors = ['#E98243', '#F2B36D', '#FFD7A8', '#FFFDF9'];
    const stars = Array.from({ length: 18 }, (_, i) => ({
      id: i,
      ch: chars[i % chars.length],
      x: (Math.random() * 800 - 400) + 'rpx',
      y: (Math.random() * 800 - 400) + 'rpx',
      l: (40 + Math.random() * 30) + '%',
      t: (40 + Math.random() * 20) + '%',
      c: colors[i % colors.length]
    }));
    this.setData({ celebrating: true, stars });
    setTimeout(() => this.setData({ celebrating: false, stars: [] }), 2000);
  }
});
