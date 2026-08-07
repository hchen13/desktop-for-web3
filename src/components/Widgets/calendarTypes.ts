/**
 * Calendar Widget 类型定义
 * 基于 design/widgets/calendar/design-spec.md
 */

/**
 * 视图模式
 */
export type CalendarViewMode = 'full' | 'compact';

/**
 * 事件类型
 */
export type eventType = 'unlock' | 'airdrop' | 'upgrade' | 'conference' | 'macro';

/**
 * Web3 事件
 */
export interface Web3Event {
  id: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM UTC (可选)
  title: string;
  type: eventType;
  description?: string;
  url?: string;
}

/**
 * 日期事件映射
 * key: YYYY-MM-DD, value: Web3Event[]
 */
export type EventsByDate = Record<string, Web3Event[]>;

/**
 * 视图状态
 */
export interface CalendarViewState {
  mode: CalendarViewMode;
  currentMonth: number; // 0-11
  currentYear: number;
  selectedDate: string | null;
}

/**
 * 事件类型配置
 */
export const EVENT_TYPE_CONFIG = {
  unlock: {
    label: '代币解锁',
    color: 'var(--red-down)',
    icon: '🔓',
  },
  airdrop: {
    label: '空投投放',
    color: 'var(--green-up)',
    icon: '🎁',
  },
  upgrade: {
    label: '技术升级',
    color: 'var(--yellow-warn)',
    icon: '⚡',
  },
  conference: {
    label: '行业会议',
    color: 'var(--blue-main)',
    icon: '👥',
  },
  macro: {
    label: '重要宏观事件',
    color: 'var(--purple-main, #9b87f5)',
    icon: '📈',
  },
} as const;

/**
 * 事件优先级排序（用于极简视图）
 */
export const EVENT_PRIORITY: Record<eventType, number> = {
  unlock: 1, // 高财务影响
  airdrop: 2, // 高用户关注
  upgrade: 3, // 中等影响
  conference: 4, // 低直接影响
  macro: 1, // 高市场影响
} as const;
