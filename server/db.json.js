// JSON 文件存储：开发期 / 单机演示用，零依赖、好排查
// 保持与 db.mysql.js 同样的对外接口：init / insert / find / filter / update / remove / save
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data.json');
const TABLES = ['users', 'tasks', 'task_members', 'checkin_items', 'checkin_records',
                'posts', 'post_comments', 'post_likes'];

const data = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { seq: {} };
for (const t of TABLES) if (!Array.isArray(data[t])) data[t] = [];
if (!data.seq) data.seq = {};

let timer = null;
const save = () => { clearTimeout(timer); timer = setTimeout(() => fs.writeFileSync(FILE, JSON.stringify(data, null, 2)), 50); };

const nextId = (t) => (data.seq[t] = (data.seq[t] || 0) + 1);

const insert = (t, row) => {
  row.id = nextId(t);
  row.created_at = Math.floor(Date.now() / 1000);
  data[t].push(row); save();
  return row;
};

const find   = (t, pred) => data[t].find(pred);
const filter = (t, pred) => data[t].filter(pred);
const update = (t, pred, patch) => { const r = find(t, pred); if (r) { Object.assign(r, patch); save(); } return r; };
const remove = (t, pred) => { const before = data[t].length; data[t] = data[t].filter(r => !pred(r)); if (data[t].length !== before) save(); };

const init = async () => {
  console.log('[db] storage=json file=' + FILE);
};

module.exports = { data, insert, find, filter, update, remove, save, init };
