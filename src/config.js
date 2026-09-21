import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv(file = path.join(root, '.env')) {
  const env = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith('#')) env[m[1]] = m[2];
    }
  }
  return env;
}

const env = loadEnv();

export const config = {
  feishuAppId: env.FEISHU_APP_ID || '',
  feishuAppSecret: env.FEISHU_APP_SECRET || '',
  deepseekApiKey: env.DEEPSEEK_API_KEY || '',
  deepseekBaseUrl: (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
  deepseekModel: env.DEEPSEEK_MODEL || 'deepseek-chat',
  bitableAppToken: env.BITABLE_APP_TOKEN || '',
  bitableTableId: env.BITABLE_TABLE_ID || '',
  port: Number(env.PORT || 7610),
  accessKey: env.ACCESS_KEY || '',
  envFile: path.join(root, '.env'),
};

// 记录的一级分类（与多维表格「分类」单选列的选项保持一致）
export const CATEGORIES = ['餐饮', '购物', '居家', '交通', '娱乐', '医疗', '人情往来', '学习', '宠物', '其他'];

// 支付账户（渠道只是属性，不是账本维度）
export const ACCOUNTS = ['支付宝', '微信', '银行卡', '信用卡', '京东白条', '现金', '未指定'];

// 交易类型：转账/还款不计入消费统计
export const TYPES = ['支出', '收入', '转账', '还款'];

export const PLATFORMS = ['京东', '美团', '淘宝', '拼多多', '抖音', '饿了么', '线下', '其他'];

export const SOURCES = ['机器人', '语音', '手动'];

// 规则兜底用的分类关键词表（LLM 不可用时也能分类常见消费）
export const CATEGORY_KEYWORDS = {
  餐饮: ['饭', '餐', '吃', '外卖', '咖啡', '奶茶', '茶', '饮', '食', '早点', '早餐', '午餐', '晚餐', '夜宵', '水果', '零食', '米其林', '火锅', '烧烤', '菜', '肉', '鱼', '虾', '面包', '蛋糕', '甜品', '汉堡', '披萨', '面', '粉', '粥', '饮料', '可乐', '啤酒', '酒'],
  购物: ['淘宝', '京东', '拼多多', '买', '购', '订单', '衣服', '鞋', '裤', '衫', '包', '数码', '手机', '电脑', '耳机', '家电', '家具', '日用品', '纸巾', '洗护', '化妆品', '护肤', '充值', '会员', '视频会员'],
  居家: ['房租', '水费', '电费', '燃气', '物业', '宽带', '网费', '话费', '房贷', '装修', '维修', '保洁', '家具安装', '生活缴费'],
  交通: ['打车', '滴滴', '出租', '地铁', '公交', '火车', '高铁', '机票', '飞机', '加油', '充油卡', '停车', '共享单车', '单车', '哈啰', '摩拜', '高铁票', '12306'],
  娱乐: ['电影', '游戏', 'steam', 'Switch', 'KTV', '演出', '门票', '旅游', '酒店', '民宿', '景点', '剧本杀', '密室', '健身', '运动', '球'],
  医疗: ['药', '医院', '挂号', '看病', '体检', '牙', '眼科', '诊所', '门诊', '疫苗'],
  人情往来: ['红包', '礼物', '随礼', '份子', '彩礼', '请客', '送礼', '孝敬', '给爸妈', '给妈', '给爸'],
  学习: ['买书', '书', '课程', '培训', '考试', '学费', '知识付费', '得到', '网课', '文具'],
  宠物: ['猫', '狗', '宠物', '猫粮', '狗粮', '猫砂', '疫苗宠物', '驱虫'],
};

// 账户关键词
export const ACCOUNT_KEYWORDS = [
  [/白条/i, '京东白条'],
  [/支付宝|花呗/i, '支付宝'],
  [/微信|weixin/i, '微信'],
  [/信用卡/i, '信用卡'],
  [/现金/i, '现金'],
  [/银行卡|储蓄卡|招行|工行|建行|中行|农行|交行|民生|平安银行|光大|华夏|浦发|兴业|广发/i, '银行卡'],
];

// 分类在 UI 中使用的展示色（与 Web 端保持一致）
export const CATEGORY_COLORS = {
  餐饮: '#e8590c',
  购物: '#1971c2',
  居家: '#5f3dc4',
  交通: '#0c8599',
  娱乐: '#c2255c',
  医疗: '#2f9e44',
  人情往来: '#f08c00',
  学习: '#6741d9',
  宠物: '#e64980',
  其他: '#868e96',
  收入: '#2f9e44',
  转账: '#868e96',
  还款: '#adb5bd',
};
