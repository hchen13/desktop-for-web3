/**
 * i18n 国际化系统
 * 支持中英文切换，为未来扩展预留设计空间
 */

export type Language = 'zh' | 'en';

export interface I18nConfig {
  language: Language;
}

// 当前语言设置（默认中文）
let currentLanguage: Language = 'zh';

// 翻译字典
const translations: Record<Language, Record<string, string>> = {
  zh: {
    'watchlist.title': '价格监控',
    'news.title': '资讯',
    'chain-monitor.title': '链上监控',
    'calendar.title': '日历',
  },
  en: {
    'watchlist.title': 'Watchlist',
    'news.title': 'News',
    'chain-monitor.title': 'Chain Monitor',
    'calendar.title': 'Calendar',
  },
};

/**
 * 获取当前语言
 */
export const getLanguage = (): Language => {
  return currentLanguage;
};

/**
 * 设置语言
 */
export const setLanguage = (lang: Language) => {
  currentLanguage = lang;
  // TODO: 触发全局语言变更事件，通知所有组件更新
};

/**
 * 翻译函数
 */
export const t = (key: string, fallback?: string): string => {
  const translation = translations[currentLanguage][key];
  if (translation) {
    return translation;
  }
  // 如果当前语言没有翻译，尝试使用英文作为回退
  const enTranslation = translations.en[key];
  if (enTranslation) {
    return enTranslation;
  }
  // 如果都没有，返回 fallback 或 key 本身
  return fallback || key;
};

/**
 * Hook 风格的翻译函数（用于 SolidJS 响应式）
 * TODO: 当实现语言切换功能时，创建响应式的 language signal
 */
export const useI18n = () => {
  return {
    t,
    language: currentLanguage,
    setLanguage,
  };
};
