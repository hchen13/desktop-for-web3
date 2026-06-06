/**
 * Favicon 来源优先级 — 单一来源
 * faviconService 与 iconCache 都从这里 import，确保一致
 *
 * 优先级越高越优先选择。Google 自动添加白底，对深色主题最友好。
 * Chrome _favicon 对未访问站点可能返回浏览器灰色地球，只能作为低优先级兜底。
 */
export const SOURCE_PRIORITY: Record<string, number> = {
  'google.com/s2/favicons': 75,
  't3.gstatic.com/faviconV2': 75,
  't2.gstatic.com/faviconV2': 75,
  't1.gstatic.com/faviconV2': 75,
  't0.gstatic.com/faviconV2': 75,
  'chrome-extension://': 30,
  'icons.duckduckgo.com': 20,
  'favicone.com': 18,
  'icon.horse': 15,
  'favicon.ico': 8,
};

/**
 * 未知来源默认分数
 */
export const UNKNOWN_SOURCE_SCORE = 5;

/**
 * 根据 URL 取得来源分数
 */
export function getSourcePriorityScore(url: string): number {
  for (const [key, score] of Object.entries(SOURCE_PRIORITY)) {
    if (url.includes(key)) return score;
  }
  return UNKNOWN_SOURCE_SCORE;
}
