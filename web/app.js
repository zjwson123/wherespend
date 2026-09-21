/* 钱去哪了 · 前端逻辑（零依赖，直接浏览器运行） */

const $ = (s, el = document) => el.querySelector(s);
const CAT_COLORS = {
  餐饮: '#e8590c', 购物: '#1971c2', 居家: '#5f3dc4', 交通: '#0c8599', 娱乐: '#c2255c',
  医疗: '#2f9e44', 人情往来: '#f08c00', 学习: '#6741d9', 宠物: '#e64980', 其他: '#868e96',
};

const state = {
  key: '',
  records: [],
  updatedAt: 0,
  tab: 'overview',
  listFilter: { period: 'this_month', type: 'all', category: '', account: '', q: '' },
  statsPeriod: 'this_month',
};

/* ---------- 工具 ---------- */

const DAY = 86400000;
const fmt = (n, digits = 2) => Number(n).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtShort = (n) => (n >= 10000 ? `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万` : fmt(n, n % 1 ? 2 : 0));

function dayStart(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
function weekStart(ts) { const d = new Date(dayStart(ts)); return d.getTime() - ((d.getDay() + 6) % 7) * DAY; }
function monthStart(ts) { const d = new Date(ts); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); }
function yearStart(ts) { const d = new Date(monthStart(ts)); d.setMonth(0); return d.getTime(); }

function periodRange(p, now = Date.now()) {
  switch (p) {
    case 'today': return [dayStart(now), now];
    case 'yesterday': { const s = dayStart(now) - DAY; return [s, s + DAY]; }
    case 'this_week': return [weekStart(now), now];
    case 'last_week': { const s = weekStart(now) - 7 * DAY; return [s, s + 7 * DAY]; }
    case 'last_month': { const d = new Date(monthStart(now)); d.setMonth(d.getMonth() - 1); return [d.getTime(), monthStart(now)]; }
    case 'this_year': return [yearStart(now), now];
    case 'all': return [0, now];
    default: return [monthStart(now), now];
  }
}
const PERIOD_NAME = { today: '今天', yesterday: '昨天', this_week: '本周', last_week: '上周', last_month: '上月', this_month: '本月', this_year: '今年', all: '全部' };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function inRange(r, from, to) { return r.ts >= from && r.ts < to; }
const expenseOf = (rs) => rs.filter((r) => r.type === '支出');
const sumOf = (rs) => rs.reduce((s, r) => s + r.amount, 0);

function timeLabels() {
  const w = ['日', '一', '二', '三', '四', '五', '六'];
  const d = new Date();
  return { today: `${d.getMonth() + 1}月${d.getDate()}日 周${w[d.getDay()]}` };
}

/* ---------- 数据 ---------- */

