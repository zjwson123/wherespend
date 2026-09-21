import { CATEGORY_KEYWORDS, ACCOUNT_KEYWORDS, CATEGORIES, ACCOUNTS, TYPES, PLATFORMS } from './config.js';

/**
 * 规则解析器：DeepSeek 不可用时的兜底，也是部分指令（改/删）的主路径。
 * 覆盖常见口语：金额（阿拉伯/中文数字）、今天昨天、简单分类关键词、多笔拆分。
 */

const CN_DIGIT = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNIT = { 十: 10, 百: 100, 千: 1000, 万: 10000 };

/** 中文数字 → 数值。支持口语：三十五 / 一百二(=120) / 两百零五 / 一万二(=12000)。失败返回 null */
export function cnNum(s) {
  if (!s || !/[零一二两三四五六七八九十百千万]/.test(s)) return null;
  let total = 0, section = 0, digit = 0, metDigit = false, lastUnit = 0, sawZero = false;
  for (const ch of s) {
    if (ch in CN_DIGIT) {
      digit = CN_DIGIT[ch];
      metDigit = true;
      if (digit === 0) sawZero = true;
    } else if (ch in CN_UNIT) {
      const unit = CN_UNIT[ch];
      if (unit === 10000) { total = (total + section + digit) * 10000; section = 0; digit = 0; }
      else { section += (metDigit ? digit : 1) * unit; digit = 0; metDigit = false; }
      lastUnit = unit;
      sawZero = false;
    } else return null;
  }
  // 口语尾数：一百二=120、一千五=1500、一万二=12000（零后尾数是个位：两百零五=205）
  if (digit > 0 && lastUnit >= 10 && !sawZero && (section > 0 || lastUnit === 10000)) {
    digit = digit * (lastUnit / 10);
  }
  const v = total + section + digit;
  return v > 0 ? v : null;
}

/** 从一段文本中提取第一个金额（元）。支持 35 / 35.5 / ¥35 / 35元 / 35块 / 35块5 / 三十五块 */
export function extractAmount(text) {
  // 35块5 / 3块5 → 35.5
  let m = text.match(/(\d+)(?:块|元)(\d)(?!\d)/);
  if (m) return Number(`${m[1]}.${m[2]}`);
  m = text.match(/(?:¥|￥|价格)?(\d+(?:\.\d{1,2})?)(?:块|元|大洋|毛?)?/);
  if (m && m[1]) {
    const v = Number(m[1]);
    if (isFinite(v) && v > 0) return v;
  }
  // 中文数字金额
  m = text.match(/([零一二两三四五六七八九十百千万]+)(?:块|元)(\d)?/);
  if (m) {
    const base = cnNum(m[1]);
    if (base) return Number(`${base}.${m[2] || 0}`);
  }
  m = text.match(/([零一二两三四五六七八九十百千万]+)(?![\d块元])/);
  if (m) {
    const v = cnNum(m[1]);
    if (v && v > 0 && /块|元|花|付|消费/.test(text)) return v;
  }
  return null;
}

function stripAmount(text) {
  return text
    .replace(/(?:¥|￥)\s*\d+(?:\.\d{1,2})?/g, ' ')
    .replace(/\d+(?:\.\d{1,2})?\s*(?:块|元)/g, ' ')
    .replace(/(\d+)(?:块|元)(\d)(?!\d)/g, ' ')
    .replace(/\b\d+(?:\.\d{1,2})?\b/g, ' ')
    .replace(/[零一二两三四五六七八九十百千万]+块/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectType(text) {
  if (/还(信用卡|白条|花呗|贷款)|还款/.test(text)) return '还款';
  if (/转(账|给|到|入|出|进)|转.{0,6}(支付宝|微信|银行卡|卡|余额宝|账户)|提现|划转/.test(text)) return '转账';
  if (/工资|收入|收到|进账|回款|退款|报销|分红|利息|奖金|稿费|红包收/.test(text)) return '收入';
  return '支出';
}

export function categorize(itemText) {
  const s = itemText.toLowerCase();
  // 取「命中关键词最长」的分类，避免 买(购物) 抢过 买书(学习) 这类误判
  let best = null, bestLen = 0;
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const w of words) {
      if (s.includes(w.toLowerCase()) && w.length > bestLen) {
        best = cat;
        bestLen = w.length;
      }
    }
  }
  return best || '其他';
}

export function detectAccount(text) {
  for (const [re, acc] of ACCOUNT_KEYWORDS) if (re.test(text)) return acc;
  return '未指定';
}

function detectPlatform(text) {
  const s = text.toLowerCase();
  const map = { 京东: '京东', 美团: '美团', 淘宝: '淘宝', 天猫: '淘宝', 拼多多: '拼多多', 抖音: '抖音', 饿了么: '饿了么', 盒马: '线下', 山姆: '线下', 超市: '线下' };
  for (const [k, p] of Object.entries(map)) if (s.includes(k)) return p;
  return '其他';
}

function detectDate(text, now = new Date()) {
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (/前天/.test(text)) return fmt(new Date(now.getTime() - 2 * 86400000));
  if (/昨天|昨晚/.test(text)) return fmt(new Date(now.getTime() - 86400000));
  if (/大前天/.test(text)) return fmt(new Date(now.getTime() - 3 * 86400000));
  const md = text.match(/(\d{1,2})月(\d{1,2})[号日]/);
  if (md) return `${now.getFullYear()}-${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}`;
  return fmt(now);
}

