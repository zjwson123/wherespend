/**
 * 一键初始化多维表格账本：
 *   npm run bootstrap
 * 幂等：.env 已配置且表格可访问时直接跳过；--force 重建。
 */
import fs from 'node:fs';
import {
  config, CATEGORIES, ACCOUNTS, TYPES, PLATFORMS, SOURCES,
} from '../src/config.js';
import {
  getToken, createBitableApp, deleteBitableApp, createTable, listTables,
  listFields, createField, deleteField, listRecords, createRecord, deleteRecord,
} from '../src/feishu.js';

const APP_NAME = 'WhereSpend 钱去哪了';
const force = process.argv.includes('--force');

async function tableReady() {
  if (!config.bitableAppToken || !config.bitableTableId) return false;
  try {
    const tables = await listTables(config.bitableAppToken);
    return tables.some((t) => t.table_id === config.bitableTableId);
  } catch { return false; }
}

function saveEnv(updates) {
  let text = fs.readFileSync(config.envFile, 'utf8');
  for (const [k, v] of Object.entries(updates)) {
    const re = new RegExp(`^${k}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, `${k}=${v}`) : `${text}\n${k}=${v}\n`;
  }
  fs.writeFileSync(config.envFile, text);
}

async function buildSchema(appToken, tableId) {
  const single = (name, options) => ({
    field_name: name, type: 3, property: { options: options.map((o) => ({ name: o })) },
  });
  const fields = [
    { field_name: '日期', type: 5, property: { date_formatter: 'yyyy/MM/dd HH:mm', auto_fill: false } },
    single('类型', TYPES),
    { field_name: '金额', type: 2, property: { formatter: '¥' } },
    { field_name: '事项', type: 1 },
    single('分类', CATEGORIES),
    { field_name: '子分类', type: 1 },
    single('支付账户', ACCOUNTS),
    single('来源平台', PLATFORMS),
    { field_name: '备注', type: 1 },
    { field_name: '原始语句', type: 1 },
    single('记录来源', SOURCES),
  ];
  for (const f of fields) {
    try {
      await createField(appToken, tableId, f);
    } catch (e) {
      // 货币格式在部分租户不生效，退回两位小数
      if (f.field_name === '金额') {
        await createField(appToken, tableId, { field_name: '金额', type: 2, property: { formatter: '0.00' } });
      } else throw e;
    }
  }
}

async function cleanDefaultFields(appToken, tableId) {
  const fields = await listFields(appToken, tableId);
  const keep = new Set(['日期', '类型', '金额', '事项', '分类', '子分类', '支付账户', '来源平台', '备注', '原始语句', '记录来源']);
  for (const f of fields) {
    if (!keep.has(f.field_name)) await deleteField(appToken, tableId, f.field_id).catch(() => {});
  }
}

async function cleanPlaceholderRows(appToken, tableId) {
  const { items, pageToken } = await listRecords(appToken, tableId);
  let all = [...items];
  while (pageToken) {
    const next = await listRecords(appToken, tableId, { pageToken });
    all = all.concat(next.items);
    if (!next.pageToken) break;
  }
  for (const item of all) {
    await deleteRecord(item.record_id).catch(() => {});
  }
  return all.length;
}

async function main() {
  await getToken();
  console.log('[1/5] 凭证有效');

  // 清理早前验证时的测试账本（按名字精确匹配，只删自己创建的）
  try {
    await deleteBitableApp('SDfbbdSOhavpArsIiX0ctnVWnhe');
    console.log('    已清理验证用的测试账本');
  } catch { /* 不存在则忽略 */ }

  if (!force && (await tableReady())) {
    console.log('[2/5] 多维表格已存在，跳过创建（--force 可重建）');
  } else {
    const app = await createBitableApp(APP_NAME);
    console.log(`[2/5] 已创建多维表格「${APP_NAME}」`);

    // 删除建表时自带的默认表，新建符合账本结构的表
    const tables = await listTables(app.app_token);
    const tableId = await createTable(app.app_token, '账本');
    for (const t of tables) {
      if (t.table_id !== tableId && t.name !== '账本') {
        await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${app.app_token}/tables/${t.table_id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${await getToken()}` },
        }).catch(() => {});
      }
    }
    console.log('[3/5] 已创建「账本」数据表');
    await buildSchema(app.app_token, tableId);
    await cleanDefaultFields(app.app_token, tableId);
    const removed = await cleanPlaceholderRows(app.app_token, tableId);
    console.log(`    字段与选项就绪（清理了 ${removed} 行占位数据）`);

    saveEnv({ BITABLE_APP_TOKEN: app.app_token, BITABLE_TABLE_ID: tableId });
    // 同步内存配置，供下方写读删验证使用
    config.bitableAppToken = app.app_token;
    config.bitableTableId = tableId;
    console.log('[4/5] 已写入 .env（BITABLE_APP_TOKEN / BITABLE_TABLE_ID）');

    // 写读删验证
    const rec = await createRecord({
      '日期': Date.now(), '类型': '支出', '金额': 0.01,
      '事项': '自检', '分类': '其他', '支付账户': '未指定',
      '来源平台': '其他', '原始语句': 'bootstrap 自检', '记录来源': '机器人',
    });
    await deleteRecord(rec.record_id);
    console.log('[5/5] 写入/读取/删除验证通过');
    console.log(`\n账本地址: ${app.url}\n接下来: npm start 启动机器人与 Web 账本`);
  }
}

main().catch((e) => {
  console.error('[x] 初始化失败:', e.message);
  process.exit(1);
});
