# Export Copy Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change user and administrator check-in exports so mobile users get copyable text in the clipboard instead of a local file path.

**Architecture:** Keep the existing inline export API shape with `content_base64`. Server routes format clearer text, while miniprogram pages decode base64 and copy the decoded UTF-8 text directly with `wx.setClipboardData`.

**Tech Stack:** WeChat miniprogram JavaScript, Node.js Express, Node built-in test runner.

---

### Task 1: Add Failing Client Export Copy Tests

**Files:**
- Modify: `tests/page-profile-gates.test.js`

- [ ] **Step 1: Extend the page test harness**

Add collection for `wx.setClipboardData` calls and expose it in `loadPage()`:

```js
const clipboardWrites = [];

setClipboardData(options) {
  clipboardWrites.push({ data: options.data });
  if (options.success) options.success();
}

return {
  clipboardWrites
};
```

- [ ] **Step 2: Add records export test**

```js
test('records.exportNotes copies decoded export content instead of a file path', async () => {
  const content = '# 打卡导出\n\n打卡任务名称：Morning\n';
  const page = loadPage('records', {
    requestImpl(url) {
      if (url === '/api/tasks/7/export') {
        return { content_base64: Buffer.from(content, 'utf8').toString('base64') };
      }
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  page.context.data.taskId = 7;

  await page.context.exportNotes();

  assert.deepEqual(page.clipboardWrites, [{ data: content }]);
  assert.equal(page.toasts.at(-1).title, '导出内容已复制');
});
```

- [ ] **Step 3: Add admin export test**

```js
test('task.exportAdminData copies decoded admin export content instead of a file path', async () => {
  const content = '任务\t成员\t打卡内容\t打卡日期\t打卡心得\nMorning\tAlice\tDay1\t2026/7/1\tDone';
  const page = loadPage('task', {
    requestImpl(url) {
      if (url === '/api/tasks/7/admin-export') {
        return { content_base64: Buffer.from(content, 'utf8').toString('base64') };
      }
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  page.context.data.id = 7;

  await page.context.exportAdminData();

  assert.deepEqual(page.clipboardWrites, [{ data: content }]);
  assert.equal(page.toasts.at(-1).title, '导出内容已复制');
});
```

- [ ] **Step 4: Run red test**

Run: `node --test tests/page-profile-gates.test.js`

Expected: FAIL because pages still write files or `wx.setClipboardData` is not called with decoded content.

### Task 2: Implement Client Clipboard Copy

**Files:**
- Modify: `miniprogram/pages/records/records.js`
- Modify: `miniprogram/pages/task/task.js`

- [ ] **Step 1: Add base64 decoder helper**

In each page file, add a small helper near the top:

```js
const decodeExportText = (contentBase64) => {
  if (!contentBase64) return '';
  try {
    return decodeURIComponent(escape(wx.base64ToArrayBuffer
      ? String.fromCharCode.apply(null, new Uint8Array(wx.base64ToArrayBuffer(contentBase64)))
      : Buffer.from(contentBase64, 'base64').toString('binary')));
  } catch (_) {
    try {
      return Buffer.from(contentBase64, 'base64').toString('utf8');
    } catch (__) {
      return '';
    }
  }
};
```

- [ ] **Step 2: Replace file write in `records.handleExport()`**

Decode and copy text:

```js
handleExport(contentBase64) {
  const content = decodeExportText(contentBase64);
  if (!content) return toast('导出失败');
  wx.setClipboardData({
    data: content,
    success: () => toast('导出内容已复制', 'success'),
    fail: () => toast('复制失败，请重试')
  });
}
```

- [ ] **Step 3: Replace file write in `task.exportAdminData()`**

Decode and copy text:

```js
const content = decodeExportText(result.content_base64);
if (!content) return toast('导出内容为空');
wx.setClipboardData({
  data: content,
  success: () => toast('导出内容已复制', 'success'),
  fail: () => toast('复制失败，请重试')
});
```

- [ ] **Step 4: Run client tests**

Run: `node --test tests/page-profile-gates.test.js`

Expected: PASS.

### Task 3: Format Server Export Text

**Files:**
- Modify: `server/index.js`
- Modify: `server/smoke-test.js`

- [ ] **Step 1: Update admin export TSV**

Change rows to include task name first and use these headers:

```js
const headers = ['任务', '成员', '打卡内容', '打卡日期', '打卡心得'];
```

- [ ] **Step 2: Update personal export Markdown**

Each record should render:

```md
## 打卡内容名称：Day1

打卡日期：2026/7/1 10:00:00
打卡任务名称：Morning
打卡内容名称：Day1

打卡心得：
Done
```

- [ ] **Step 3: Extend smoke assertions**

Assert personal export contains `打卡任务名称`, `打卡内容名称`, `打卡日期`, and the note. Assert admin TSV starts with `任务\t成员\t打卡内容\t打卡日期\t打卡心得`.

- [ ] **Step 4: Run server syntax checks and smoke test**

Run:

```bash
node --check server/index.js
node --check server/smoke-test.js
node server/smoke-test.js
```

Expected: checks pass and smoke test exits 0.

### Task 4: Final Validation

**Files:**
- Read: `check-miniprogram.js`

- [ ] **Step 1: Run miniprogram static check**

Run: `node check-miniprogram.js`

Expected: exits 0.

- [ ] **Step 2: Review diff**

Run: `git diff -- miniprogram/pages/records/records.js miniprogram/pages/task/task.js server/index.js server/smoke-test.js tests/page-profile-gates.test.js docs/superpowers/specs/2026-07-01-export-copy-text-design.md docs/superpowers/plans/2026-07-01-export-copy-text.md`

Expected: diff only contains export copy text changes and the two documentation files.
