const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const TABLES = ['users', 'tasks', 'task_members', 'checkin_items', 'checkin_records', 'counters'];
const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let collectionReady;
const knownCollections = new Set();

const ok = (data) => ({ statusCode: 200, data });
const fail = (statusCode, err) => ({ statusCode, data: { err } });
const nowSeconds = () => Math.floor(Date.now() / 1000);
const toId = (value) => Number(value) || 0;

const ensureCollections = () => {
  if (typeof db.createCollection !== 'function') return Promise.resolve();
  if (!collectionReady) {
    collectionReady = Promise.all(TABLES.map(name =>
      db.createCollection(name).catch(() => {})
    ));
  }
  return collectionReady;
};

const ensureCollection = async (name) => {
  if (knownCollections.has(name)) return;
  if (typeof db.createCollection === 'function') {
    try { await db.createCollection(name); } catch (_) {}
  }
  knownCollections.add(name);
};

const publicRow = (row) => {
  if (!row) return row;
  const copy = { ...row };
  delete copy._id;
  delete copy._openid;
  return copy;
};

const getAll = async (name, query = {}) => {
  await ensureCollection(name);
  const collection = db.collection(name);
  const source = Object.keys(query).length ? collection.where(query) : collection;
  let countResult;
  try {
    countResult = await source.count();
  } catch (e) {
    const message = e && (e.errMsg || e.message || String(e));
    if (/collection|not exist|not found/i.test(message)) return [];
    throw e;
  }
  const total = countResult.total || 0;
  const limit = 100;
  const rows = [];
  for (let skip = 0; skip < total; skip += limit) {
    const part = await source.skip(skip).limit(limit).get();
    rows.push(...(part.data || []));
  }
  return rows;
};

const findOne = async (name, predicate) => {
  const rows = await getAll(name);
  return rows.find(predicate) || null;
};

const filterRows = async (name, predicate) => {
  const rows = await getAll(name);
  return rows.filter(predicate);
};

const nextId = async (name) => {
  await ensureCollection('counters');
  const ref = db.collection('counters').doc(name);
  let updateResult;
  try {
    updateResult = await ref.update({ data: { value: _.inc(1) } });
  } catch (e) {
    const message = e && (e.errMsg || e.message || String(e));
    if (!/document|not exist|not found/i.test(message)) throw e;
  }

  const updated = updateResult && updateResult.stats && updateResult.stats.updated;
  if (!updated) {
    try {
      await ref.set({ data: { value: 1 } });
      return 1;
    } catch (e) {
      const message = e && (e.errMsg || e.message || String(e));
      if (!/document|exist|duplicate|already/i.test(message)) throw e;
      await ref.update({ data: { value: _.inc(1) } });
    }
  }

  let doc;
  try {
    doc = await ref.get();
  } catch (e) {
    const message = e && (e.errMsg || e.message || String(e));
    if (!/document|not exist|not found/i.test(message)) throw e;
    await ref.set({ data: { value: 1 } });
    return 1;
  }
  return Number(doc.data && doc.data.value) || 1;
};

const insert = async (name, row) => {
  await ensureCollection(name);
  const data = {
    ...row,
    id: await nextId(name),
    created_at: nowSeconds()
  };
  try {
    await db.collection(name).add({ data });
  } catch (e) {
    const message = e && (e.errMsg || e.message || String(e));
    throw new Error(`insert ${name} failed: ${message}`);
  }
  return data;
};

const updateWhere = async (name, predicate, patch) => {
  const rows = await getAll(name);
  const row = rows.find(predicate);
  if (!row) return null;
  await db.collection(name).doc(row._id).update({ data: patch });
  return { ...publicRow(row), ...patch };
};

const removeWhere = async (name, predicate) => {
  const rows = await getAll(name);
  const targets = rows.filter(predicate);
  await Promise.all(targets.map(row => db.collection(name).doc(row._id).remove()));
};

const code6 = () => Array.from({ length: 6 }, () =>
  codeAlphabet[Math.floor(Math.random() * codeAlphabet.length)]
).join('');

const normalizeInviteCode = (code) => String(code || '').trim().toUpperCase();

const tsvCell = (value) => {
  const cleaned = String(value == null ? '' : value).replace(/[\t\r\n]/g, ' ');
  return /^[=+\-@]/.test(cleaned.trimStart()) ? `'${cleaned}` : cleaned;
};

