import * as lark from '@larksuiteoapi/node-sdk';
import { config } from './config.js';
import { sendText, downloadMessageResource, opusToPcm, asr } from './feishu.js';
import { handleText } from './router.js';
import { startHttpServer } from './webserver.js';

const status = { wsConnected: false, info: {} };

function fail(msg) {
  console.error('\n[x] ' + msg);
  process.exit(1);
}

if (!config.feishuAppId || !config.feishuAppSecret) fail('缺少飞书应用配置，请检查 .env 的 FEISHU_APP_ID / FEISHU_APP_SECRET');
if (!config.bitableAppToken || !config.bitableTableId) fail('还没有初始化多维表格，请先运行: npm run bootstrap');
status.info = {
  bitable: `https://feishu.cn/base/${config.bitableAppToken}`,
  llm: config.deepseekApiKey ? `${config.deepseekModel} @ deepseek` : '未配置（将使用规则解析）',
};

console.log(`[wherespend] 钱去哪了 · 启动中
  - 飞书应用: ${config.feishuAppId}
  - 多维表格: ${status.info.bitable}
  - 解析引擎: ${status.info.llm}`);

/* ================= 飞书机器人（长连接，无需公网 IP） ================= */

const seenMessages = new Set();

async function onMessage(ev) {
  const msg = ev?.event?.message;
  if (!msg || msg.chat_type !== 'p2p') return;
  const openId = ev.event.sender?.sender_id?.open_id;
  if (!openId || seenMessages.has(msg.message_id)) return;
  seenMessages.add(msg.message_id);
  if (seenMessages.size > 1000) seenMessages.clear();

  try {
    let text = '';
    let source = '机器人';

    if (msg.message_type === 'text') {
      text = (JSON.parse(msg.content || '{}').text || '').replace(/@_user_\d+\s*/g, '').trim();
    } else if (msg.message_type === 'audio') {
      source = '语音';
      const fileKey = JSON.parse(msg.content || '{}').file_key;
      if (!fileKey) throw new Error('语音文件缺失');
      const opus = await downloadMessageResource(msg.message_id, fileKey);
      const pcm = await opusToPcm(opus);
      text = (await asr(pcm)).trim();
      console.log(`[voice] 识别: ${text}`);
      if (!text) return await sendText(openId, '没听清，再试一次？或直接用输入框的语音输入。');
    } else {
      return await sendText(openId, '目前支持文字和语音，一句话告诉我花了什么就行，例如「午饭 35」。');
    }

    if (!text) return;
    console.log(`[msg] ${text}`);
    const reply = await handleText(text, { openId, source });
    await sendText(openId, reply);
    console.log(`[reply] ${reply.split('\n')[0]}`);
  } catch (e) {
    console.error('[handler]', e.message);
    try {
      await sendText(openId, `出错了：${e.message.slice(0, 120)}\n稍后再试，或直接在多维表格里手动补一笔。`);
    } catch { /* 发送失败则忽略 */ }
  }
}

const dispatcher = new lark.EventDispatcher({}).register({
  'im.message.receive_v1': onMessage,
});

const wsClient = new lark.WSClient({
  appId: config.feishuAppId,
  appSecret: config.feishuAppSecret,
  loggerLevel: 'warn',
});

wsClient
  .start({ eventDispatcher: dispatcher })
  .then(() => {
    status.wsConnected = true;
    console.log('[bot] 长连接已建立，机器人在线。在飞书里给机器人发消息试试：「午饭 35」');
  })
  .catch((e) => {
    status.wsConnected = false;
    console.error(`[bot] 长连接失败: ${e.message}
    请在飞书开放平台（https://open.feishu.cn → 你的应用）确认：
    1. 应用能力 → 已添加「机器人」
    2. 事件订阅 → 已切换为「使用长连接接收事件」→ 已订阅事件 im.message.receive_v1
    3. 已创建版本并发布（可用范围包含你自己）
    详见 docs/04-飞书配置指南.md`);
  });

/* ================= Web 账本 ================= */

startHttpServer(() => status);

process.on('SIGINT', () => {
  console.log('\n[wherespend] 再见');
  process.exit(0);
});
