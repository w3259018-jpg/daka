// MySQL 存储：生产环境用
// 设计要点：
//   1. 启动时把所有表一次性读进内存（数据量小，几千行毫无压力），
//      读写接口和 db.json.js 完全一致，index.js 不用改。
//   2. 每次 insert / update / remove 同步改内存 + 入队一次 SQL，
//      由后台单线程顺序写入 MySQL，保证写入顺序。
//   3. id 由内存 seq 自增，启动时取 MAX(id) 重建，避免重启后冲突。
const mysql = require('mysql2/promise');

const TABLES = ['users', 'tasks', 'task_members', 'checkin_items', 'checkin_records',
                'posts', 'post_comments', 'post_likes'];

const SCHEMA = {
  users: `CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY,
    openid VARCHAR(64) NOT NULL DEFAULT '',
    unionid VARCHAR(64) NOT NULL DEFAULT '',
    nickname VARCHAR(64) NOT NULL DEFAULT '',
    avatar VARCHAR(1024) NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL DEFAULT 0,
    KEY idx_openid (openid),
    KEY idx_unionid (unionid)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  tasks: `CREATE TABLE IF NOT EXISTS tasks (
    id BIGINT PRIMARY KEY,
    name VARCHAR(128) NOT NULL DEFAULT '',
    start_date VARCHAR(16) NOT NULL DEFAULT '',
    end_date VARCHAR(16) NOT NULL DEFAULT '',
    admin_id BIGINT NOT NULL DEFAULT 0,
    invite_code VARCHAR(16) NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL DEFAULT 0,
    KEY idx_admin (admin_id),
    KEY idx_invite (invite_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  task_members: `CREATE TABLE IF NOT EXISTS task_members (
    id BIGINT PRIMARY KEY,
    task_id BIGINT NOT NULL DEFAULT 0,
    user_id BIGINT NOT NULL DEFAULT 0,
    real_name VARCHAR(64) NOT NULL DEFAULT '',
    gender VARCHAR(8) NOT NULL DEFAULT '',
    age INT NOT NULL DEFAULT 0,
    role VARCHAR(16) NOT NULL DEFAULT 'member',
    created_at BIGINT NOT NULL DEFAULT 0,
    KEY idx_task (task_id),
    KEY idx_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  checkin_items: `CREATE TABLE IF NOT EXISTS checkin_items (
    id BIGINT PRIMARY KEY,
    task_id BIGINT NOT NULL DEFAULT 0,
    title VARCHAR(128) NOT NULL DEFAULT '',
    media_type VARCHAR(16) NOT NULL DEFAULT '',
    media_url VARCHAR(1024) NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL DEFAULT 0,
    KEY idx_task (task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  checkin_records: `CREATE TABLE IF NOT EXISTS checkin_records (
    id BIGINT PRIMARY KEY,
    item_id BIGINT NOT NULL DEFAULT 0,
    user_id BIGINT NOT NULL DEFAULT 0,
    note TEXT,
    watched_at BIGINT NOT NULL DEFAULT 0,
    submitted_at BIGINT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL DEFAULT 0,
    KEY idx_item (item_id),
    KEY idx_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  posts: `CREATE TABLE IF NOT EXISTS posts (
    id BIGINT PRIMARY KEY,
    task_id BIGINT NOT NULL DEFAULT 0,
    user_id BIGINT NOT NULL DEFAULT 0,
    content TEXT,
    source VARCHAR(16) NOT NULL DEFAULT 'manual',
    checkin_record_id BIGINT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL DEFAULT 0,
    KEY idx_task (task_id),
    KEY idx_user (user_id),
    KEY idx_record (checkin_record_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  post_comments: `CREATE TABLE IF NOT EXISTS post_comments (
    id BIGINT PRIMARY KEY,
    post_id BIGINT NOT NULL DEFAULT 0,
    user_id BIGINT NOT NULL DEFAULT 0,
    parent_id BIGINT NOT NULL DEFAULT 0,
    content TEXT,
    created_at BIGINT NOT NULL DEFAULT 0,
    KEY idx_post (post_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  post_likes: `CREATE TABLE IF NOT EXISTS post_likes (
    id BIGINT PRIMARY KEY,
    post_id BIGINT NOT NULL DEFAULT 0,
    user_id BIGINT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL DEFAULT 0,
    KEY idx_post (post_id),
    KEY idx_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
};

const COLUMNS = {
  users: ['id', 'openid', 'unionid', 'nickname', 'avatar', 'created_at'],
  tasks: ['id', 'name', 'start_date', 'end_date', 'admin_id', 'invite_code', 'created_at'],
  task_members: ['id', 'task_id', 'user_id', 'real_name', 'gender', 'age', 'role', 'created_at'],
  checkin_items: ['id', 'task_id', 'title', 'media_type', 'media_url', 'created_at'],
  checkin_records: ['id', 'item_id', 'user_id', 'note', 'watched_at', 'submitted_at', 'created_at'],
  posts: ['id', 'task_id', 'user_id', 'content', 'source', 'checkin_record_id', 'created_at'],
  post_comments: ['id', 'post_id', 'user_id', 'parent_id', 'content', 'created_at'],
  post_likes: ['id', 'post_id', 'user_id', 'created_at'],
};

const DEFAULTS = {
  users:           { openid: '', unionid: '', nickname: '', avatar: '' },
  tasks:           { name: '', start_date: '', end_date: '', admin_id: 0, invite_code: '' },
  task_members:    { task_id: 0, user_id: 0, real_name: '', gender: '', age: 0, role: 'member' },
  checkin_items:   { task_id: 0, title: '', media_type: '', media_url: '' },
  checkin_records: { item_id: 0, user_id: 0, note: '', watched_at: 0, submitted_at: 0 },
  posts:           { task_id: 0, user_id: 0, content: '', source: 'manual', checkin_record_id: 0 },
  post_comments:   { post_id: 0, user_id: 0, parent_id: 0, content: '' },
  post_likes:      { post_id: 0, user_id: 0 },
};

const data = { seq: {} };
for (const t of TABLES) data[t] = [];

let pool = null;
const queue = [];
let draining = false;

const enqueue = (fn) => {
  queue.push(fn);
  if (!draining) drain();
};

const drain = async () => {
  draining = true;
  while (queue.length) {
    const fn = queue.shift();
    try { await fn(); }
    catch (e) { console.error('[db.mysql] write failed:', e.message); }
  }
  draining = false;
};

const buildPool = () => mysql.createPool({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: +(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'daka',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
});

const ensureSchema = async () => {
  for (const t of TABLES) await pool.query(SCHEMA[t]);
};

const loadAll = async () => {
  for (const t of TABLES) {
    const [rows] = await pool.query(`SELECT ${COLUMNS[t].join(',')} FROM ${t}`);
    data[t] = rows.map(r => ({ ...r }));
    data.seq[t] = data[t].reduce((m, r) => Math.max(m, r.id || 0), 0);
  }
};

const init = async () => {
  pool = buildPool();
  await ensureSchema();
  await loadAll();
  const sizes = TABLES.map(t => `${t}=${data[t].length}`).join(' ');
  console.log('[db] storage=mysql ' + sizes);
};

const nextId = (t) => (data.seq[t] = (data.seq[t] || 0) + 1);

const insert = (t, row) => {
  const full = { ...DEFAULTS[t], ...row };
  full.id = nextId(t);
  full.created_at = Math.floor(Date.now() / 1000);
  data[t].push(full);
  const cols = COLUMNS[t];
  const placeholders = cols.map(() => '?').join(',');
  const values = cols.map(c => full[c]);
  enqueue(() => pool.execute(
    `INSERT INTO ${t} (${cols.join(',')}) VALUES (${placeholders})`,
    values
  ));
  return full;
};

const find   = (t, pred) => data[t].find(pred);
const filter = (t, pred) => data[t].filter(pred);

const update = (t, pred, patch) => {
  const r = find(t, pred);
  if (!r) return undefined;
  Object.assign(r, patch);
  const id = r.id;
  const keys = Object.keys(patch).filter(k => k !== 'id' && COLUMNS[t].includes(k));
  if (!keys.length) return r;
  const set = keys.map(k => `${k}=?`).join(',');
  const values = keys.map(k => patch[k]);
  enqueue(() => pool.execute(`UPDATE ${t} SET ${set} WHERE id=?`, [...values, id]));
  return r;
};

const remove = (t, pred) => {
  const targets = data[t].filter(pred);
  if (!targets.length) return;
  const ids = targets.map(r => r.id);
  data[t] = data[t].filter(r => !pred(r));
  const placeholders = ids.map(() => '?').join(',');
  enqueue(() => pool.execute(`DELETE FROM ${t} WHERE id IN (${placeholders})`, ids));
};

const save = () => {};

module.exports = { data, insert, find, filter, update, remove, save, init,
                   _internal: { TABLES, COLUMNS, SCHEMA, DEFAULTS, buildPool } };
