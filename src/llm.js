import { config, CATEGORIES, ACCOUNTS, TYPES, PLATFORMS } from './config.js';

/**
 * DeepSeek 客户端（OpenAI 兼容协议）。
 * 只把单句记账语句发给模型，不发送任何账户身份信息。
 */
export async function chat(messages, { json = false, timeoutMs = 25000 } = {}) {
  if (!config.deepseekApiKey) throw new Error('未配置 DEEPSEEK_API_KEY');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.deepseekBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.deepseekApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.deepseekModel,
        messages,
        temperature: 0,
        max_tokens: 800,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(`DeepSeek 错误: ${data.error.message || JSON.stringify(data.error)}`);
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('DeepSeek 返回为空');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function weekdayCN(d) {
  return ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
}

const SYSTEM_PROMPT = `你是个人记账助手 WhereSpend 的解析引擎。把用户发来的自然语言解析为结构化 JSON。

今天是 {{TODAY}}（星期{{WEEKDAY}}），当前时间 {{NOW}}。

可选值约束：
- 分类 category，只能取：{{CATEGORIES}}
- 支付账户 account，只能取：{{ACCOUNTS}}。用户未提及用哪个账户时填「未指定」
- 类型 type，只能取：{{TYPES}}。转账（如支付宝转银行卡、余额宝提现）和还款（如还信用卡、还白条）不算消费，分别填「转账」「还款」
- 来源平台 platform，只能取：{{PLATFORMS}}，判断不了填「其他」

输出 JSON 结构：
{"intent":"record|query|edit|delete|help|chat",
 "missing_amount":false,
 "records":[{"amount":35.0,"item":"午饭","type":"支出","category":"餐饮","sub_category":"","account":"未指定","platform":"其他","date":"YYYY-MM-DD","note":""}],
 "edit":{"field":"amount|category|account|item|date","value":"..."},
 "query":{"period":"today|yesterday|this_week|last_week|this_month|last_month|this_year|all","category":"","account":""}}

判定规则：
1. intent=record：用户在陈述一笔或多笔消费/收入/转账。一句话里有多笔就拆成多条 records。amount 是数字（单位元）。
2. 用户说了事项但完全没提金额时：intent=record、missing_amount=true、records=[]。
3. intent=query：用户在询问花了多少/统计/汇总/某类支出（如「这个月吃饭花了多少」「上月总支出」）。category 填用户问的分类（取值同上，没提就留空），account 同理。
4. intent=edit：修改上一笔记录（如「改40」「改成35.5」「分类改购物」「用微信付的」→ account）。edit.field 只能是 amount|category|account|item|date 之一，value 是新值（分类/账户必须取上面约束的值）。
5. intent=delete：删除上一笔（如「删」「删掉」「撤销」）。
6. intent=help：问怎么用。intent=chat：打招呼或与记账无关。
7. date：用户提到「昨天/前天/上周五/X号」等就换算成具体 YYYY-MM-DD，没提就用今天。item 保留用户原意但精炼成短语（≤12字）。note 放用户补充说明。

只输出 JSON，不要任何解释。`;

const EXAMPLES = [
  { role: 'user', content: '午饭 35' },
  { role: 'assistant', content: '{"intent":"record","missing_amount":false,"records":[{"amount":35,"item":"午饭","type":"支出","category":"餐饮","sub_category":"","account":"未指定","platform":"其他","date":"{{TODAY}}","note":""}],"edit":null,"query":null}' },
  { role: 'user', content: '昨天打车去机场87，微信付的' },
  { role: 'assistant', content: '{"intent":"record","missing_amount":false,"records":[{"amount":87,"item":"打车去机场","type":"支出","category":"交通","sub_category":"","account":"微信","platform":"其他","date":"{{YESTERDAY}}","note":""}],"edit":null,"query":null}' },
  { role: 'user', content: '这个月外卖花了多少' },
  { role: 'assistant', content: '{"intent":"query","missing_amount":false,"records":[],"edit":null,"query":{"period":"this_month","category":"餐饮","account":""}}' },
];

export async function parseMessage(text) {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fill = (s) => s
    .replaceAll('{{TODAY}}', fmt(now))
    .replaceAll('{{YESTERDAY}}', fmt(yesterday))
    .replaceAll('{{WEEKDAY}}', weekdayCN(now))
    .replaceAll('{{NOW}}', now.toTimeString().slice(0, 5))
    .replaceAll('{{CATEGORIES}}', CATEGORIES.join('/'))
    .replaceAll('{{ACCOUNTS}}', ACCOUNTS.join('/'))
    .replaceAll('{{TYPES}}', TYPES.join('/'))
    .replaceAll('{{PLATFORMS}}', PLATFORMS.join('/'));

  const system = fill(SYSTEM_PROMPT);
  const messages = [
    { role: 'system', content: system },
    ...EXAMPLES.map((m) => ({ role: m.role, content: fill(m.content) })),
    { role: 'user', content: text.slice(0, 500) },
  ];

  let raw;
  try {
    raw = await chat(messages, { json: true });
  } catch (e) {
    throw e;
  }
  // 容错：模型偶尔会包 ```json ``` 或多余文本
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('DeepSeek 未返回 JSON');
  const parsed = JSON.parse(m[0]);

  // 归一化与约束校验
  const result = {
    intent: ['record', 'query', 'edit', 'delete', 'help', 'chat'].includes(parsed.intent) ? parsed.intent : 'chat',
    missingAmount: !!parsed.missing_amount,
    records: [],
    edit: null,
    query: null,
    raw: text,
  };
  if (Array.isArray(parsed.records)) {
    for (const r of parsed.records) {
      const amount = Number(r.amount);
      if (!isFinite(amount) || amount <= 0) continue;
      result.records.push({
        amount: Math.round(amount * 100) / 100,
        item: String(r.item || '消费').slice(0, 30),
        type: TYPES.includes(r.type) ? r.type : '支出',
        category: CATEGORIES.includes(r.category) ? r.category : '其他',
        subCategory: String(r.sub_category || '').slice(0, 20),
        account: ACCOUNTS.includes(r.account) ? r.account : '未指定',
        platform: PLATFORMS.includes(r.platform) ? r.platform : '其他',
        date: /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : fmt(now),
        note: String(r.note || '').slice(0, 100),
      });
    }
  }
  if (parsed.intent === 'edit' && parsed.edit?.field) {
    result.edit = {
      field: ['amount', 'category', 'account', 'item', 'date'].includes(parsed.edit.field) ? parsed.edit.field : null,
      value: String(parsed.edit.value ?? ''),
    };
    if (!result.edit.field) result.edit = null;
  }
  if (parsed.intent === 'query' && parsed.query) {
    result.query = {
      period: ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_year', 'all'].includes(parsed.query.period) ? parsed.query.period : 'this_month',
      category: CATEGORIES.includes(parsed.query.category) ? parsed.query.category : '',
      account: ACCOUNTS.includes(parsed.query.account) ? parsed.query.account : '',
    };
  }
  return result;
}
