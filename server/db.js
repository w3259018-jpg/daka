// 数据存储切换器：通过环境变量 STORAGE=mysql 切到 MySQL，
// 默认走 JSON 文件，方便本机零配置启动 + 跑 smoke-test。
const STORAGE = (process.env.STORAGE || 'json').toLowerCase();
const impl = STORAGE === 'mysql' ? require('./db.mysql') : require('./db.json');
module.exports = impl;