const bytesBase64 = (text) => Buffer.from(text, 'utf8').toString('base64');

const tempUrlMap = async (fileIDs) => {
  const ids = [...new Set((fileIDs || []).filter(id => String(id || '').startsWith('cloud://')))];
  if (!ids.length) return new Map();
  try {
    const result = await cloud.getTempFileURL({ fileList: ids });
    return new Map((result.fileList || []).map(file => [file.fileID, file.tempFileURL || file.fileID]));
  } catch (_) {
    return new Map();
  }
};

const withTempMediaUrls = async (items) => {
  const list = Array.isArray(items) ? items : [items];
  const map = await tempUrlMap(list.map(item => item && item.media_url));
  const converted = list.map(item => {
    if (!item) return item;
    const mediaUrl = map.get(item.media_url) || item.media_url;
    return mediaUrl === item.media_url ? item : { ...item, media_file_id: item.media_url, media_url: mediaUrl };
  });
  return Array.isArray(items) ? converted : converted[0];
};

const userView = async (user) => {
  const row = publicRow(user);
  if (!row) return row;
  const map = await tempUrlMap([row.avatar]);
  return {
    id: row.id,
    nickname: row.nickname,
    avatar: map.get(row.avatar) || row.avatar || ''
  };
};

const ensureUser = async (event, wxContext) => {
  const openid = wxContext.OPENID || event.openid || 'dev_openid';
  const unionid = wxContext.UNIONID || '';
  let user = (unionid && await findOne('users', u => u.unionid === unionid)) ||
    await findOne('users', u => u.openid === openid);
  if (!user) {
    user = await insert('users', {
      openid,
      unionid,
      nickname: (event.data && event.data.nickname) || '微信用户',
      avatar: (event.data && event.data.avatar) || ''
    });
  } else {
    const patch = {};
    if (unionid && user.unionid !== unionid) patch.unionid = unionid;
    if (openid && user.openid !== openid) patch.openid = openid;
    if (Object.keys(patch).length) user = await updateWhere('users', u => u.id === user.id, patch);
  }
  return publicRow(user);
};

const checkText = async (content, openid) => {
  const text = String(content || '').trim();
  if (!text) return { safe: true };
  try {
    const result = await cloud.openapi.security.msgSecCheck({
      version: 2,
      openid,
      scene: 2,
      content: text
    });
    const code = result.errCode == null ? result.errcode : result.errCode;
    const suggest = result.result && result.result.suggest;
    if (code === 87014 || suggest === 'risky') return { safe: false, reason: 'content rejected' };
    return { safe: true };
  } catch (e) {
    console.warn('[sec-check]', e && (e.errMsg || e.message) || e);
    return { safe: true };
  }
};

