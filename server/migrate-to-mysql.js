// 把 server/data.json 里的开发期数据，导入 MySQL，方便从 JSON 切到 MySQL 时数据不丢
//
// 用法：
//   1. 先在 MySQL 里建好库：CREATE DATABASE daka DEFAULT CHARSET utf8mb4;
//   2. server/.env 里配置 MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE
//   3. 运行：node migrate-to-mysql.js
//      可选参数：--reset  清空目标表再写入
require('dotenv').config({ override: true });
const fs = require('fs');
const path = require('path');
const { _internal } = require('./db.mysql');
const { TABLES, COLUMNS, SCHEMA, DEFAULTS, buildPool } = _internal;

const RESET = process.argv.includes('--reset');
const FILE = path.join(__dirname, 'data.json');

(async () => {
  if (!fs.existsSync(FILE)) {
    console.log('data.json 不存在，无需迁移');
    process.exit(0);
  }
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));

  const pool = buildPool();
  console.log('[migrate] 连接成功，开始建表');
  for (const t of TABLES) await pool.query(SCHEMA[t]);

  if (RESET) {
    console.log('[migrate] --reset：清空目标表');
    await pool.query('SET FOREIGN_KEY_CHECKS=0');
    for (const t of TABLES) await pool.query('TRUNCATE TABLE ' + t);
    await pool.query('SET FOREIGN_KEY_CHECKS=1');
  }

  let total = 0;
  for (const t of TABLES) {
    const rows = Array.isArray(raw[t]) ? raw[t] : [];
    if (!rows.length) { console.log(`[migrate] ${t}: 0 行`); continue; }
    const cols = COLUMNS[t];
    const placeholders = '(' + cols.map(() => '?').join(',') + ')';
    const sql = `INSERT IGNORE INTO ${t} (${cols.join(',')}) VALUES ${rows.map(() => placeholders).join(',')}`;
    const flat = [];
    for (const r of rows) {
      const full = { ...DEFAULTS[t], ...r };
      for (const c of cols) flat.push(full[c] === undefined ? null : full[c]);
    }
    await pool.execute(sql, flat);
    total += rows.length;
    console.log(`[migrate] ${t}: ${rows.length} 行`);
  }
  console.log(`[migrate] 完成，合计 ${total} 行`);
  await pool.end();
  process.exit(0);
})().catch(e => {
  console.error('[migrate] 失败:', e);
  process.exit(1);
});
