// 接口地址自动切换：
//   微信开发者工具(devtools) → DEV_API_BASE（局域网 IP，方便本地联调）
//   真机调试 / 体验版 / 正式版 → PROD_API_BASE（线上 https 域名）
//
// 上线前需在「微信公众平台 → 开发管理 → 服务器域名」里把 PROD_API_BASE
// 加到 request / uploadFile / downloadFile 合法域名。

const DEV_API_BASE  = 'http://192.168.31.6:3000';
const PROD_API_BASE = 'https://weiyidaka.online';

let env = 'develop';
let platform = '';
try { env = wx.getAccountInfoSync().miniProgram.envVersion; } catch (_) {}
try { platform = wx.getSystemInfoSync().platform; } catch (_) {}

const apiBase = PROD_API_BASE;

module.exports = { apiBase, env };