const checkMediaAsync = async (mediaUrl, mediaType, openid) => {
  try {
    let url = mediaUrl;
    if (String(url || '').startsWith('cloud://')) {
      const map = await tempUrlMap([url]);
      url = map.get(url) || url;
    }
    if (!/^https?:\/\//.test(String(url || ''))) return;
    await cloud.openapi.security.mediaCheckAsync({
      version: 2,
      openid,
      scene: 2,
      mediaUrl: url,
      mediaType
    });
  } catch (e) {
    console.warn('[media-check]', e && (e.errMsg || e.message) || e);
  }
};

const isCreator = async (tid, uid) => {
  const task = await findOne('tasks', t => t.id === tid);
  return !!task && task.admin_id === uid;
};

const isMember = async (tid, uid) => !!(await findOne('task_members', m => m.task_id === tid && m.user_id === uid));

const isAdmin = async (tid, uid) => {
  if (await isCreator(tid, uid)) return true;
  const member = await findOne('task_members', m => m.task_id === tid && m.user_id === uid);
  return !!member && member.role === 'admin';
};

const taskItems = async (tid) => {
  const items = await filterRows('checkin_items', item => item.task_id === tid);
  return items.map(publicRow).sort((a, b) => b.created_at - a.created_at || b.id - a.id);
};

const submittedRecords = async (tid, items) => {
  const itemList = items || await taskItems(tid);
  const ids = new Set(itemList.map(item => item.id));
  const records = await filterRows('checkin_records', record => record.submitted_at > 0 && ids.has(record.item_id));
  return records.map(publicRow);
};

const recordView = (record, itemById) => {
  const item = itemById.get(record.item_id) || {};
  return {
    id: record.id,
    item_id: record.item_id,
    item_title: item.title || '',
    note: record.note,
    watched_at: record.watched_at,
    submitted_at: record.submitted_at
  };
};

const memberAdminView = async (tid, member, currentItem, records) => {
  const user = await findOne('users', user => user.id === member.user_id) || {};
  const avatarMap = await tempUrlMap([user.avatar]);
  return {
    user_id: member.user_id,
    nickname: user.nickname || '',
    avatar: avatarMap.get(user.avatar) || user.avatar || '',
    real_name: member.real_name,
    role: member.role || (await isCreator(tid, member.user_id) ? 'creator' : 'member'),
    completed_count: records.length,
    current_done: !!(currentItem && records.some(record => record.item_id === currentItem.id))
  };
};

const parsePath = (url) => String(url || '').split('?')[0].replace(/\/+$/, '') || '/';

const handle = async (event, wxContext) => {
  await ensureCollections();

  const method = String(event.method || 'GET').toUpperCase();
  const path = parsePath(event.url);
  const body = event.data || {};
  const user = await ensureUser(event, wxContext);
  const openid = wxContext.OPENID || event.openid || 'dev_openid';

  if (path === '/api/login' && method === 'POST') {
    return ok({ token: 'cloud', user: await userView(user) });
  }

  if (path === '/api/me' && method === 'GET') {
    return ok(await userView(user));
  }

  if (path === '/api/me/profile' && method === 'PUT') {
    const patch = {};
    if (typeof body.nickname === 'string' && body.nickname.trim()) patch.nickname = body.nickname.trim().slice(0, 32);
    if (typeof body.avatar === 'string' && body.avatar) patch.avatar = body.avatar;
    if (!Object.keys(patch).length) return fail(400, 'nothing to update');
    const updated = await updateWhere('users', row => row.id === user.id, patch);
    if (!updated) return fail(404, 'not found');
    return ok(await userView(updated));
  }

  if (path === '/api/sec-check' && method === 'POST') {
    const checked = await checkText(body.content, openid);
    return ok({ safe: checked.safe !== false, reason: checked.reason || '' });
  }

  if (path === '/api/tasks' && method === 'POST') {
    const name = String(body.name || '').trim();
    if (!name) return fail(400, 'name required');
    const checked = await checkText(name, openid);
    if (!checked.safe) return fail(400, checked.reason);
    const task = await insert('tasks', {
      name,
      start_date: body.start_date || '',
      end_date: body.end_date || '',
      admin_id: user.id,
      invite_code: code6()
    });
    await insert('task_members', {
      task_id: task.id,
      user_id: user.id,
      real_name: '创建者',
      gender: '',
      age: 0,
      role: 'creator'
    });
    return ok(task);
  }

  if (path === '/api/tasks' && method === 'GET') {
    const mySubmittedRecords = await filterRows('checkin_records', record =>
      record.user_id === user.id && record.submitted_at > 0);
    const completedItemIds = new Set(mySubmittedRecords.map(record => record.item_id));
    const allItems = (await getAll('checkin_items')).map(publicRow);
    const itemsByTask = new Map();
    for (const item of allItems) {
      const items = itemsByTask.get(item.task_id) || [];
      items.push(item);
      itemsByTask.set(item.task_id, items);
    }
    for (const items of itemsByTask.values()) {
      items.sort((a, b) => b.created_at - a.created_at || b.id - a.id);
    }
    const memberships = await filterRows('task_members', member => member.user_id === user.id);
    const list = [];
    for (const membership of memberships) {
      const task = await findOne('tasks', task => task.id === membership.task_id);
      if (!task) continue;
      const items = itemsByTask.get(task.id) || [];
      const myCompletedCount = items.filter(item => completedItemIds.has(item.id)).length;
      const currentItem = items.slice().reverse().find(item => !completedItemIds.has(item.id)) || null;
      list.push({
        ...publicRow(task),
        role: await isAdmin(task.id, user.id) ? 'admin' : 'member',
        my_completed_count: myCompletedCount,
        item_count: items.length,
        current_item: await withTempMediaUrls(currentItem)
      });
    }
    list.sort((a, b) => b.created_at - a.created_at);
    return ok(list);
  }

  let match = path.match(/^\/api\/tasks\/by-code\/([^/]+)$/);
  if (match && method === 'GET') {
    const task = await findOne('tasks', task => task.invite_code === normalizeInviteCode(match[1]));
    if (!task) return fail(404, 'invalid code');
    return ok({
      id: task.id,
      name: task.name,
      start_date: task.start_date,
      end_date: task.end_date,
      joined: await isMember(task.id, user.id)
    });
  }

  if (path === '/api/tasks/join' && method === 'POST') {
    const realName = String(body.real_name || '').trim();
    if (!realName) return fail(400, 'real_name required');
    const task = await findOne('tasks', task => task.invite_code === normalizeInviteCode(body.invite_code));
    if (!task) return fail(404, 'invalid code');
    if (!(await isMember(task.id, user.id))) {
      await insert('task_members', {
        task_id: task.id,
        user_id: user.id,
        real_name: realName,
        gender: body.gender || '',
        age: Number(body.age) || 0,
        role: 'member'
      });
    }
    return ok({ task_id: task.id });
  }

  match = path.match(/^\/api\/tasks\/(\d+)$/);
  if (match && method === 'GET') {
    const tid = toId(match[1]);
    const task = await findOne('tasks', task => task.id === tid);
    if (!task) return fail(404, 'not found');
    if (!(await isMember(tid, user.id))) return fail(403, 'not member');
    const rawItems = await taskItems(tid);
    const taskSubmittedRecords = await submittedRecords(tid, rawItems);
    const myCompletedItemIds = new Set(taskSubmittedRecords.filter(record => record.user_id === user.id).map(record => record.item_id));
    const items = await withTempMediaUrls(rawItems.map(item => ({ ...item, done: myCompletedItemIds.has(item.id) })));
    const payload = {
      ...publicRow(task),
      items,
      is_admin: await isAdmin(tid, user.id),
      is_creator: await isCreator(tid, user.id)
    };
    if (payload.is_admin) {
      const latestItem = items[0] || null;
      const recordsByUser = new Map();
      for (const record of taskSubmittedRecords) {
        const records = recordsByUser.get(record.user_id) || [];
        records.push(record);
        recordsByUser.set(record.user_id, records);
      }
      const members = await filterRows('task_members', member => member.task_id === tid);
      payload.members = await Promise.all(members.map(member =>
        memberAdminView(tid, publicRow(member), latestItem, recordsByUser.get(member.user_id) || [])
      ));
      const completedCount = payload.members.filter(member => member.current_done).length;
      payload.admin_summary = {
        member_count: payload.members.length,
        completed_count: completedCount,
        incomplete_count: payload.members.length - completedCount,
        completion_rate: payload.members.length ? Math.round(completedCount / payload.members.length * 100) : 0
      };
    }
    return ok(payload);
  }

  if (match && method === 'DELETE') {
    const tid = toId(match[1]);
    if (!(await isCreator(tid, user.id))) return fail(403, 'creator only');
    const itemIds = new Set((await filterRows('checkin_items', item => item.task_id === tid)).map(item => item.id));
    await removeWhere('tasks', task => task.id === tid);
    await removeWhere('task_members', member => member.task_id === tid);
    await removeWhere('checkin_items', item => item.task_id === tid);
    await removeWhere('checkin_records', record => itemIds.has(record.item_id));
    return ok({ ok: true });
  }

  match = path.match(/^\/api\/tasks\/(\d+)\/members\/(\d+)\/records$/);
  if (match && method === 'GET') {
    const tid = toId(match[1]);
    const uid = toId(match[2]);
    if (!(await isAdmin(tid, user.id))) return fail(403, 'admin only');
    if (!(await isMember(tid, uid))) return fail(404, 'not member');
    const items = await taskItems(tid);
    const itemById = new Map(items.map(item => [item.id, item]));
    const records = (await filterRows('checkin_records', record =>
      record.user_id === uid && record.submitted_at > 0 && itemById.has(record.item_id)))
      .map(publicRow)
      .sort((a, b) => b.submitted_at - a.submitted_at)
      .map(record => recordView(record, itemById));
    return ok(records);
  }

  match = path.match(/^\/api\/tasks\/(\d+)\/members\/(\d+)\/role$/);
  if (match && method === 'POST') {
    const tid = toId(match[1]);
    const uid = toId(match[2]);
    if (!(await isCreator(tid, user.id))) return fail(403, 'creator only');
    if (!['admin', 'member'].includes(body.role)) return fail(400, 'role invalid');
    const member = await findOne('task_members', member => member.task_id === tid && member.user_id === uid);
    if (!member) return fail(404, 'not member');
    if (member.role === 'creator') return fail(400, 'cannot change creator');
    if (body.role === 'admin' && member.role !== 'admin') {
      const admins = await filterRows('task_members', m => m.task_id === tid && (m.role === 'creator' || m.role === 'admin'));
      if (admins.length >= 5) return fail(400, 'admin limit is 5');
    }
    await updateWhere('task_members', row => row.id === member.id, { role: body.role });
    return ok({ ok: true });
  }

  match = path.match(/^\/api\/tasks\/(\d+)\/members\/(\d+)$/);
  if (match && method === 'DELETE') {
    const tid = toId(match[1]);
    const uid = toId(match[2]);
    if (!(await isAdmin(tid, user.id))) return fail(403, 'admin only');
    const member = await findOne('task_members', member => member.task_id === tid && member.user_id === uid);
    if (!member) return fail(404, 'not found');
    if (member.role !== 'member') return fail(400, 'only regular members can be removed');
    await removeWhere('task_members', row => row.id === member.id);
    return ok({ ok: true });
  }

  match = path.match(/^\/api\/tasks\/(\d+)\/items$/);
  if (match && method === 'POST') {
    const tid = toId(match[1]);
    if (!(await isAdmin(tid, user.id))) return fail(403, 'admin only');
    const title = String(body.title || '').trim();
    if (!title || !body.media_url || !['audio', 'video'].includes(body.media_type)) {
      return fail(400, 'fields required');
    }
    const checked = await checkText(title, openid);
    if (!checked.safe) return fail(400, checked.reason);
    checkMediaAsync(body.media_url, body.media_type === 'audio' ? 1 : 2, openid);
    const item = await insert('checkin_items', {
      task_id: tid,
      title,
      media_type: body.media_type,
      media_url: body.media_url
    });
    return ok(await withTempMediaUrls(item));
  }

  match = path.match(/^\/api\/items\/(\d+)$/);
  if (match && method === 'GET') {
    const id = toId(match[1]);
    const item = await findOne('checkin_items', item => item.id === id);
    if (!item) return fail(404, 'not found');
    if (!(await isMember(item.task_id, user.id))) return fail(403, 'not member');
    const record = await findOne('checkin_records', record => record.item_id === id && record.user_id === user.id);
    return ok({
      ...(await withTempMediaUrls(publicRow(item))),
      my_record: publicRow(record) || null
    });
  }

  match = path.match(/^\/api\/items\/(\d+)\/watched$/);
  if (match && method === 'POST') {
    const id = toId(match[1]);
    const item = await findOne('checkin_items', item => item.id === id);
    if (!item) return fail(404, 'not found');
    if (!(await isMember(item.task_id, user.id))) return fail(403, 'not member');
    const record = await findOne('checkin_records', record => record.item_id === id && record.user_id === user.id);
    if (!record) {
      await insert('checkin_records', { item_id: id, user_id: user.id, note: '', watched_at: Date.now(), submitted_at: 0 });
    } else if (!record.watched_at) {
      await updateWhere('checkin_records', row => row.id === record.id, { watched_at: Date.now() });
    }
    return ok({ ok: true });
  }

  match = path.match(/^\/api\/items\/(\d+)\/submit$/);
  if (match && method === 'POST') {
    const id = toId(match[1]);
    const note = String(body.note || '').trim();
    const item = await findOne('checkin_items', item => item.id === id);
    if (!item) return fail(404, 'not found');
    if (!(await isMember(item.task_id, user.id))) return fail(403, 'not member');
    if (!note) return fail(400, 'note required');
    const checked = await checkText(note, openid);
    if (!checked.safe) return fail(400, checked.reason);
    const record = await findOne('checkin_records', record => record.item_id === id && record.user_id === user.id);
    if (!record || !record.watched_at) return fail(400, 'must watch first');
    if (record.submitted_at) return fail(409, 'already submitted');
    await updateWhere('checkin_records', row => row.id === record.id, { note, submitted_at: Date.now() });
    return ok({ ok: true });
  }

  match = path.match(/^\/api\/tasks\/(\d+)\/my-records$/);
  if (match && method === 'GET') {
    const tid = toId(match[1]);
    if (!(await isMember(tid, user.id))) return fail(403, 'not member');
    const items = await taskItems(tid);
    const itemById = new Map(items.map(item => [item.id, item]));
    const records = (await filterRows('checkin_records', record =>
      record.user_id === user.id && record.submitted_at > 0 && itemById.has(record.item_id)))
      .map(publicRow)
      .sort((a, b) => b.submitted_at - a.submitted_at)
      .map(record => recordView(record, itemById));
    return ok(records);
  }

  match = path.match(/^\/api\/tasks\/(\d+)\/admin-export$/);
  if (match && method === 'POST') {
    const tid = toId(match[1]);
    const task = await findOne('tasks', task => task.id === tid);
    if (!task) return fail(404, 'not found');
    if (!(await isAdmin(tid, user.id))) return fail(403, 'admin only');
    const items = await taskItems(tid);
    const itemById = new Map(items.map(item => [item.id, item]));
    const recordsByUser = new Map();
    for (const record of await submittedRecords(tid, items)) {
      const records = recordsByUser.get(record.user_id) || [];
      records.push(record);
      recordsByUser.set(record.user_id, records);
    }
    const members = await filterRows('task_members', member => member.task_id === tid);
    const rows = [];
    for (const member of members) {
      const memberUser = await findOne('users', row => row.id === member.user_id) || {};
      const name = member.real_name || memberUser.nickname || member.user_id;
      for (const record of recordsByUser.get(member.user_id) || []) {
        const item = itemById.get(record.item_id) || {};
        rows.push([
          task.name || '',
          name,
          item.title || '',
          new Date(record.submitted_at).toLocaleString('zh-CN'),
          record.note
        ].map(tsvCell).join('\t'));
      }
    }
    if (!rows.length) return fail(400, 'no records');
    const header = ['Task', 'Member', 'Item', 'Submitted At', 'Note'].map(tsvCell).join('\t');
    return ok({
      filename: `admin_export_t${tid}_${Date.now()}.tsv`,
      mime_type: 'text/tab-separated-values; charset=utf-8',
      content_base64: bytesBase64(`${header}\n${rows.join('\n')}`)
    });
  }

  match = path.match(/^\/api\/tasks\/(\d+)\/export$/);
  if (match && method === 'POST') {
    const tid = toId(match[1]);
    if (!(await isMember(tid, user.id))) return fail(403, 'not member');
    const selectedIds = Array.isArray(body.record_ids) ? new Set(body.record_ids.map(Number)) : new Set();
    const items = await filterRows('checkin_items', item => item.task_id === tid);
    const itemIds = new Set(items.map(item => item.id));
    const records = (await filterRows('checkin_records', record =>
      record.user_id === user.id && record.submitted_at > 0 && itemIds.has(record.item_id)))
      .map(publicRow)
      .filter(record => !selectedIds.size || selectedIds.has(record.id))
      .sort((a, b) => a.submitted_at - b.submitted_at);
    if (!records.length) return fail(400, 'no records');
    const task = await findOne('tasks', task => task.id === tid) || {};
    const copyBody = records.map(record => {
      const item = items.find(row => row.id === record.item_id) || {};
      return [
        `## ${item.title || ''}`,
        '',
        `Submitted At: ${new Date(record.submitted_at).toLocaleString('zh-CN')}`,
        `Task: ${task.name || ''}`,
        `Item: ${item.title || ''}`,
        '',
        'Note:',
        record.note || ''
      ].join('\n');
    }).join('\n\n---\n\n');
    return ok({
      filename: `export_t${tid}_u${user.id}_${Date.now()}.md`,
      mime_type: 'text/markdown; charset=utf-8',
      content_base64: bytesBase64(`# ${task.name || ''} - My Check-in Export\n\n${copyBody}`)
    });
  }

  return fail(404, 'not found');
};

exports.main = async (event = {}) => {
  try {
    return await handle(event, cloud.getWXContext());
  } catch (e) {
    console.error('[api]', e);
    const message = e && (e.errMsg || e.message || String(e));
    return fail(500, `cloud function error: ${message}`);
  }
};
