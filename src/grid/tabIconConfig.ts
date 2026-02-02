/**
 * Tab 图标配置
 * 使用 Bootstrap Icons SVG
 *
 * 面向 Web3 用户：开发、金融、社交、工具、撸毛、生活
 */

export interface TabIcon {
  id: string;
  name: string;
  iconName: string;
  category: 'common' | 'dev' | 'finance' | 'social' | 'tools' | 'life';
}

export const TAB_ICON_CONFIG: TabIcon[] = [
  // 通用 - 主页、收藏、常用
  { id: 'house', name: '主页', iconName: 'house', category: 'common' },
  { id: 'star', name: '收藏', iconName: 'star', category: 'common' },
  { id: 'heart', name: '喜欢', iconName: 'heart', category: 'common' },
  { id: 'bookmark', name: '书签', iconName: 'bookmark', category: 'common' },
  { id: 'flag', name: '标记', iconName: 'flag', category: 'common' },
  { id: 'bell', name: '通知', iconName: 'bell', category: 'common' },
  { id: 'lightbulb', name: '灵感', iconName: 'lightbulb', category: 'common' },
  { id: 'award', name: '成就', iconName: 'award', category: 'common' },
  { id: 'trophy', name: '奖杯', iconName: 'trophy', category: 'common' },
  { id: 'gem', name: '钻石', iconName: 'gem', category: 'common' },
  { id: 'grid', name: '全部', iconName: 'grid', category: 'common' },
  { id: 'list', name: '列表', iconName: 'list', category: 'common' },

  // 开发 - 技术、编程、文档、测试网
  { id: 'code', name: '代码', iconName: 'code-slash', category: 'dev' },
  { id: 'terminal', name: '终端', iconName: 'terminal', category: 'dev' },
  { id: 'git', name: 'Git', iconName: 'git', category: 'dev' },
  { id: 'github', name: 'GitHub', iconName: 'github', category: 'dev' },
  { id: 'file-code', name: '脚本', iconName: 'file-code', category: 'dev' },
  { id: 'braces', name: '合约', iconName: 'braces', category: 'dev' },
  { id: 'bug', name: '调试', iconName: 'bug', category: 'dev' },
  { id: 'hammer', name: '构建', iconName: 'hammer', category: 'dev' },
  { id: 'book', name: '文档', iconName: 'book', category: 'dev' },
  { id: 'cpu', name: '节点', iconName: 'cpu', category: 'dev' },
  { id: 'server', name: '服务器', iconName: 'server', category: 'dev' },
  { id: 'database', name: '数据库', iconName: 'database', category: 'dev' },

  // 金融 - 交易、DeFi、撸毛 (合并原 trade + defi)
  { id: 'graph-up', name: '行情', iconName: 'graph-up-arrow', category: 'finance' },
  { id: 'bar-chart', name: 'K线', iconName: 'bar-chart-line', category: 'finance' },
  { id: 'currency-btc', name: 'BTC', iconName: 'currency-bitcoin', category: 'finance' },
  { id: 'currency-exchange', name: '兑换', iconName: 'currency-exchange', category: 'finance' },
  { id: 'wallet', name: '钱包', iconName: 'wallet', category: 'finance' },
  { id: 'bank', name: '银行', iconName: 'bank', category: 'finance' },
  { id: 'credit-card', name: '支付', iconName: 'credit-card', category: 'finance' },
  { id: 'calculator', name: '计算', iconName: 'calculator', category: 'finance' },
  { id: 'safe', name: '金库', iconName: 'safe', category: 'finance' },
  { id: 'shield', name: '安全', iconName: 'shield', category: 'finance' },
  { id: 'lock', name: '锁仓', iconName: 'lock', category: 'finance' },
  { id: 'gift', name: '空投', iconName: 'gift', category: 'finance' },

  // 社交 - KOL、Twitter、Discord、TG、社区
  { id: 'people', name: '社区', iconName: 'people', category: 'social' },
  { id: 'person', name: 'KOL', iconName: 'person', category: 'social' },
  { id: 'chat', name: '讨论', iconName: 'chat-left-quote', category: 'social' },
  { id: 'megaphone', name: '公告', iconName: 'megaphone', category: 'social' },
  { id: 'envelope', name: '邮件', iconName: 'envelope', category: 'social' },
  { id: 'rss', name: '订阅', iconName: 'rss', category: 'social' },
  { id: 'newspaper', name: '资讯', iconName: 'newspaper', category: 'social' },
  { id: 'tv', name: '直播', iconName: 'tv', category: 'social' },
  { id: 'camera', name: '媒体', iconName: 'camera', category: 'social' },
  { id: 'mic', name: '播客', iconName: 'mic', category: 'social' },
  { id: 'globe', name: '全球', iconName: 'globe', category: 'social' },
  { id: 'translate', name: '多语言', iconName: 'translate', category: 'social' },

  // 工具 - 撸毛任务、数据查询、NFT、创作
  { id: 'tools', name: '工具', iconName: 'tools', category: 'tools' },
  { id: 'gear', name: '设置', iconName: 'gear', category: 'tools' },
  { id: 'wrench', name: '配置', iconName: 'wrench', category: 'tools' },
  { id: 'search', name: '查询', iconName: 'search', category: 'tools' },
  { id: 'qr-code', name: '扫码', iconName: 'qr-code', category: 'tools' },
  { id: 'link', name: '链接', iconName: 'link-45deg', category: 'tools' },
  { id: 'clipboard', name: '任务', iconName: 'clipboard', category: 'tools' },
  { id: 'check-circle', name: '完成', iconName: 'check-circle', category: 'tools' },
  { id: 'clock', name: '计时', iconName: 'clock', category: 'tools' },
  { id: 'calendar', name: '日程', iconName: 'calendar', category: 'tools' },
  { id: 'palette', name: '创作', iconName: 'palette', category: 'tools' },
  { id: 'image', name: 'NFT', iconName: 'image', category: 'tools' },

  // 生活 - 购物、旅游、娱乐、美食
  { id: 'cart', name: '购物', iconName: 'cart', category: 'life' },
  { id: 'shop', name: '商店', iconName: 'shop', category: 'life' },
  { id: 'bag', name: '时尚', iconName: 'bag', category: 'life' },
  { id: 'airplane', name: '旅游', iconName: 'airplane', category: 'life' },
  { id: 'suitcase', name: '出行', iconName: 'suitcase', category: 'life' },
  { id: 'camera-life', name: '摄影', iconName: 'camera2', category: 'life' },
  { id: 'music', name: '音乐', iconName: 'music-note-beamed', category: 'life' },
  { id: 'film', name: '影视', iconName: 'film', category: 'life' },
  { id: 'controller', name: '游戏', iconName: 'controller', category: 'life' },
  { id: 'cake', name: '美食', iconName: 'cake2', category: 'life' },
  { id: 'cup', name: '咖啡', iconName: 'cup-hot', category: 'life' },
  { id: 'gift-life', name: '礼物', iconName: 'gift', category: 'life' },
];

export const TAB_CATEGORY_LABELS: Record<string, string> = {
  common: '通用',
  dev: '开发',
  finance: '金融',
  social: '社交',
  tools: '工具',
  life: '生活',
};

export const TAB_CATEGORIES: Array<keyof typeof TAB_CATEGORY_LABELS> = ['common', 'dev', 'finance', 'social', 'tools', 'life'];

export const getTabIconsByCategory = (category: keyof typeof TAB_CATEGORY_LABELS): TabIcon[] => {
  return TAB_ICON_CONFIG.filter(icon => icon.category === category);
};