async function api(path, opts = {}) {
  const url = new URL(path, location.origin);
  if (state.key) url.searchParams.set('key', state.key);
  const res = await fetch(url, opts);
  if (res.status === 401) { showKeyOverlay(); throw new Error('unauthorized'); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadRecords(force = false) {
  if (!force && state.records.length && Date.now() - state.updatedAt < 45000) return;
  const d = await api('/api/records');
  state.records = d.records;
  state.updatedAt = d.updatedAt || Date.now();
  $('#st-total').textContent = d.count;
  $('#st-sync').textContent = new Date(state.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  $('#sync-time').textContent = '· 已同步 ' + new Date(state.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

/* ---------- 渲染：概览 ---------- */

function renderOverview() {
  const now = Date.now();
  const [mf, mt] = periodRange('this_month', now);
  const [lf, lt] = periodRange('last_month', now);
  const month = state.records.filter((r) => inRange(r, mf, mt));
  const last = state.records.filter((r) => inRange(r, lf, lt));
  const mExp = sumOf(expenseOf(month));
  const lExp = sumOf(expenseOf(last));
  const mInc = sumOf(month.filter((r) => r.type === '收入'));
  const delta = lExp > 0 ? Math.round(((mExp - lExp) / lExp) * 100) : null;
  const today = state.records.filter((r) => inRange(r, dayStart(now), now));

  const byCat = new Map();
  for (const r of expenseOf(month)) byCat.set(r.category, (byCat.get(r.category) || 0) + r.amount);
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  const recent = state.records.slice(0, 8);

  return `
  <section class="hero">
    <div class="label">本月支出 · ${new Date().getMonth() + 1}月</div>
    <div class="amount"><span class="cny">¥</span>${fmt(mExp)}</div>
    <div class="hero-meta">
      <span>收入 <b class="num">¥${fmtShort(mInc)}</b></span>
      <span>今日 <b class="num">¥${fmtShort(sumOf(expenseOf(today)))}</b> · ${today.filter((r) => r.type === '支出').length} 笔</span>
      ${delta !== null ? `<span class="chip-delta ${delta <= 0 ? 'down' : ''}">较上月 ${delta >= 0 ? '+' : ''}${delta}%</span>` : ''}
    </div>
  </section>

  ${state.records.length === 0 ? emptyHtml() : `
  <div class="section-title">本月分类<span>Top ${cats.length}</span></div>
  <div class="card">${cats.map(([c, v]) => catRowHtml(c, v, mExp)).join('') || '<div class="empty">本月还没有支出</div>'}</div>

  <div class="section-title">最近记录</div>
  <div class="card">${recent.map(recRowHtml).join('')}</div>`}
  `;
}

const emptyHtml = () => `
  <div class="empty">
    <div class="big">零 壹 贰 叁</div>
    还没有账，去飞书对机器人说一句<br><br>
    <code>午饭 35</code>&nbsp;&nbsp;<code>打车 87 微信</code><br><br>
    语音消息也可以，说完就记上
  </div>`;

function catRowHtml(cat, val, total) {
  const pct = total > 0 ? Math.round((val / total) * 100) : 0;
  return `
  <div class="cat-row">
    <span class="cat-dot" style="background:${CAT_COLORS[cat] || '#868e96'}"></span>
    <div class="cat-body">
      <div class="cat-name">${esc(cat)}<span class="pct num">${pct}%</span></div>
      <div class="cat-bar"><i style="--bar-color:${CAT_COLORS[cat] || '#868e96'};width:0%" data-w="${pct}%"></i></div>
    </div>
    <div class="cat-amt">¥${fmtShort(val)}</div>
  </div>`;
}

function recRowHtml(r) {
  const amtCls = r.type === '收入' ? 'income' : (r.type === '支出' ? '' : 'transfer');
  const amt = r.type === '支出' ? `-${fmt(r.amount)}` : (r.type === '收入' ? `+${fmt(r.amount)}` : fmt(r.amount));
  const meta = [r.category, r.account !== '未指定' ? r.account : '', r.source === '语音' ? '语音' : ''].filter(Boolean).join(' · ');
  return `
  <div class="rec-row">
    <span class="cat-dot" style="background:${CAT_COLORS[r.category] || '#868e96'}"></span>
    <div class="rec-main">
      <div class="rec-item">${esc(r.item)}</div>
      <div class="rec-meta">${esc(meta)}</div>
    </div>
    <div class="rec-amt num ${amtCls}">${amt}</div>
  </div>`;
}

/* ---------- 渲染：明细 ---------- */

function filteredRecords() {
  const f = state.listFilter;
  const [from, to] = periodRange(f.period);
  const q = f.q.trim().toLowerCase();
  return state.records.filter((r) => {
    if (!inRange(r, from, to)) return false;
    if (f.type !== 'all' && r.type !== f.type) return false;
    if (f.category && r.category !== f.category) return false;
    if (f.account && r.account !== f.account) return false;
    if (q && !(`${r.item} ${r.note} ${r.category} ${r.account}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

function renderList() {
  const f = state.listFilter;
  const cats = [...new Set(state.records.map((r) => r.category))];
  const accs = [...new Set(state.records.map((r) => r.account))];
  const rows = filteredRecords();
  const exp = sumOf(expenseOf(rows));

  const periodChips = ['this_month', 'last_month', 'this_week', 'today', 'all'].map((p) =>
    `<button class="chip ${f.period === p ? 'on' : ''}" data-p="${p}">${PERIOD_NAME[p]}</button>`).join('');
  const typeChips = [['all', '全部'], ['支出', '支出'], ['收入', '收入'], ['转账', '转账']]
    .map(([v, n]) => `<button class="chip ${f.type === v ? 'on' : ''}" data-t="${v}">${n}</button>`).join('');

  const groups = new Map();
  for (const r of rows) {
    const k = dayStart(r.ts);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const dayBlocks = [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([ts, list]) => {
    const d = new Date(ts);
    const w = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    const dayExp = sumOf(expenseOf(list));
    return `<div class="day-head"><span>${d.getMonth() + 1}月${d.getDate()}日 周${w}</span><span class="num">支出 ¥${fmtShort(dayExp)}</span></div>
    <div class="card">${list.map(recRowHtml).join('')}</div>`;
  }).join('');

  return `
  <div class="filter-bar">
    <div class="chips">${periodChips}</div>
    <div class="chips">${typeChips}</div>
    <div class="filter-grid">
      <div class="sel-wrap"><select id="f-cat">
        <option value="">全部分类</option>
        ${cats.map((c) => `<option ${f.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
      </select></div>
      <div class="sel-wrap"><select id="f-acc">
        <option value="">全部账户</option>
        ${accs.filter((a) => a !== '未指定').map((a) => `<option ${f.account === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}
      </select></div>
      <input class="search" id="f-q" placeholder="搜索事项 / 备注" value="${esc(f.q)}">
    </div>
  </div>
  <div class="summary-line"><span>${rows.length} 笔</span><span>支出 <b>¥${fmt(exp)}</b></span></div>
  ${rows.length ? dayBlocks : `<div class="empty">这个条件下没有账<br><br>换个时间段，或去飞书记一笔</div>`}
  `;
}

/* ---------- 渲染：统计 ---------- */

function renderStats() {
  const [from, to] = periodRange(state.statsPeriod);
  const rows = state.records.filter((r) => inRange(r, from, to));
  const exp = expenseOf(rows);
  const total = sumOf(exp);

  const byCat = new Map();
  for (const r of exp) byCat.set(r.category, (byCat.get(r.category) || 0) + r.amount);
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);

  // 近 12 个月支出
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const [f, t] = [d.getTime(), new Date(now.getFullYear(), now.getMonth() - i + 1, 1).getTime()];
    months.push({ label: `${d.getMonth() + 1}`, v: sumOf(expenseOf(state.records.filter((r) => inRange(r, f, t)))), cur: i === 0 });
  }
  const mMax = Math.max(...months.map((m) => m.v), 1);

  const chips = ['this_month', 'last_month', 'this_year', 'all'].map((p) =>
    `<button class="chip ${state.statsPeriod === p ? 'on' : ''}" data-sp="${p}">${PERIOD_NAME[p]}</button>`).join('');

  return `
  <div class="filter-bar"><div class="chips">${chips}</div></div>
  ${state.records.length === 0 ? emptyHtml() : `
  <div class="card">
    <div class="chart-block">
      <div class="section-title" style="margin:0 0 12px">${PERIOD_NAME[state.statsPeriod]}分类占比<span>支出 ¥${fmtShort(total)}</span></div>
      <div class="donut-wrap">
        ${donutSvg(cats, total)}
        <div class="donut-legend">
          ${cats.slice(0, 6).map(([c, v]) => legendRow(c, v, total)).join('') || '<div class="empty" style="padding:12px">无支出</div>'}
        </div>
      </div>
    </div>
    <div class="chart-block">
      <div class="section-title" style="margin:0 0 4px">近 12 个月支出</div>
      <div class="month-bars">
        ${months.map((m) => `
        <div class="month-bar ${m.cur ? 'cur' : ''}">
          <b>${m.v > 0 ? fmtShort(m.v).replace('¥', '') : ''}</b>
          <i style="height:0%" data-h="${Math.max(4, Math.round((m.v / mMax) * 88))}"></i>
          <em>${m.label}</em>
        </div>`).join('')}
      </div>
    </div>
  </div>`}
  `;
}

function legendRow(cat, v, total) {
  const pct = total > 0 ? Math.round((v / total) * 100) : 0;
  return `<div class="legend-row">
    <span class="cat-dot" style="background:${CAT_COLORS[cat] || '#868e96'}"></span>
    <span class="nm">${esc(cat)}</span>
    <span class="val">¥${fmtShort(v)}</span>
    <span class="pct num">${pct}%</span>
  </div>`;
}

function donutSvg(cats, total) {
  const R = 54, C = 2 * Math.PI * R;
  let acc = 0;
  const segs = cats.map(([c, v]) => {
    const frac = total > 0 ? v / total : 0;
    const seg = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${CAT_COLORS[c] || '#868e96'}"
      stroke-width="18" stroke-dasharray="0 ${C}" data-da="${(frac * C).toFixed(1)} ${C.toFixed(1)}"
      stroke-dashoffset="${(-acc * C).toFixed(1)}" transform="rotate(-90 70 70)" stroke-linecap="butt"/>`;
    acc += frac;
    return seg;
  }).join('');
  return `<svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="分类占比">
    <circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--gray-tag)" stroke-width="18"/>
    ${segs}
    <text x="70" y="66" text-anchor="middle" font-size="11" fill="var(--muted)">支出</text>
    <text x="70" y="84" text-anchor="middle" font-size="15" font-weight="700" fill="var(--ink)">${total >= 10000 ? (total / 10000).toFixed(1) + '万' : fmtShort(total)}</text>
  </svg>`;
}

/* ---------- 渲染骨架 & 动画 ---------- */

function render() {
  const main = $('#main');
  main.innerHTML = state.tab === 'overview' ? renderOverview()
    : state.tab === 'list' ? renderList()
    : renderStats();
  // 入场后触发条形/环形动画
  requestAnimationFrame(() => requestAnimationFrame(() => {
    main.querySelectorAll('.cat-bar i[data-w]').forEach((el) => (el.style.width = el.dataset.w));
    main.querySelectorAll('.month-bar i[data-h]').forEach((el) => (el.style.height = el.dataset.h + '%'));
    main.querySelectorAll(`circle[data-da]`).forEach((el) => (el.setAttribute('stroke-dasharray', el.dataset.da)));
  }));
  bindTabEvents();
}

function bindTabEvents() {
  const main = $('#main');
  main.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { state.listFilter.period = b.dataset.p; render(); });
  main.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { state.listFilter.type = b.dataset.t; render(); });
  main.querySelectorAll('[data-sp]').forEach((b) => b.onclick = () => { state.statsPeriod = b.dataset.sp; render(); });
  const cat = $('#f-cat'); if (cat) cat.onchange = () => { state.listFilter.category = cat.value; render(); };
  const acc = $('#f-acc'); if (acc) acc.onchange = () => { state.listFilter.account = acc.value; render(); };
  const q = $('#f-q'); if (q) q.onchange = () => { state.listFilter.q = q.value; render(); };
}

/* ---------- 密钥 / 设置 ---------- */

function showKeyOverlay() { $('#key-overlay').hidden = false; $('#key-input').focus(); }

async function tryKey(key) {
  state.key = key;
  try {
    await api('/api/records');
    localStorage.setItem('ws_key', key);
    history.replaceState(null, '', location.pathname);
    $('#key-overlay').hidden = true;
    await loadRecords(true);
    render();
  } catch (e) {
    if (e.message !== 'unauthorized') {
      $('#key-err').textContent = '连不上服务：' + e.message;
    } else {
      $('#key-err').textContent = '密钥不对，再检查一下';
    }
  }
}

/* ---------- 启动 ---------- */

document.querySelectorAll('.tab').forEach((b) => {
  b.onclick = () => {
    state.tab = b.dataset.tab;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === b));
    loadRecords().then(render).catch(() => {});
  };
});

$('#btn-key').onclick = () => tryKey($('#key-input').value.trim());
$('#key-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryKey(e.target.value.trim()); });

$('#btn-settings').onclick = () => { $('#sheet').classList.add('open'); $('#sheet').setAttribute('aria-hidden', 'false'); };
$('#sheet').addEventListener('click', (e) => {
  if (e.target.id === 'btn-refresh' || e.target.closest('#btn-refresh')) {
    loadRecords(true).then(render).catch(() => {});
  }
});
document.addEventListener('click', (e) => {
  const s = $('#sheet');
  if (s.classList.contains('open') && !e.target.closest('#sheet') && !e.target.closest('#btn-settings')) {
    s.classList.remove('open');
    s.setAttribute('aria-hidden', 'true');
  }
});

// 服务地址写入设置面板
api('/api/health').then((h) => {
  if (h.bitable) $('#link-bitable').href = h.bitable;
}).catch(() => {});

const urlKey = new URLSearchParams(location.search).get('key');
if (urlKey) tryKey(urlKey);
else if (localStorage.getItem('ws_key')) tryKey(localStorage.getItem('ws_key'));
else showKeyOverlay();

render(); // 先渲染骨架（空态）
loadRecords().then(render).catch(() => {});
setInterval(() => { loadRecords().then(() => { if (!document.hidden) render(); }).catch(() => {}); }, 60000);
