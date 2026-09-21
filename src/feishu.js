import { config } from './config.js';

const BASE = 'https://open.feishu.cn';

let tokenCache = { token: '', expireAt: 0 };

export async function getToken(force = false) {
  if (!force && tokenCache.token && Date.now() < tokenCache.expireAt) return tokenCache.token;
  const res = await fetch(`${BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: config.feishuAppId, app_secret: config.feishuAppSecret }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`获取 token 失败: ${data.msg}`);
  tokenCache = { token: data.tenant_access_token, expireAt: Date.now() + (data.expire - 300) * 1000 };
  return tokenCache.token;
}

async function api(path, { method = 'GET', body, query } = {}) {
  const url = new URL(BASE + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, v);
  const token = await getToken();
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { throw new Error(`飞书接口响应异常 ${res.status} ${path}`); }
  // token 过期自动重试一次
  if ((data.code === 99991663 || data.code === 99991661) && !api._retried) {
    api._retried = true;
    try { return await api(path, { method, body, query }); }
    finally { api._retried = false; }
  }
  return data;
}

/* ================= 多维表格 ================= */

export async function createBitableApp(name) {
  const d = await api('/open-apis/bitable/v1/apps', { method: 'POST', body: { name } });
  if (d.code !== 0) throw new Error(`创建多维表格失败: ${d.msg}（code ${d.code}）`);
  return d.data.app; // { app_token, default_table_id, url }
}

export async function deleteBitableApp(appToken) {
  return api(`/open-apis/bitable/v1/apps/${appToken}`, { method: 'DELETE' });
}

export async function createTable(appToken, name) {
  const d = await api(`/open-apis/bitable/v1/apps/${appToken}/tables`, {
    method: 'POST',
    body: { table: { name }, default_view_name: '全部记录' },
  });
  if (d.code !== 0) throw new Error(`创建数据表失败: ${d.msg}`);
  return d.data.table_id;
}

export async function listTables(appToken) {
  const d = await api(`/open-apis/bitable/v1/apps/${appToken}/tables`);
  return d.code === 0 ? d.data.items || [] : [];
}

export async function listFields(appToken, tableId) {
  const d = await api(`/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`, { query: { page_size: 100 } });
  if (d.code !== 0) throw new Error(`读取字段失败: ${d.msg}`);
  return d.data.items || [];
}

export async function createField(appToken, tableId, field) {
  const d = await api(`/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`, { method: 'POST', body: field });
  if (d.code !== 0) throw new Error(`创建字段「${field.field_name}」失败: ${d.msg}`);
  return d.data.field;
}

export async function deleteField(appToken, tableId, fieldId) {
  return api(`/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${fieldId}`, { method: 'DELETE' });
}

export async function listRecords(appToken, tableId, { pageToken } = {}) {
  const d = await api(`/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`, {
    method: 'POST',
    query: { page_size: 500, page_token: pageToken },
    body: {},
  });
  if (d.code !== 0) throw new Error(`读取记录失败: ${d.msg}（code ${d.code}）`);
  return { items: d.data.items || [], pageToken: d.data.has_more ? d.data.page_token : '' };
}

/** 拉取全部记录（个人账本量级在几千行以内，一次拉全后在内存做筛选统计） */
export async function listAllRecords() {
  const all = [];
  let pageToken;
  do {
    const { items, pageToken: next } = await listRecords(config.bitableAppToken, config.bitableTableId, { pageToken });
    all.push(...items);
    pageToken = next;
  } while (pageToken);
  return all;
}

export async function createRecord(fields) {
  const d = await api(`/open-apis/bitable/v1/apps/${config.bitableAppToken}/tables/${config.bitableTableId}/records`, {
    method: 'POST',
    body: { fields },
  });
  if (d.code !== 0) throw new Error(`写入记录失败: ${d.msg}（code ${d.code}）`);
  return d.data.record;
}

export async function updateRecord(recordId, fields) {
  const d = await api(`/open-apis/bitable/v1/apps/${config.bitableAppToken}/tables/${config.bitableTableId}/records/${recordId}`, {
    method: 'PUT',
    body: { fields },
  });
  if (d.code !== 0) throw new Error(`更新记录失败: ${d.msg}`);
  return d.data.record;
}

export async function deleteRecord(recordId) {
  const d = await api(`/open-apis/bitable/v1/apps/${config.bitableAppToken}/tables/${config.bitableTableId}/records/${recordId}`, {
    method: 'DELETE',
  });
  if (d.code !== 0) throw new Error(`删除记录失败: ${d.msg}`);
  return true;
}

/* ================= 消息 ================= */

export async function sendText(openId, text) {
  const d = await api('/open-apis/im/v1/messages', {
    method: 'POST',
    query: { receive_id_type: 'open_id' },
    body: { receive_id: openId, msg_type: 'text', content: JSON.stringify({ text }) },
  });
  if (d.code !== 0) throw new Error(`发送消息失败: ${d.msg}（code ${d.code}）`);
  return true;
}

/** 下载消息中的资源文件（语音等），返回 Buffer */
export async function downloadMessageResource(messageId, fileKey) {
  const token = await getToken();
  const res = await fetch(`${BASE}/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=file`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`下载语音失败 HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/* ================= 语音识别（ASR） ================= */

/** pcm s16le 16k mono → 文本。飞书语音消息为 opus，需先用 ffmpeg 转码。 */
export async function asr(pcmBuffer) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let fileId = 'ws';
  for (let i = 0; i < 14; i++) fileId += chars[Math.floor(Math.random() * chars.length)];
  const d = await api('/open-apis/speech_to_text/v1/speech/file_recognize', {
    method: 'POST',
    body: { speech: { speech: pcmBuffer.toString('base64') }, config: { file_id: fileId, format: 'pcm', engine_type: '16k_auto' } },
  });
  if (d.code !== 0) throw new Error(`语音识别失败: ${d.msg}（code ${d.code}）`);
  return d.data?.recognition_text || '';
}

/** opus 音频 → 16k mono pcm（依赖本机 ffmpeg） */
export async function opusToPcm(opusBuffer) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ar', '16000', '-ac', '1', '-f', 's16le', '-c:a', 'pcm_s16le', 'pipe:1']);
    const out = [];
    let err = '';
    p.stdout.on('data', (c) => out.push(c));
    p.stderr.on('data', (c) => (err += c));
    p.on('error', () => reject(new Error('未找到 ffmpeg，请先安装：brew install ffmpeg')));
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg 转码失败: ${err.slice(0, 200)}`))));
    p.stdin.write(opusBuffer);
    p.stdin.end();
  });
}
