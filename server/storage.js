// 文件存储抽象：disk 用本地磁盘（开发期），cos 用腾讯云对象存储（生产）
//
// 切换：环境变量 STORAGE_DRIVER=cos 时启用 COS。COS 必填环境变量：
//   COS_SECRET_ID    腾讯云 API 密钥
//   COS_SECRET_KEY   腾讯云 API 密钥
//   COS_BUCKET       桶名 例：daka-prod-1300000000
//   COS_REGION       例：ap-shanghai / ap-guangzhou
//   COS_PUBLIC_HOST  访问域名，可选；不填会用 https://{bucket}.cos.{region}.myqcloud.com
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DRIVER = (process.env.STORAGE_DRIVER || 'disk').toLowerCase();
const UP_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UP_DIR, { recursive: true });

const extOf = (name = '', mime = '') => {
  const e = path.extname(name).toLowerCase();
  if (e) return e;
  if (mime.includes('mp4'))  return '.mp4';
  if (mime.includes('mpeg')) return '.mp3';
  if (mime.includes('jpeg')) return '.jpg';
  if (mime.includes('png'))  return '.png';
  if (mime.includes('markdown')) return '.md';
  return '';
};

const makeKey = (originalName, mime) => {
  const ts = Date.now();
  const rand = crypto.randomBytes(6).toString('hex');
  return `${ts}_${rand}${extOf(originalName, mime)}`;
};

let driver;
if (DRIVER === 'cos') {
  const COS = require('cos-nodejs-sdk-v5');
  const cos = new COS({
    SecretId:  process.env.COS_SECRET_ID,
    SecretKey: process.env.COS_SECRET_KEY,
  });
  const Bucket = process.env.COS_BUCKET;
  const Region = process.env.COS_REGION;
  const publicHost = process.env.COS_PUBLIC_HOST
    || `https://${Bucket}.cos.${Region}.myqcloud.com`;

  if (!process.env.COS_SECRET_ID || !process.env.COS_SECRET_KEY || !Bucket || !Region) {
    console.error('[storage] STORAGE_DRIVER=cos 但缺少必要的 COS_* 环境变量');
  }

  const put = (buffer, originalName, mime, fixedKey) => new Promise((resolve, reject) => {
    const Key = fixedKey || makeKey(originalName, mime);
    cos.putObject({
      Bucket, Region, Key, Body: buffer,
      ContentType: mime || 'application/octet-stream',
    }, (err) => {
      if (err) return reject(err);
      resolve(`${publicHost}/${Key}`);
    });
  });

  driver = { mode: 'cos', put };
} else {
  const put = async (buffer, originalName, mime, fixedKey) => {
    const Key = fixedKey || makeKey(originalName, mime);
    fs.writeFileSync(path.join(UP_DIR, Key), buffer);
    return `/uploads/${Key}`;
  };
  driver = { mode: 'disk', dir: UP_DIR, put };
}

console.log('[storage] driver=' + driver.mode);
module.exports = driver;
