// 静态校验小程序：JSON 合法性 + JS 语法 + 引用文件存在性
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, 'miniprogram');
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('OK  :', m); };
const ng = (m) => { fail++; console.error('FAIL:', m); };

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
  for (const ext of ['.js', '.wxml', '.json']) {
    const file = path.join(ROOT, p + ext);
    if (fs.existsSync(file)) ok('page file: ' + p + ext);
    else ng('missing : ' + p + ext);
  }
}

// 4. 每个 wxml 至少有内容
for (const f of walk(ROOT, '.wxml')) {
  if (fs.readFileSync(f, 'utf8').trim()) ok('WXML: ' + path.relative(ROOT, f));
  else ng('WXML empty: ' + path.relative(ROOT, f));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
