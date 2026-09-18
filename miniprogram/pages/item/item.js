const { request, ensureLogin, toast, fullUrl, secCheck } = require('../../utils/api');
const { requireProfile, profilePopupHandlers } = require('../../utils/profile-guard');

const AUDIO_SPEED_OPTIONS = [0.5, 1, 1.25, 1.5, 2];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const formatAudioTime = (seconds) => {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
};

Page({
  ...profilePopupHandlers,

  data: {
    id: 0,
    item: null,
    mediaSrc: '',
    watched: false,
    submitted: false,
    note: '',
    stars: [],
    celebrating: false,
    showLoginPopup: false,
    audioCurrent: 0,
    audioDuration: 0,
    audioProgress: 0,
    audioCurrentText: '00:00',
    audioDurationText: '00:00',
    audioDragging: false,
    audioPlaybackRate: 1,
    audioSpeedOptions: AUDIO_SPEED_OPTIONS
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
    this.setData({
      audioCurrent: 0,
      audioDuration: 0,
      audioProgress: 0,
      audioCurrentText: '00:00',
      audioDurationText: '00:00',
      audioDragging: false,
      audioPlaybackRate: 1
    });
    const audio = wx.createInnerAudioContext();
    audio.src = fullUrl(url);
    audio.playbackRate = 1;
    audio.onPlay(() => this.markWatched());
    audio.onCanplay(() => this.syncAudioProgress());
    audio.onTimeUpdate(() => {
      if (!this.data.audioDragging) this.syncAudioProgress();
    });
    audio.onEnded(() => {
      this.syncAudioProgress({ forceComplete: true });
    });
    audio.onError((err) => {
      console.warn('[audio playback]', err);
      toast('音频加载失败，请检查网络或文件格式');
    });
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

  syncAudioProgress(options = {}) {
    if (!this._audio) return;
    const duration = Number(this._audio.duration) || 0;
    const rawCurrent = options.forceComplete && duration
      ? duration
      : (Number(this._audio.currentTime) || 0);
    const current = duration ? clamp(rawCurrent, 0, duration) : Math.max(0, rawCurrent);
    const progress = duration ? clamp((current / duration) * 100, 0, 100) : 0;

    this.setData({
      audioCurrent: current,
      audioDuration: duration,
      audioProgress: progress,
      audioCurrentText: formatAudioTime(current),
      audioDurationText: formatAudioTime(duration),
      audioDragging: false
    });
  },

  onAudioProgressChanging(e) {
    const progress = clamp(Number(e.detail.value) || 0, 0, 100);
    const duration = Number(this.data.audioDuration) || 0;
    const current = duration ? (duration * progress) / 100 : 0;

    this.setData({
      audioDragging: true,
      audioProgress: progress,
      audioCurrent: current,
      audioCurrentText: formatAudioTime(current)
    });
  },

  onAudioProgressChange(e) {
    const progress = clamp(Number(e.detail.value) || 0, 0, 100);
    const duration = Number(this.data.audioDuration) || 0;
    const current = duration ? (duration * progress) / 100 : 0;

    if (this._audio && duration) this._audio.seek(current);
    this.setData({
      audioDragging: false,
      audioProgress: progress,
      audioCurrent: current,
      audioCurrentText: formatAudioTime(current)
    });
  },

  setAudioPlaybackRate(e) {
    const rate = Number(e.currentTarget.dataset.rate);
    if (!AUDIO_SPEED_OPTIONS.includes(rate)) return;
    if (this._audio) this._audio.playbackRate = rate;
    this.setData({ audioPlaybackRate: rate });
  },

  onVideoPlay() {
    this.markWatched();
  },

  onVideoError(err) {
    console.warn('[video playback]', err);
    toast('视频加载失败，请检查网络或文件格式');
  },

  async markWatched() {
    if (!requireProfile(this, { silent: true })) return;
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
    if (!requireProfile(this)) return;
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
