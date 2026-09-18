# Media Playback, Picker Text, and Join Age Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make newly uploaded WeChat audio/video playable, unify the picker label, and remove only the join-page age input.

**Architecture:** Preserve the original filename from `chooseMessageFile`, send it as multipart metadata, and normalize the filename/MIME pair on the server before storage. Keep the existing media URL contract and backend age compatibility unchanged.

**Tech Stack:** WeChat Mini Program JavaScript/WXML, Node.js, Express, Multer, Tencent COS, `node:test`.

---

## File map

- Create `server/media-metadata.js`: pure filename sanitization and MIME inference.
- Create `tests/media-upload.test.js`: client multipart metadata and server metadata regression tests.
- Modify `miniprogram/utils/api.js`: allow upload metadata through `formData`.
- Modify `miniprogram/pages/task/task.js`: one WeChat picker action and original filename upload.
- Modify `server/index.js`: normalize uploaded filename and MIME before calling storage.
- Modify `tests/page-profile-gates.test.js`: picker behavior and join payload regressions.
- Modify `miniprogram/pages/join/join.js`: remove page age state and request field.
- Modify `miniprogram/pages/join/join.wxml`: remove age input.

### Task 1: Preserve media metadata across the upload boundary

**Files:**
- Create: `tests/media-upload.test.js`
- Create: `server/media-metadata.js`
- Modify: `miniprogram/utils/api.js`
- Modify: `server/index.js`

- [ ] **Step 1: Write failing client and server metadata tests**

Create `tests/media-upload.test.js` with a VM-loaded `api.js` test that calls:

```js
await api.upload('wxfile://tmp/no-extension', { originalName: 'lesson.mp4' });
assert.deepEqual(uploadOptions.formData, { original_name: 'lesson.mp4' });
```

Add pure server assertions:

```js
assert.deepEqual(
  normalizeMediaMetadata('../lesson.mp4', 'application/octet-stream'),
  { originalName: 'lesson.mp4', mime: 'video/mp4' }
);
assert.deepEqual(
  normalizeMediaMetadata('voice.mp3', 'application/octet-stream'),
  { originalName: 'voice.mp3', mime: 'audio/mpeg' }
);
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/media-upload.test.js`

Expected: FAIL because `upload()` does not set `formData` and `server/media-metadata.js` does not exist.

- [ ] **Step 3: Implement the pure metadata normalizer**

Create `server/media-metadata.js` with `path.basename`, a fixed lowercase extension map for `.mp3`, `.m4a`, `.aac`, `.wav`, `.flac`, `.ogg`, `.mp4`, `.mov`, `.m4v`, `.avi`, `.wmv`, `.mkv`, and `.webm`, and this behavior:

```js
const normalizeMediaMetadata = (name, mime) => {
  const originalName = path.basename(String(name || '')) || 'upload';
  const inferred = MIME_BY_EXTENSION[path.extname(originalName).toLowerCase()];
  const generic = !mime || mime === 'application/octet-stream';
  return { originalName, mime: generic && inferred ? inferred : (mime || inferred || 'application/octet-stream') };
};
```

Export `{ normalizeMediaMetadata }`.

- [ ] **Step 4: Send and consume original filename metadata**

Change `upload` in `miniprogram/utils/api.js` to accept `options = {}` and include:

```js
formData: options.originalName ? { original_name: options.originalName } : undefined
```

In `server/index.js`, import `normalizeMediaMetadata`. In `/api/upload`, normalize `req.body.original_name || req.file.originalname` and `req.file.mimetype`, then call:

```js
const metadata = normalizeMediaMetadata(
  req.body.original_name || req.file.originalname,
  req.file.mimetype
);
const url = await storage.put(req.file.buffer, metadata.originalName, metadata.mime);
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `node --test tests/media-upload.test.js`

Expected: all tests PASS.

### Task 2: Unify the picker action and upload the selected filename

**Files:**
- Modify: `tests/page-profile-gates.test.js`
- Modify: `miniprogram/pages/task/task.js`

- [ ] **Step 1: Write failing picker tests**

Extend the test harness so `api.upload(filePath, options)` records both arguments and `wx.chooseMessageFile` records its options. Add tests for audio and video that assert:

```js
assert.deepEqual(actionSheet.itemList, ['从微信聊天中选择']);
```

Invoke `actionSheet.success({ tapIndex: 0 })`, resolve a selected file named `lesson.mp4` or `voice.mp3`, flush promises, and assert:

```js
assert.deepEqual(uploads[0], {
  filePath: 'wxfile://tmp/no-extension',
  options: { originalName: 'lesson.mp4' }
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/page-profile-gates.test.js`

Expected: FAIL because video exposes three labels and `uploadPickedMedia` does not pass `originalName`.

- [ ] **Step 3: Implement the single WeChat picker path**

In `chooseMedia`, always set:

```js
const itemList = ['从微信聊天中选择'];
```

For audio call `pickAudioFile()`; for video call `pickVideoFile()`. Remove unused `pickChatVideo()` and `pickAlbumVideo()` methods. In `uploadPickedMedia`, call:

```js
const result = await upload(file.filePath, { originalName: file.name });
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test tests/page-profile-gates.test.js`

Expected: all tests PASS.

### Task 3: Remove only the join-page age input

**Files:**
- Modify: `tests/page-profile-gates.test.js`
- Modify: `miniprogram/pages/join/join.js`
- Modify: `miniprogram/pages/join/join.wxml`

- [ ] **Step 1: Write failing join-page tests**

Strengthen the allowed join flow assertion to require exactly:

```js
assert.deepEqual(join.requests[0].options.data, {
  invite_code: 'ABC123',
  real_name: 'Alice',
  gender: '男'
});
```

Read `join.wxml` and assert it contains neither `placeholder="年龄"` nor `data-k="age"`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/page-profile-gates.test.js`

Expected: FAIL because the page still renders and submits age.

- [ ] **Step 3: Remove page-only age handling**

Delete `age` from page data, destructuring, and request data in `join.js`. Delete only this WXML element:

```xml
<input class="input" type="number" placeholder="年龄" value="{{age}}" bindinput="onInput" data-k="age" />
```

Do not modify the server join route, database, agreement, or privacy policy.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test tests/page-profile-gates.test.js`

Expected: all tests PASS.

### Task 4: Full verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run the complete unit test suite**

Run: `node --test tests/*.test.js`

Expected: all tests PASS with zero failures.

- [ ] **Step 2: Run Mini Program static validation**

Run: `node check-miniprogram.js`

Expected: exit code 0 and final output reports `0 failed`.

- [ ] **Step 3: Run server syntax checks**

Run: `node --check server/index.js; node --check server/storage.js; node --check server/media-metadata.js`

Expected: all commands exit 0.

- [ ] **Step 4: Inspect the scoped diff**

Run: `git diff --check -- miniprogram/utils/api.js miniprogram/pages/task/task.js miniprogram/pages/join/join.js miniprogram/pages/join/join.wxml server/index.js server/media-metadata.js tests/media-upload.test.js tests/page-profile-gates.test.js`

Expected: no whitespace errors. Confirm no changes to backend age compatibility or legal documents.

Git commits are intentionally omitted because repository write approval was not granted. Existing unrelated working-tree changes must remain untouched.
