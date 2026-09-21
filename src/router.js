import { createRecord, updateRecord, deleteRecord } from './feishu.js';
import { parseMessage as llmParse } from './llm.js';
import { parseMessageRules, parseEditRules, parseQueryRules } from './parser.js';
import { answerQuery, getRecords, invalidateRecordCache, fmtMoney } from './query.js';

/** openId → 上一条记录（用于「改/删」） */
const lastRecordByUser = new Map();
/** openId → 消息计数（前几次附带使用提示） */
const msgCountByUser = new Map();
/** (openId+text) → 时间戳，60 秒内重复消息防误触 */
const recentTexts = new Map();

function dateToFieldTs(dateStr, now = new Date()) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const isToday = now.getFullYear() === y && now.getMonth() + 1 === m && now.getDate() === d;
  const time = isToday ? now : new Date(y, m - 1, d, 12, 0, 0);
  return time.getTime();
}

const dateLabel = (dateStr, now = new Date()) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const isToday = now.getFullYear() === y && now.getMonth() + 1 === m && now.getDate() === d;
  const isYst = new Date(now.getTime() - 86400000);
  if (isToday) return '今天';
  if (isYst.getFullYear() === y && isYst.getMonth() + 1 === m && isYst.getDate() === d) return '昨天';
  return `${m}月${d}日`;
};

function buildRecordFields(r, { source, rawText }) {
  const fields = {
    '日期': dateToFieldTs(r.date),
    '类型': r.type,
    '金额': r.amount,
    '事项': r.item,
    '分类': r.category || (r.type === '支出' ? '其他' : r.type),
    '支付账户': r.account || '未指定',
    '来源平台': r.platform || '其他',
    '原始语句': rawText.slice(0, 200),
    '记录来源': source,
  };
  if (r.subCategory) fields['子分类'] = r.subCategory;
  if (r.note) fields['备注'] = r.note;
  return fields;
}

const HELP_TEXT = `我是记账助手，一句话就能记一笔：
· 记账：午饭 35 ／ 昨天打车 87 微信 ／ 京东买书 128 白条
· 多笔：午饭35 打车12（空格分隔）
· 收入：发工资 25000 ／ 转账：支付宝转银行卡 3000
· 语音：直接按住说话发语音，或用输入框的语音输入
· 查询：这个月花了多少 ／ 上周外卖花了多少
· 修改：改 40 ／ 分类 购物 ／ 用微信 ／ 删（改的是上一笔）
说明：转账和还款不计入消费；每一笔只记一次，渠道只是属性。`;

/**
 * 消息主路由。ctx = { openId, source: '机器人'|'语音' }
 * 返回回复文本（调用方负责发送），内部抛错由调用方兜底提示。
 */
export async function handleText(text, ctx) {
  const t = text.trim();
  if (!t) return '没听清，再说一次？';

  const seen = recentTexts.get(ctx.openId + '|' + t);
  if (seen && Date.now() - seen < 60000) return '这条刚刚记过了，如需再记一笔请在 1 分钟后发送，或换个说法。';
  recentTexts.set(ctx.openId + '|' + t, Date.now());
  if (recentTexts.size > 500) for (const [k, v] of recentTexts) if (Date.now() - v > 120000) recentTexts.delete(k);

  const count = (msgCountByUser.get(ctx.openId) || 0) + 1;
  msgCountByUser.set(ctx.openId, count);

  // 确定性指令优先走规则（改/删/帮助），其余交给 DeepSeek，失败回落规则
  let parsed;
  const quickEdit = parseEditRules(t);
  const quickDelete = /^(删|删除|删掉|撤销|不要了)$/.test(t);
  const quickHelp = /^(帮助|help|怎么用|\?)$/.test(t);
  const quickQuery = parseQueryRules(t);

  if (quickEdit || quickDelete || quickHelp) {
    parsed = quickHelp
      ? { intent: 'help' }
      : quickDelete
        ? { intent: 'delete' }
        : { intent: 'edit', edit: quickEdit };
  } else {
    try {
      parsed = await llmParse(t);
    } catch (e) {
      console.error('[llm] 解析失败，回落规则引擎:', e.message);
      parsed = parseMessageRules(t);
    }
    // LLM 判成 edit/query 但规则已排除时尊重 LLM；此处不再二次覆盖
  }

  switch (parsed.intent) {
    case 'help':
      return HELP_TEXT;

    case 'record': {
      if (parsed.missingAmount || !parsed.records?.length) {
        return '记多少钱？（示例：午饭 35）';
      }
      const lines = [];
      for (const r of parsed.records) {
        const record = await createRecord(buildRecordFields(r, { source: ctx.source, rawText: t }));
        lastRecordByUser.set(ctx.openId, { recordId: record.record_id, record: r });
        lines.push(`${r.type === '支出' ? `已记 · ${r.category}` : `已记 · ${r.type}`} · ${r.item}\n${fmtMoney(r.amount)} · ${dateLabel(r.date)}${r.account !== '未指定' ? ' · ' + r.account : ''}`);
      }
      invalidateRecordCache();
      if (count <= 3) lines.push('（改金额回「改 40」· 改分类「分类 购物」· 删除「删」）');
      return lines.join('\n---\n');
    }

    case 'query': {
      const q = parsed.query || quickQuery;
      if (!q) return '想查什么？示例：这个月花了多少 / 上周外卖花了多少';
      return answerQuery(q);
    }

    case 'edit': {
      const last = lastRecordByUser.get(ctx.openId);
      if (!last) return '最近没有可修改的记录，先记一笔吧。';
      const { field, value } = parsed.edit || quickEdit;
      const fieldMap = { amount: '金额', category: '分类', account: '支付账户', item: '事项', date: '日期' };
      let v = value;
      if (field === 'amount') v = Number(value);
      if (field === 'date') v = dateToFieldTs(value);
      await updateRecord(last.recordId, { [fieldMap[field]]: v });
      invalidateRecordCache();
      if (last.record) {
        if (field === 'amount') last.record.amount = v;
        if (field === 'category') last.record.category = v;
        if (field === 'account') last.record.account = v;
      }
      return `已改：${fieldMap[field]} → ${field === 'amount' ? fmtMoney(v) : v}`;
    }

    case 'delete': {
      const last = lastRecordByUser.get(ctx.openId);
      if (!last) return '最近没有可删除的记录。';
      await deleteRecord(last.recordId);
      invalidateRecordCache();
      lastRecordByUser.delete(ctx.openId);
      return `已删：${last.record?.item || '上一笔'} ${last.record ? fmtMoney(last.record.amount) : ''}`;
    }

    default:
      return '记一笔请直接说，例如「午饭 35」。查账问「这个月花了多少」。';
  }
}
