import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cnNum, extractAmount, parseMessageRules, parseEditRules, parseQueryRules, categorize } from '../src/parser.js';

test('中文数字转换', () => {
  assert.equal(cnNum('三十五'), 35);
  assert.equal(cnNum('一百二'), 120);
  assert.equal(cnNum('两百零五'), 205);
  assert.equal(cnNum('十五'), 15);
  assert.equal(cnNum('两千'), 2000);
  assert.equal(cnNum('一万二'), 12000);
  assert.equal(cnNum('abc'), null);
});

test('金额提取', () => {
  assert.equal(extractAmount('午饭35'), 35);
  assert.equal(extractAmount('打车87.5'), 87.5);
  assert.equal(extractAmount('花了35块5'), 35.5);
  assert.equal(extractAmount('¥128'), 128);
  assert.equal(extractAmount('三十五块'), 35);
  assert.equal(extractAmount('星巴克'), null);
});

test('单笔记账解析', () => {
  const r = parseMessageRules('午饭35');
  assert.equal(r.intent, 'record');
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].amount, 35);
  assert.equal(r.records[0].category, '餐饮');
  assert.equal(r.records[0].type, '支出');
});

test('渠道与日期', () => {
  const r = parseMessageRules('昨天打车去机场87，微信付的');
  const rec = r.records[0];
  assert.equal(rec.category, '交通');
  assert.equal(rec.account, '微信');
  const y = new Date(Date.now() - 86400000);
  assert.equal(rec.date, `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`);
});

test('多笔拆分', () => {
  const r = parseMessageRules('午饭35 打车12');
  assert.equal(r.records.length, 2);
});

test('收入与转账', () => {
  assert.equal(parseMessageRules('发工资25000').records[0].type, '收入');
  assert.equal(parseMessageRules('支付宝转银行卡3000').records[0].type, '转账');
  assert.equal(parseMessageRules('还信用卡2000').records[0].type, '还款');
});

test('缺金额追问', () => {
  const r = parseMessageRules('午饭');
  assert.equal(r.intent, 'record');
  assert.equal(r.missingAmount, true);
});

test('修改指令', () => {
  assert.deepEqual(parseEditRules('改 40'), { field: 'amount', value: '40' });
  assert.deepEqual(parseEditRules('改成35.5'), { field: 'amount', value: '35.5' });
  assert.deepEqual(parseEditRules('分类 购物'), { field: 'category', value: '购物' });
  assert.equal(parseEditRules('随便说'), null);
});

test('查询指令', () => {
  assert.deepEqual(parseQueryRules('这个月花了多少'), { period: 'this_month', category: '', account: '' });
  assert.deepEqual(parseQueryRules('昨天花了多少'), { period: 'yesterday', category: '', account: '' });
  const q = parseQueryRules('上周外卖花了多少');
  assert.equal(q.period, 'last_week');
  assert.equal(q.category, '餐饮');
  assert.equal(parseQueryRules('午饭35'), null);
});

test('分类关键词', () => {
  assert.equal(categorize('买书'), '学习');
  assert.equal(categorize('猫粮'), '宠物');
  assert.equal(categorize('地铁'), '交通');
  assert.equal(categorize('房租'), '居家');
  assert.equal(categorize('红包'), '人情往来');
});
