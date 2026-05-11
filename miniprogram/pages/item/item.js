const { request, ensureLogin, toast, fullUrl } = require('../../utils/api');

Page({
  data: { id: 0, item: null, mediaSrc: '', watched: false, submitted: false, note: '', stars: [], celebrating: false },

  onLoad(q) { this.setData({ id: +q.id }); },

  async onShow() {
    await ensureLogin();
    await this.load();
  },

  async load() {
    try {
      const item = await request('/api/items/' + this.data.id);
      const my = item.my_record || {};
      this.setData({
        item, mediaSrc: fullUrl(item.media_url),
        watched: !!my.watched_at, submitted: !!my.submitted_at,
        note: my.note || ''
      });
      if (item.media_type === 'audio' && !this._audio) {
        const a = wx.createInnerAudioContext();
        a.src = fullUrl(item.media_url);
        a.onPlay(() => this.markWatched());
        this._audio = a;
      }
    } catch (e) { toast(e.err || '加载失败'); }
  },

  onUnload() { if (this._audio) { this._audio.destroy(); this._audio = null; } },

  playAudio() { this._audio && this._audio.play(); },
  pauseAudio() { this._audio && this._audio.pause(); },

  onVideoPlay() { this.markWatched(); },

  async markWatched() {
    if (this.data.watched) return;
    try { await request(`/api/items/${this.data.id}/watched`, { method: 'POST' }); this.setData({ watched: true }); }
    catch (e) { toast(e.err || '记录失败'); }
  },

  onNote(e) { this.setData({ note: e.detail.value }); },

  async submit() {
    if (!this.data.watched) return toast('请先点击播放确认观看');
    if (!this.data.note.trim()) return toast('请填写心得');
    if (this.data.submitted) return toast('已提交过');
    try {
      await request(`/api/items/${this.data.id}/submit`, { method: 'POST', data: { note: this.data.note } });
      this.setData({ submitted: true });
      this.celebrate();
    } catch (e) { toast(e.err || '提交失败'); }
  },

  celebrate() {
    const stars = Array.from({ length: 18 }, (_, i) => ({
      id: i, ch: ['★','✦','✧','⭐'][i % 4],
      x: (Math.random() * 800 - 400) + 'rpx',
      y: (Math.random() * 800 - 400) + 'rpx',
      l: (40 + Math.random() * 30) + '%',
      t: (40 + Math.random() * 20) + '%',
      c: ['#ffd54f','#ffb74d','#ff8a65','#fff176'][i % 4]
    }));
    this.setData({ celebrating: true, stars });
    setTimeout(() => this.setData({ celebrating: false, stars: [] }), 2000);
  }
});
