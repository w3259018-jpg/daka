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
const axios = require('axios');
const cryptoJs = require('crypto');

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

// COS 签名算法（V5 版本）
const getCosAuth = (method, key, secretId, secretKey, bucket, region) => {
  const host = `${bucket}.cos.${region}.myqcloud.com`;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600; // 1小时有效期
  const keyTime = `${now};${exp}`;
  
  // SignKey
  const signKey = cryptoJs.createHmac('sha1', secretKey).update(keyTime).digest('hex');
  
  // HttpString
  const httpString = `${method.toLowerCase()}\n/${key}\n\nhost=${host}\n`;
  const sha1HttpString = cryptoJs.createHash('sha1').update(httpString).digest('hex');
  
  // StringToSign
  const stringToSign = `sha1\n${keyTime}\n${sha1HttpString}\n`;
  
  // Signature
  const signature = cryptoJs.createHmac('sha1', signKey).update(stringToSign).digest('hex');
  
  // Authorization
  const auth = `q-sign-algorithm=sha1&q-ak=${secretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=host&q-url-param-list=&q-signature=${signature}`;
  
  return auth;
};

let driver;
if (DRIVER === 'cos') {
  const secretId = process.env.COS_SECRET_ID;
  const secretKey = process.env.COS_SECRET_KEY;
  const bucket = process.env.COS_BUCKET;
  const region = process.env.COS_REGION;
  const publicHost = process.env.COS_PUBLIC_HOST || `https://${bucket}.cos.${region}.myqcloud.com`;

  if (!secretId || !secretKey || !bucket || !region) {
    console.error('[storage] STORAGE_DRIVER=cos 但缺少必要的 COS_* 环境变量');
  }

  const put = async (buffer, originalName, mime, fixedKey) => {
    const Key = fixedKey || makeKey(originalName, mime);
    const url = `https://${bucket}.cos.${region}.myqcloud.com/${Key}`;
    
    try {
      const auth = getCosAuth('PUT', Key, secretId, secretKey, bucket, region);
      
      await axios.put(url, buffer, {
        headers: {
          'Authorization': auth,
          'Content-Type': mime || 'application/octet-stream',
          'Host': `${bucket}.cos.${region}.myqcloud.com`
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });
      
      return `${publicHost}/${Key}`;
    } catch (err) {
      console.error('[storage] COS上传失败:', err.response?.data || err.message);
      throw new Error('COS上传失败');
    }
  };

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
