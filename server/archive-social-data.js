const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const DATA_FILE = path.join(__dirname, 'data.json');
const OUT_DIR = path.join(__dirname, 'backups');
const SOCIAL_TABLES = ['posts', 'post_comments', 'post_likes'];
const PURGE_ORDER = ['post_likes', 'post_comments', 'posts'];
const purgeRequested = process.argv.includes('--purge');
const purgeSocialConfirmed = process.argv.includes('--confirm-purge-social-data');
const serviceStoppedConfirmed = process.argv.includes('--confirm-service-stopped');
const confirmStorageArgs = process.argv
  .filter(arg => arg.startsWith('--confirm-storage='))
  .map(arg => arg.slice('--confirm-storage='.length));
const configuredStorage = process.env.STORAGE && process.env.STORAGE.toLowerCase();

const fail = message => {
  throw new Error(message);
};

const validateStorage = storage => {
  if (!['json', 'mysql'].includes(storage)) fail(`Unsupported STORAGE value: ${storage}`);
};

const resolveStorage = () => {
  if (!purgeRequested) {
    const storage = configuredStorage || 'json';
    validateStorage(storage);
    return storage;
  }

  const missing = [];
  if (!purgeSocialConfirmed) missing.push('--confirm-purge-social-data');
  if (!serviceStoppedConfirmed) missing.push('--confirm-service-stopped');
  if (confirmStorageArgs.length !== 1) missing.push('--confirm-storage=<json|mysql>');
  if (!configuredStorage) missing.push('explicit STORAGE=json|mysql environment variable');
  if (missing.length) {
    fail(`Refusing purge before data access; missing or invalid confirmation: ${missing.join(', ')}`);
  }

  validateStorage(configuredStorage);
  validateStorage(confirmStorageArgs[0]);
  if (configuredStorage !== confirmStorageArgs[0]) {
    fail(`Refusing purge: STORAGE=${configuredStorage} does not match --confirm-storage=${confirmStorageArgs[0]}`);
  }
  return configuredStorage;
};

const mysqlTarget = () => ({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: +(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'daka',
});

const describeTarget = storage => {
  if (storage === 'json') return `JSON data file: ${DATA_FILE}`;
  const target = mysqlTarget();
  return `MySQL host=${target.host} port=${target.port} database=${target.database}`;
};

const printTarget = (storage, purge = false) => {
  const prefix = purge ? '[PURGE TARGET]' : '[archive target]';
  console.log(`${prefix} ${describeTarget(storage)}`);
  if (purge && storage === 'mysql') {
    console.log(
      '[PURGE WARNING] MySQL DROP TABLE is non-transactional and cannot be rolled back; ' +
      'requires deployed social-API removal and stopped service.'
    );
  }
};

const fsyncDirectoryBestEffort = dir => {
  let fd;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch (_) {
    // Some platforms, including Windows configurations, do not support directory fsync.
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
};

const atomicWriteJson = (file, value) => {
  const dir = path.dirname(file);
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temp, 'wx');
    fs.writeFileSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, file);
    fsyncDirectoryBestEffort(dir);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
};

const socialArraysFromJson = raw => Object.fromEntries(SOCIAL_TABLES.map(table => {
  if (!Object.prototype.hasOwnProperty.call(raw, table)) return [table, []];
  if (!Array.isArray(raw[table])) fail(`Refusing archive: JSON key "${table}" is not an array`);
  return [table, raw[table]];
}));

const createBackup = (storage, tables) => ({
  metadata: {
    storage,
    created_at: new Date().toISOString(),
    purged: false,
  },
  ...tables,
});

const markBackupPurged = (out, backup) => {
  backup.metadata.purged = true;
  backup.metadata.purged_at = new Date().toISOString();
  atomicWriteJson(out, backup);
};

const archiveJson = out => {
  if (!fs.existsSync(DATA_FILE)) fail(`JSON data file not found: ${DATA_FILE}`);

  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const tables = socialArraysFromJson(raw);
  const backup = createBackup('json', tables);
  atomicWriteJson(out, backup);

  if (purgeRequested) {
    if (!raw.seq || typeof raw.seq !== 'object' || Array.isArray(raw.seq)) {
      fail('Refusing purge: JSON seq must be an object');
    }
    printTarget('json', true);
    for (const table of SOCIAL_TABLES) {
      delete raw[table];
      delete raw.seq[table];
    }
    atomicWriteJson(DATA_FILE, raw);
    markBackupPurged(out, backup);
  }

  return tables;
};

const selectTable = async (connection, table) => {
  try {
    const [rows] = await connection.query(`SELECT * FROM ${table}`);
    return rows;
  } catch (err) {
    if (err && (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146)) return [];
    throw err;
  }
};

const assertTableMissing = async (connection, database, table) => {
  const [rows] = await connection.execute(
    'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=? AND table_name=?',
    [database, table]
  );
  if (+rows[0].count !== 0) fail(`MySQL purge verification failed: table still exists: ${table}`);
};

const archiveMysql = async out => {
  const target = mysqlTarget();
  const connection = await mysql.createConnection(target);
  try {
    const tables = {};
    for (const table of SOCIAL_TABLES) tables[table] = await selectTable(connection, table);
    const backup = createBackup('mysql', tables);
    atomicWriteJson(out, backup);

    if (purgeRequested) {
      printTarget('mysql', true);
      console.log(
        '[PURGE WARNING] Starting non-transactional MySQL DDL. Partial DROP failure cannot be rolled back; ' +
        'backup metadata will remain purged=false unless every table is verified absent.'
      );
      for (const table of PURGE_ORDER) {
        await connection.query(`DROP TABLE IF EXISTS ${table}`);
        await assertTableMissing(connection, target.database, table);
      }
      markBackupPurged(out, backup);
    }
    return tables;
  } finally {
    await connection.end();
  }
};

const run = async () => {
  const storage = resolveStorage();
  printTarget(storage);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(OUT_DIR, `social-${stamp}.json`);
  const tables = storage === 'mysql' ? await archiveMysql(out) : archiveJson(out);

  for (const table of SOCIAL_TABLES) console.log(`${table}: ${tables[table].length}`);
  console.log(`social backup: ${out}`);
  console.log(`purged: ${purgeRequested}`);
};

run().catch(err => {
  console.error('[archive-social] failed:', err.message);
  process.exitCode = 1;
});
