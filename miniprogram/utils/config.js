// 接口地址按小程序运行环境自动切换：
//   develop = 微信开发者工具 / 真机调试
//   trial   = 体验版
//   release = 正式版
//
// 上线流程：
//   1. 上线前把 PROD_API_BASE 改成你的 微信云托管 公网域名（必须 https）
//   2. 在「微信公众平台 → 开发管理 → 服务器域名」里把这个域名加到
//      request 合法域名 + uploadFile 合法域名 + downloadFile 合法域名
//
// 真机/局域网联调时，把 DEV_API_BASE 换成你电脑的局域网 IP（比如 192.168.x.x）。

const DEV_API_BASE  = 'http://192.168.31.6:3000';
const PROD_API_BASE = 'https://REPLACE_WITH_YOUR_CLOUDRUN_DOMAIN';

const getEnvVersion = () => {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion;
  } catch (_) {
    return 'develop';
  }
};

const env = getEnvVersion();
const apiBase = (env === 'release' || env === 'trial') ? PROD_API_BASE : DEV_API_BASE;

module.exports = { apiBase, env };