/** 把一句话按 分号/逗号/顿号/空格 拆成可能的多笔 */
function splitSegments(text) {
  return text
    .replace(/，|,|、|；|;/g, ' ')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s && !/^(和|跟|然后|还有|再)$/.test(s));
}

/** 规则解析主入口。返回与 llm.parseMessage 相同结构（尽力而为） */
export function parseMessageRules(text, now = new Date()) {
  const t = text.trim();

  // 修改/删除指令（确定性最高，先判）
  const edit = parseEditRules(t);
  if (edit) return { intent: 'edit', edit, records: [], query: null, missingAmount: false, raw: text, byRules: true };
  if (/^(删|删除|删掉|撤销|不要了)$/.test(t)) return { intent: 'delete', edit: null, records: [], query: null, missingAmount: false, raw: text, byRules: true };

  // 查询
  const q = parseQueryRules(t);
  if (q) return { intent: 'query', edit: null, records: [], query: q, missingAmount: false, raw: text, byRules: true };

  if (/^(帮助|help|怎么用|\?)$/.test(t)) return { intent: 'help', edit: null, records: [], query: null, missingAmount: false, raw: text, byRules: true };

  // 记账：多笔拆分
  const segs = splitSegments(t);
  const records = [];
  for (const seg of segs) {
    const amount = extractAmount(seg);
    if (amount == null) continue;
    const itemRaw = stripAmount(seg) || seg;
    const type = detectType(seg);
    const item = itemRaw.replace(/(微信|支付宝|白条|花呗|信用卡|银行卡|现金|招行|工行|建行|中行)/g, '').replace(/(付的|支付|花的|花了|买|用)/g, (m) => (m === '买' ? '买' : '')).slice(0, 30) || '消费';
    records.push({
      amount: Math.round(amount * 100) / 100,
      item: item || '消费',
      type,
      category: type === '支出' ? categorize(seg) : '',
      subCategory: '',
      // 账户/平台：分句里没提就从整句找（「…87，微信付的」这类后置说明）
      account: detectAccount(seg) !== '未指定' ? detectAccount(seg) : detectAccount(t),
      platform: detectPlatform(seg) !== '其他' ? detectPlatform(seg) : detectPlatform(t),
      date: detectDate(t, now),
      note: '',
    });
  }
  if (records.length === 0) {
    const hasItemNoun = /[\u4e00-\u9fa5]{1,}/.test(stripAmount(t));
    return { intent: 'record', edit: null, records: [], query: null, missingAmount: hasItemNoun, raw: text, byRules: true };
  }
  return { intent: 'record', edit: null, records, query: null, missingAmount: false, raw: text, byRules: true };
}

/** 「改 40」「改成35.5」「分类 购物」「用微信付的」 */
export function parseEditRules(t) {
  let m = t.match(/^(?:改|改成|修改|改为)\s*(?:金额\s*)?(\d+(?:\.\d{1,2})?)\s*(?:块|元)?$/);
  if (m) return { field: 'amount', value: String(Number(m[1])) };
  m = t.match(/^(?:改|改成|修改)\s*分类\s*(.+)$/) || t.match(/^(?:分类|类别)\s*(?:改成?\s*)?(.+)$/);
  if (m && CATEGORIES.includes(m[1].trim())) return { field: 'category', value: m[1].trim() };
  m = t.match(/^(?:改|用|换成)\s*(支付宝|微信|现金|白条|信用卡|银行卡)$/) || t.match(/^(?:账户|支付方式)\s*(?:改成?\s*)?(支付宝|微信|现金|白条|信用卡|银行卡)$/);
  if (m) return { field: 'account', value: m[1] === '白条' ? '京东白条' : m[1] };
  return null;
}

const PERIODS = [
  [/今天|今日/, 'today'],
  [/昨天|昨日/, 'yesterday'],
  [/本周|这周|这星期|这礼拜/, 'this_week'],
  [/上周|上星期|上礼拜/, 'last_week'],
  [/上月|上个月|上个月/, 'last_month'],
  [/本月|这个月|这月|月度/, 'this_month'],
  [/今年|本年|年度/, 'this_year'],
  [/去年/, 'all'],
];

/** 「这个月花了多少」「上周外卖花了多少」 */
export function parseQueryRules(t) {
  if (!/(花了?多少|多少钱|多少|统计|汇总|总支出|总共|一共花了|账单|报表)/.test(t)) return null;
  if (/改|删/.test(t.slice(0, 2))) return null;
  let period = 'this_month';
  for (const [re, p] of PERIODS) if (re.test(t)) { period = p; break; }
  let category = '';
  for (const c of CATEGORIES) if (t.includes(c)) { category = c; break; }
  // 「外卖/吃饭」→ 餐饮 这类常见口语映射
  if (!category) {
    if (/外卖|吃饭|吃|饭|奶茶|咖啡/.test(t)) category = '餐饮';
    else if (/打车|交通|出行/.test(t)) category = '交通';
    else if (/购物|淘宝|京东/.test(t)) category = '购物';
  }
  return { period, category, account: '' };
}

export { CATEGORIES, ACCOUNTS, TYPES, PLATFORMS };
