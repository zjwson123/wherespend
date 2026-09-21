import { listAllRecords } from './feishu.js';

/** 多维表格原始记录 → 统一结构 */
export function normalizeRecord(item) {
  const f = item.fields || {};
  const pickText = (v) => {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : x?.text || '')).join('');
    if (typeof v === 'object') return v.text ?? v.name ?? '';
    return '';
  };
  const pickNum = (v) => (typeof v === 'number' ? v : Number(v) || 0);
  const pickDate = (v) => {
    if (typeof v === 'number') return new Date(v);
    if (typeof v === 'string') {
      const n = Number(v);
      return new Date(isFinite(n) && n > 1e12 ? n : v.replace(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/, '$1T$2+08:00'));
    }
    return new Date();
  };
  return {
    recordId: item.record_id,
    date: pickDate(f['日期']),
    type: pickText(f['类型']) || '支出',
    amount: pickNum(f['金额']),
    item: pickText(f['事项']) || '消费',
    category: pickText(f['分类']) || '其他',
    subCategory: pickText(f['子分类']),
    account: pickText(f['支付账户']) || '未指定',
    platform: pickText(f['来源平台']),
    note: pickText(f['备注']),
    raw: pickText(f['原始语句']),
    source: pickText(f['记录来源']) || '机器人',
  };
}

/* 记录缓存：个人账本量级小，30s 内复用，写入后主动失效 */
let cache = { at: 0, records: [] };
export function invalidateRecordCache() { cache.at = 0; }

export async function getRecords({ maxAgeMs = 30000 } = {}) {
  if (cache.at && Date.now() - cache.at < maxAgeMs) return cache.records;
  const items = await listAllRecords();
  cache = { at: Date.now(), records: items.map(normalizeRecord).sort((a, b) => b.date - a.date) };
  return cache.records;
}

const day = 86400000;
function dayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

/** 周一定为一周起点 */
function weekStart(d) {
  const x = dayStart(d);
  const diff = (x.getDay() + 6) % 7;
  return new Date(x.getTime() - diff * day);
}
function monthStart(d) { const x = dayStart(d); x.setDate(1); return x; }
function yearStart(d) { const x = monthStart(d); x.setMonth(0); return x; }

export function rangeFor(period, now = new Date()) {
  switch (period) {
    case 'today': return { from: dayStart(now), to: now, label: '今天' };
    case 'yesterday': { const y = new Date(dayStart(now).getTime() - day); return { from: y, to: new Date(y.getTime() + day), label: '昨天' }; }
    case 'this_week': return { from: weekStart(now), to: now, label: '本周' };
    case 'last_week': { const s = new Date(weekStart(now).getTime() - 7 * day); return { from: s, to: new Date(s.getTime() + 7 * day), label: '上周' }; }
    case 'last_month': { const s = new Date(monthStart(now)); s.setMonth(s.getMonth() - 1); return { from: s, to: monthStart(now), label: '上月' }; }
    case 'this_year': return { from: yearStart(now), to: now, label: '今年' };
    case 'all': return { from: new Date(0), to: now, label: '全部' };
    case 'this_month':
    default: return { from: monthStart(now), to: now, label: '本月' };
  }
}

export function summarize(records, { from, to }) {
  const inRange = records.filter((r) => r.date >= from && r.date < to);
  const expenseRecords = inRange.filter((r) => r.type === '支出');
  const incomeRecords = inRange.filter((r) => r.type === '收入');
  const byCategory = new Map();
  for (const r of expenseRecords) byCategory.set(r.category, (byCategory.get(r.category) || 0) + r.amount);
  const byDay = new Map();
  for (const r of expenseRecords) {
    const k = r.date.toISOString().slice(0, 10);
    byDay.set(k, (byDay.get(k) || 0) + r.amount);
  }
  const sum = (arr) => Math.round(arr.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  return {
    count: inRange.length,
    expense: sum(expenseRecords),
    income: sum(incomeRecords),
    transfer: sum(inRange.filter((r) => r.type === '转账' || r.type === '还款')),
    byCategory: [...byCategory.entries()].sort((a, b) => b[1] - a[1]),
    byDay: [...byDay.entries()],
    records: inRange,
  };
}

export const fmtMoney = (n) => `¥${Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtMoneyShort = (n) => {
  const v = Number(n);
  if (v >= 10000) return `¥${(v / 10000).toFixed(v >= 100000 ? 0 : 1)}万`;
  return `¥${v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
};

/** 组装查询回复（一句话 + 分类 Top + 环比） */
export async function answerQuery(q) {
  const records = await getRecords();
  const { from, to, label } = rangeFor(q.period);
  const s = summarize(records, { from, to });

  // 环比：与上一个等长周期比较
  const span = to - from;
  const prev = summarize(records, { from: new Date(from.getTime() - span), to: from });
  const delta = prev.expense > 0 ? Math.round(((s.expense - prev.expense) / prev.expense) * 100) : null;

  const lines = [];
  const scope = [label, q.category, q.account].filter(Boolean).join(' · ');
  if (q.category) {
    const catSum = s.byCategory.find(([c]) => c === q.category)?.[1] || 0;
    const catCount = s.records.filter((r) => r.category === q.category && r.type === '支出').length;
    lines.push(`${scope}支出 ${fmtMoney(catSum)}（${catCount} 笔）`);
  } else {
    lines.push(`${label}支出 ${fmtMoney(s.expense)}（${s.records.filter((r) => r.type === '支出').length} 笔）`);
  }
  if (!q.category && s.byCategory.length > 0) {
    const top = s.byCategory.slice(0, 3).map(([c, v]) => `${c} ${fmtMoneyShort(v)}`).join(' · ');
    lines.push(top);
  }
  if (s.income > 0) lines.push(`收入 ${fmtMoney(s.income)}`);
  if (delta !== null && !q.category) lines.push(`较上一周期 ${delta >= 0 ? '+' : ''}${delta}%`);
  return lines.join('\n');
}
