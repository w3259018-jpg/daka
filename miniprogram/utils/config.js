let env = 'develop';
try { env = wx.getAccountInfoSync().miniProgram.envVersion; } catch (_) {}

const cloudEnv = 'cloud1-d3g8sly7ab5d5b8d3';
const useCloud = true;
const apiBase = '';

module.exports = { apiBase, cloudEnv, env, useCloud };
