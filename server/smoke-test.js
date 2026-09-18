// 端到端 API 自测脚本（任务版）
const BASE = 'http://localhost:3000';

const req = async (method, url, body, token) => {
  const r = await fetch(BASE + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
};

const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1); } else console.log('OK  :', msg); };
const routeMissing = r => r.status === 404 && !(r.data && r.data.err);

(async () => {
  const blockedLegacyExport = await req('GET', '/uploads/export_legacy.md');
  ok(blockedLegacyExport.status === 404 && (blockedLegacyExport.data.err === 'not found' || routeMissing(blockedLegacyExport)), '历史本人导出文件不可通过 uploads 公开访问');
  const blockedLegacyAdminExport = await req('GET', '/uploads/admin_export_legacy.tsv');
  ok(blockedLegacyAdminExport.status === 404 && (blockedLegacyAdminExport.data.err === 'not found' || routeMissing(blockedLegacyAdminExport)), '历史管理员导出文件不可通过 uploads 公开访问');

  // 1. 两位用户静默登录：仅凭 code，账号由后端按 openid 自动绑定
  const a  = await req('POST', '/api/login', { code: 'alice' });
  const b  = await req('POST', '/api/login', { code: 'bob' });
  ok(a.status === 200 && b.status === 200, '双用户登录');
  const tA = a.data.token, tB = b.data.token;

  // 1.1 同一个 code 再登录一次 → 必须复用同一个账号（账号一致性）
  const aAgain = await req('POST', '/api/login', { code: 'alice' });
  ok(aAgain.status === 200 && aAgain.data.user.id === a.data.user.id, '同一微信用户复用同一个账号');

  // 1.2 资料同步：通过 PUT /api/me/profile 更新昵称和头像
  const prof = await req('PUT', '/api/me/profile', { nickname: 'Alice', avatar: '/uploads/a.png' }, tA);
  ok(prof.status === 200 && prof.data.nickname === 'Alice' && prof.data.avatar === '/uploads/a.png', '资料同步成功');

  // 1.3 已有账号再次登录不会被覆盖资料
  const aKeep = await req('POST', '/api/login', { code: 'alice', nickname: '不该覆盖' });
  const me    = await req('GET', '/api/me', null, aKeep.data.token);
  ok(me.data.nickname === 'Alice', '登录接口不覆盖已有资料');

  // 后续接口仍以 B 为非管理员，给 B 也设置一下展示昵称
  await req('PUT', '/api/me/profile', { nickname: 'Bob' }, tB);

  // 2. A 创建任务
  const t = await req('POST', '/api/tasks', { name: '英语晨读', start_date: '2026-05-01', end_date: '2026-06-01' }, tA);
  ok(t.status === 200 && t.data.invite_code, '创建任务，邀请码=' + t.data.invite_code);
  const tid = t.data.id, code = t.data.invite_code;

  // 3. B 通过邀请码查询并加入（带入组信息）
  const peek = await req('GET', '/api/tasks/by-code/' + code, null, tB);
  ok(peek.status === 200 && peek.data.id === tid, 'B 预览邀请任务');
  const join = await req('POST', '/api/tasks/join', { invite_code: code, real_name: '小明', gender: '男', age: 24 }, tB);
  ok(join.status === 200, 'B 加入任务');

  // 4. A 发布一条视频打卡
  const item = await req('POST', `/api/tasks/${tid}/items`, { title: 'Day1 朗读', media_type: 'video', media_url: '/uploads/demo.mp4' }, tA);
  ok(item.status === 200, 'A 发布打卡内容');
  const iid = item.data.id;

  // 5. B 未观看直接提交 → 失败
  const earlySubmit = await req('POST', `/api/items/${iid}/submit`, { note: '太早了' }, tB);
  ok(earlySubmit.status === 400, '未观看不能提交');

  // 6. B 标记观看 → 提交心得
  const watched = await req('POST', `/api/items/${iid}/watched`, {}, tB);
  ok(watched.status === 200, 'B 已观看');
  const unsafeNote = '=SUM(1,1)\t分隔\r独立回车\n独立换行';
  const submit = await req('POST', `/api/items/${iid}/submit`, { note: unsafeNote }, tB);
  ok(submit.status === 200, 'B 提交心得');

  // 7. A/B 任务摘要反映各自角色、完成进度和当前任务
  const adminTasks = await req('GET', '/api/tasks', null, tA);
  const memberTasks = await req('GET', '/api/tasks', null, tB);
  const adminTasksData = Array.isArray(adminTasks.data) ? adminTasks.data : [];
  const memberTasksData = Array.isArray(memberTasks.data) ? memberTasks.data : [];
  const adminTaskSummary = adminTasksData.find(task => task && task.id === tid);
  const memberTaskSummary = memberTasksData.find(task => task && task.id === tid);
  ok(memberTasks.status === 200 && Array.isArray(memberTasks.data) && memberTaskSummary && memberTaskSummary.role === 'member', 'B 任务摘要角色为普通成员');
  ok(memberTaskSummary && memberTaskSummary.my_completed_count === 1 && memberTaskSummary.item_count === 1, 'B 任务摘要包含本人完成数和任务数');
  ok(memberTaskSummary && memberTaskSummary.current_item === null, 'B 完成唯一打卡后无当前任务');
  ok(adminTasks.status === 200 && Array.isArray(adminTasks.data) && adminTaskSummary && adminTaskSummary.role === 'admin', 'A 任务摘要角色为管理员');
  ok(adminTaskSummary && adminTaskSummary.my_completed_count === 0 && adminTaskSummary.item_count === 1, 'A 任务摘要包含本人完成数和任务数');
  ok(adminTaskSummary && adminTaskSummary.current_item && adminTaskSummary.current_item.id === iid, 'A 当前任务为唯一未完成打卡');

  // 8. 重复提交 → 失败
  const dup = await req('POST', `/api/items/${iid}/submit`, { note: '重提' }, tB);
  ok(dup.status === 409, '重复提交被拒');

  // 9. 普通成员可查看任务，但看不到成员列表和管理员统计
  const memberDetail = await req('GET', `/api/tasks/${tid}`, null, tB);
  const memberDetailData = memberDetail.data && typeof memberDetail.data === 'object' ? memberDetail.data : {};
  ok(memberDetail.status === 200, '成员可查看参与任务');
  ok(!('members' in memberDetailData), '成员任务详情不返回成员列表');
  ok(!('admin_summary' in memberDetailData), '成员任务详情不返回管理员统计');

  // 10. 管理员可查看成员状态和任务统计
  const adminDetail = await req('GET', `/api/tasks/${tid}`, null, tA);
  const adminDetailData = adminDetail.data && typeof adminDetail.data === 'object' ? adminDetail.data : {};
  const adminMembers = Array.isArray(adminDetailData.members) ? adminDetailData.members : [];
  const adminItems = Array.isArray(adminDetailData.items) ? adminDetailData.items : [];
  const adminSummary = adminDetailData.admin_summary && typeof adminDetailData.admin_summary === 'object' ? adminDetailData.admin_summary : {};
  const aMember = adminMembers.find(m => m && m.user_id === a.data.user.id);
  const bMember = adminMembers.find(m => m && m.user_id === b.data.user.id);
  ok(adminDetail.status === 200 && Array.isArray(adminDetailData.members), '管理员可查看成员状态');
  ok(adminSummary.member_count === 2, '管理员统计包含成员总数');
  ok(adminSummary.completed_count === 1 && adminSummary.incomplete_count === 1 && adminSummary.completion_rate === 50, '管理员统计包含当前完成情况');
  ok(adminItems.length === 1 && adminDetailData.is_creator && adminDetailData.is_admin, '管理员任务详情包含打卡内容和管理身份');
  ok(bMember && bMember.role === 'member' && bMember.current_done === true, 'B 初始为普通成员且已完成当前打卡');
  ok(aMember && aMember.current_done === false, 'A 尚未完成当前打卡');

  // 11. 管理员可查看任务内成员记录，普通成员不可查看其他成员记录
  const adminRecords = await req('GET', `/api/tasks/${tid}/members/${b.data.user.id}/records`, null, tA);
  const adminRecordsData = Array.isArray(adminRecords.data) ? adminRecords.data : [];
  ok(adminRecords.status === 200 && Array.isArray(adminRecords.data) && adminRecordsData.length === 1, '管理员可查看本任务成员记录');
  const memberDenied = await req('GET', `/api/tasks/${tid}/members/${a.data.user.id}/records`, null, tB);
  ok(memberDenied.status === 403, '普通成员不可查看其他成员记录');

  // 12. B 只能查看本人记录，且记录不包含社交字段
  const my = await req('GET', `/api/tasks/${tid}/my-records`, null, tB);
  const myData = Array.isArray(my.data) ? my.data : [];
  const myRecord = myData[0] && typeof myData[0] === 'object' ? myData[0] : null;
  ok(my.status === 200 && Array.isArray(my.data) && myData.length === 1, '成员可查看本人记录');
  ok(myRecord && !('post_id' in myRecord) && !('likes' in myRecord) && !('comments' in myRecord), '本人记录不包含社交字段');

  // 13. 管理员可导出任务完成数据，普通成员不可导出
  const adminExport = await req('POST', `/api/tasks/${tid}/admin-export`, {}, tA);
  const adminTsv = Buffer.from(adminExport.data.content_base64 || '', 'base64').toString('utf8');
  const adminTsvLines = adminTsv.split('\n');
  const adminTsvHeader = (adminTsvLines[0] || '').split('\t');
  const adminTsvRow = (adminTsvLines[1] || '').split('\t');
  ok(adminExport.status === 200
    && adminExport.data.mime_type === 'text/tab-separated-values; charset=utf-8'
    && adminExport.data.filename.endsWith('.tsv')
    && typeof adminExport.data.content_base64 === 'string'
    && !('url' in adminExport.data), '管理员可内联导出任务完成数据');
  ok(adminTsvHeader.join('|') === '任务|成员|打卡内容|打卡日期|打卡心得' && adminTsvRow.length === 5, '管理员 TSV 包含正确标题行和五列记录');
  ok(adminTsvRow[0] === '英语晨读' && adminTsvRow[1] === '小明' && adminTsvRow[2] === 'Day1 朗读' && adminTsvRow[4] === "'=SUM(1,1) 分隔 独立回车 独立换行", '管理员 TSV 包含任务、成员、打卡内容、心得且阻止公式注入');
  ok(!adminTsv.includes('/uploads/') && !adminTsv.includes('http://') && !adminTsv.includes('https://'), '管理员 TSV 不包含公开 URL');
  const deniedExport = await req('POST', `/api/tasks/${tid}/admin-export`, {}, tB);
  ok(deniedExport.status === 403, '普通成员不可导出任务完成数据');

  // 14. 导出心得
  const exp = await req('POST', `/api/tasks/${tid}/export`, {}, tB);
  const markdown = Buffer.from(exp.data.content_base64 || '', 'base64').toString('utf8');
  ok(exp.status === 200
    && exp.data.mime_type === 'text/markdown; charset=utf-8'
    && exp.data.filename.endsWith('.md')
    && typeof exp.data.content_base64 === 'string'
    && !('url' in exp.data), '本人记录以内联 markdown 导出');
  ok(markdown.includes('打卡日期：')
    && markdown.includes('打卡任务名称：英语晨读')
    && markdown.includes('打卡内容名称：Day1 朗读')
    && markdown.includes(unsafeNote), '本人内联导出包含打卡日期、任务名称、内容名称和心得');

  // 15. 社交接口均已下线
  for (const [method, url, body] of [
    ['GET', `/api/tasks/${tid}/rank`],
    ['GET', `/api/tasks/${tid}/posts`],
    ['POST', `/api/tasks/${tid}/posts`, { content: '不可发布' }],
    ['GET', '/api/posts/1'],
    ['POST', '/api/posts/1/comment', { content: '不可评论' }],
    ['POST', '/api/posts/1/like', {}]
  ]) {
    const r = await req(method, url, body, tA);
    ok(routeMissing(r), `社交接口已下线: ${method} ${url}`);
  }

  // 16. 多管理员：A 提升 B 为管理员 → B 也能发布打卡
  const promote = await req('POST', `/api/tasks/${tid}/members/${b.data.user.id}/role`, { role: 'admin' }, tA);
  ok(promote.status === 200, 'A 提升 B 为管理员');
  const item2 = await req('POST', `/api/tasks/${tid}/items`, { title: 'Day2 朗读', media_type: 'audio', media_url: '/uploads/d.mp3' }, tB);
  ok(item2.status === 200, '管理员 B 也能发布打卡');

  // 17. 普通管理员不能改其他人角色
  const c = await req('POST', '/api/login', { code: 'carol' });
  await req('PUT', '/api/me/profile', { nickname: 'Carol' }, c.data.token);
  await req('POST', '/api/tasks/join', { invite_code: code, real_name: '小红', gender: '女', age: 22 }, c.data.token);
  const denied = await req('POST', `/api/tasks/${tid}/members/${c.data.user.id}/role`, { role: 'admin' }, tB);
  ok(denied.status === 403, '普通管理员无权设角色');

  // 18. 创建者撤销 B 的管理员
  const demote = await req('POST', `/api/tasks/${tid}/members/${b.data.user.id}/role`, { role: 'member' }, tA);
  ok(demote.status === 200, 'A 撤销 B 的管理员');

  // 19. 上限 5 人：模拟已有 5 人时再设第 6 人会被拒
  // 当前 creator(A) 共 1 人。先把 B/C 都设为 admin，再多加 3 人加任务，前 3 个设 admin 应成功，第 4 个失败
  await req('POST', `/api/tasks/${tid}/members/${b.data.user.id}/role`, { role: 'admin' }, tA);
  await req('POST', `/api/tasks/${tid}/members/${c.data.user.id}/role`, { role: 'admin' }, tA);
  const extras = [];
  for (let i = 0; i < 3; i++) {
    const u = await req('POST', '/api/login', { code: 'extra' + i });
    await req('PUT', '/api/me/profile', { nickname: 'E' + i }, u.data.token);
    await req('POST', '/api/tasks/join', { invite_code: code, real_name: 'E' + i, age: 20 }, u.data.token);
    extras.push(u.data.user.id);
  }
  const r1 = await req('POST', `/api/tasks/${tid}/members/${extras[0]}/role`, { role: 'admin' }, tA);
  const r2 = await req('POST', `/api/tasks/${tid}/members/${extras[1]}/role`, { role: 'admin' }, tA);
  const r3 = await req('POST', `/api/tasks/${tid}/members/${extras[2]}/role`, { role: 'admin' }, tA);
  ok(r1.status === 200 && r2.status === 200 && r3.status === 400, '管理员上限 5 人生效');

  // 20. 管理员可移除普通成员，不能移除管理员
  const kickAdmin = await req('DELETE', `/api/tasks/${tid}/members/${b.data.user.id}`, null, tA);
  ok(kickAdmin.status === 400, '不能直接移除管理员');
  const kickMember = await req('DELETE', `/api/tasks/${tid}/members/${extras[2]}`, null, tA);
  ok(kickMember.status === 200, '可移除普通成员');

  // 21. 仅创建者能解散任务
  const denyDel = await req('DELETE', `/api/tasks/${tid}`, null, tB);
  ok(denyDel.status === 403, '非创建者不能解散');
  const del = await req('DELETE', `/api/tasks/${tid}`, null, tA);
  ok(del.status === 200, '创建者解散任务');
  const gone = await req('GET', `/api/tasks/${tid}`, null, tA);
  ok(gone.status === 404, '任务及其数据已删除');

  console.log('\n全部接口自测通过 ✅');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
