const { request, ensureLogin } = require('../../utils/api');

Page({
  data: { id: 0, post: null, tree: [], parentId: 0, parentName: '', text: '' },

  onLoad(q) { this.setData({ id: +q.id }); },
  async onShow() { await ensureLogin(); await this.load(); },

  async load() {
    try {
      const post = await request('/api/posts/' + this.data.id);
      const map = new Map(post.commentList.map(c => [c.id, { ...c, replies: [] }]));
      const tree = [];
      map.forEach(c => c.parent_id && map.get(c.parent_id) ? map.get(c.parent_id).replies.push(c) : tree.push(c));
      this.setData({ post, tree });
    } catch (_) { /* toast 已提示 */ }
  },

  setReply(e) {
    this.setData({ parentId: +e.currentTarget.dataset.id, parentName: e.currentTarget.dataset.name });
  },
  cancelReply() { this.setData({ parentId: 0, parentName: '' }); },

  onInput(e) { this.setData({ text: e.detail.value }); },

  async send() {
    if (!this.data.text.trim()) return;
    try {
      await request(`/api/posts/${this.data.id}/comment`, { method: 'POST',
        data: { content: this.data.text, parent_id: this.data.parentId } });
      this.setData({ text: '', parentId: 0, parentName: '' });
      this.load();
    } catch (_) { /* toast 已提示 */ }
  },

  async like() {
    try {
      const r = await request(`/api/posts/${this.data.id}/like`, { method: 'POST' });
      const p = this.data.post;
      this.setData({ post: { ...p, liked: r.liked, likes: p.likes + (r.liked ? 1 : -1) } });
    } catch (_) { /* toast 已提示 */ }
  }
});
