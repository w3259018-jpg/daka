// 静态校验小程序：JSON 合法性 + JS 语法 + 引用文件存在性
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, 'miniprogram');
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('OK  :', m); };
const ng = (m) => { fail++; console.error('FAIL:', m); };
const SOCIAL_PAGES = [
  'pages/forum/forum',
  'pages/post/post',
  'pages/rank/rank'
];
const BANNED_SOCIAL_REFERENCES = [
  /pages\/forum\/forum/g,
  /pages\/post\/post/g,
  /pages\/rank\/rank/g,
  /\/api\/tasks\/[^/'"`\s]+\/posts(?:[/?#'"`\s]|$)/g,
  /\/api\/posts(?:[/?#'"`\s]|$)/g,
  /\/rank(?:[/?#'"`\s]|$)/g
];

const requiredPageFiles = (pagePath, label) => {
  for (const ext of ['.js', '.wxml', '.json']) {
    const file = path.join(ROOT, pagePath + ext);
    if (fs.existsSync(file)) ok(`${label}: ${pagePath}${ext}`);
    else ng(`missing ${label}: ${pagePath}${ext}`);
  }
};

const walk = (dir, ext, out = []) => {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, ext, out);
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
};

// 1. JSON 全部能 parse
for (const f of walk(ROOT, '.json')) {
  try { JSON.parse(fs.readFileSync(f, 'utf8')); ok('JSON: ' + path.relative(ROOT, f)); }
  catch (e) { ng('JSON: ' + path.relative(ROOT, f) + ' - ' + e.message); }
}

// 2. JS 全部能编译（语法层）
for (const f of walk(ROOT, '.js')) {
  try { new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }); ok('JS  : ' + path.relative(ROOT, f)); }
  catch (e) { ng('JS  : ' + path.relative(ROOT, f) + ' - ' + e.message); }
}

// 3. app.json 中所有 page/tabBar 引用的文件都要存在（.js/.wxml/.json）
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
for (const p of app.pages) {
  requiredPageFiles(p, 'page file');
}

for (const item of (app.tabBar && app.tabBar.list || [])) {
  const pagePath = item.pagePath;
  if (app.pages.includes(pagePath)) ok('tabBar registered page: ' + pagePath);
  else ng('tabBar page is not registered in app.pages: ' + pagePath);

  requiredPageFiles(pagePath, 'tabBar file');
}

// 4. app.json 不得注册社交页面或社交 tab
for (const p of SOCIAL_PAGES) {
  if (app.pages.includes(p)) ng('app.pages contains social page: ' + p);
  else ok('app.pages excludes social page: ' + p);

  const tabPages = (app.tabBar && app.tabBar.list || []).map((item) => item.pagePath);
  if (tabPages.includes(p)) ng('app.tabBar contains social page: ' + p);
  else ok('app.tabBar excludes social page: ' + p);
}

for (const p of SOCIAL_PAGES) {
  const dir = path.join(ROOT, 'pages', p.split('/')[1]);
  if (fs.existsSync(dir)) ng('social page directory exists: ' + p);
  else ok('social page directory removed: ' + p);
}

// 5. JS/WXML/JSON 不得保留社交页面或 API 引用
for (const f of [...walk(ROOT, '.js'), ...walk(ROOT, '.wxml'), ...walk(ROOT, '.json')]) {
  const text = fs.readFileSync(f, 'utf8');
  for (const pattern of BANNED_SOCIAL_REFERENCES) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      ng(`banned social reference: ${path.relative(ROOT, f)} ${match[0]}`);
    }
  }
}

// 6. 每个 wxml 至少有内容
for (const f of walk(ROOT, '.wxml')) {
  if (fs.readFileSync(f, 'utf8').trim()) ok('WXML: ' + path.relative(ROOT, f));
  else ng('WXML empty: ' + path.relative(ROOT, f));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
