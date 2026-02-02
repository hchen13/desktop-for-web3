/**
 * Calendar Widget - Web3 日历组件
 *
 * 重构版本：
 * - 移除捕获阶段事件监听
 * - 使用 Portal 渲染 tooltip，避免被父组件 overflow 裁剪
 * - 简化点击处理逻辑
 * - 使用统一的 ContextMenu 组件
 * - 集成 CoinMarketCal API 获取真实事件数据
 */

import { createSignal, createEffect, createMemo, onMount, Show, For, Index } from 'solid-js';
import { Portal } from '../layout/Portal';
import { useContextMenu } from '../layout/ContextMenu';
import type { ContextMenuItem } from '../layout/ContextMenu';
import { mergeMenuItems, getElementIdFromEvent } from '../../grid/contextMenuUtils';
import type {
  CalendarViewMode,
  Web3Event,
  EventsByDate,
  eventType,
} from './calendarTypes';
import {
  EVENT_TYPE_CONFIG,
} from './calendarTypes';
import {
  getEventsForAdjacentMonths,
  groupEventsByDate,
  clearCache,
} from '../../services/coinmarketcalService';
import type { WidgetState } from '../../config/widgetDefaults';

// Props 接口（由 GridContainer 传入）
interface CalendarWidgetProps {
  elementId?: string;
  state?: WidgetState;
  onStateChange?: (newState: WidgetState) => void;
  viewMode?: CalendarViewMode;
  onViewModeChange?: (mode: CalendarViewMode) => void;
}

export const CalendarWidget = (props: CalendarWidgetProps = {}) => {
  // ===== 状态 =====
  const [viewMode, setViewMode] = createSignal<CalendarViewMode>(props.viewMode || 'full');
  const [currentMonth, setCurrentMonth] = createSignal(new Date().getMonth());
  const [currentYear, setCurrentYear] = createSignal(new Date().getFullYear());
  const [selectedDate, setSelectedDate] = createSignal<string | null>(null);
  const [hoverDate, setHoverDate] = createSignal<string | null>(null);
  const [hoverPosition, setHoverPosition] = createSignal<{
    x: number;
    y: number;
    showAbove: boolean;
    showLeft: boolean;
  }>({ x: 0, y: 0, showAbove: false, showLeft: false });

  // 使用统一的右键菜单
  const { ContextMenuComponent, showContextMenu } = useContextMenu();

  // 拖拽检测：记录鼠标按下时的位置
  let mouseDownPos = { x: 0, y: 0 };
  const isDraggingClick = (currentX: number, currentY: number) => {
    // 如果鼠标移动超过 5px，认为是拖拽而不是点击
    return Math.abs(currentX - mouseDownPos.x) > 5 || Math.abs(currentY - mouseDownPos.y) > 5;
  };

  // 事件数据
  const [eventsByDate, setEventsByDate] = createSignal<EventsByDate>({});
  const [todayEvents, setTodayEvents] = createSignal<Web3Event[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // ===== 初始化 =====
  onMount(() => {
    // 加载真实事件数据
    refreshEventsForCurrentMonth();

    // 默认使用完整视图
    setViewMode('full');
  });

  // 当年月变化时，刷新事件数据（包括相邻月份）
  const refreshEventsForCurrentMonth = async () => {
    const year = currentYear();
    const month = currentMonth();

    setIsLoading(true);
    setError(null);

    try {
      // 获取相邻三个月的事件数据
      const eventsByMonth = await getEventsForAdjacentMonths(year, month);

      // 提取今天的事件
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      const todayEventsList = eventsByMonth[todayStr] || [];

      setEventsByDate(eventsByMonth);
      setTodayEvents(todayEventsList);
    } catch (err) {
      console.error('[CalendarWidget] Failed to load events:', err);
      setError(err instanceof Error ? err.message : '加载事件数据失败');
      // 发生错误时设置空数据
      setEventsByDate({});
      setTodayEvents([]);
    } finally {
      setIsLoading(false);
    }
  };

  // 监听年月变化
  createEffect(() => {
    // 追踪依赖以确保响应式更新
    currentYear();
    currentMonth();
    refreshEventsForCurrentMonth();
  });

  // ===== 视图模式切换 =====
  const toggleViewMode = () => {
    const newMode = viewMode() === 'full' ? 'compact' : 'full';
    setViewMode(newMode);
    props.onViewModeChange?.(newMode);
  };

  // ===== 月份导航 =====
  const prevMonth = () => {
    const newMonth = currentMonth() - 1;
    if (newMonth < 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear() - 1);
    } else {
      setCurrentMonth(newMonth);
    }
  };

  const nextMonth = () => {
    const newMonth = currentMonth() + 1;
    if (newMonth > 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear() + 1);
    } else {
      setCurrentMonth(newMonth);
    }
  };

  // 回到今日
  const goToToday = () => {
    const now = new Date();
    setCurrentMonth(now.getMonth());
    setCurrentYear(now.getFullYear());
  };

  // 判断当前显示的月份是否为今日所在月份
  const isCurrentMonthToday = createMemo(() => {
    const now = new Date();
    return currentMonth() === now.getMonth() && currentYear() === now.getFullYear();
  });

  // ===== 日期计算 =====
  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfWeek = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const isToday = (day: number) => {
    const now = new Date();
    return day === now.getDate() &&
      currentMonth() === now.getMonth() &&
      currentYear() === now.getFullYear();
  };

  const isSelected = (day: number) => {
    const dateStr = `${currentYear()}-${String(currentMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return selectedDate() === dateStr;
  };

  // ===== 事件获取 =====
  // 使用 createMemo 创建响应式的每日事件映射
  const eventsByDay = createMemo(() => {
    const grouped = eventsByDate();
    const year = currentYear();
    const month = currentMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const result: Record<number, Web3Event[]> = {};

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      result[day] = grouped[dateStr] || [];
    }

    return result;
  });

  // 创建响应式的日历日期数组（用于 For 组件）
  const calendarDays = createMemo(() => {
    const eventsMap = eventsByDay();
    const year = currentYear();
    const month = currentMonth();
    const daysInMonth = getDaysInMonth(year, month);

    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const events = eventsMap[day] || [];
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return {
        day,
        dateStr,
        events,
        hasEvents: events.length > 0,
        isToday: day === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear(),
        isSelected: selectedDate() === dateStr,
      };
    });
  });

  // 固定6行网格（42个单元格 = 7列 × 6行）
  const calendarGridCells = createMemo(() => {
    const year = currentYear();
    const month = currentMonth();
    const firstDayOfWeek = getFirstDayOfWeek(year, month);
    const daysInMonth = getDaysInMonth(year, month);
    const TOTAL_CELLS = 42; // 7列 × 6行

    type DayData = {
      day: number;
      dateStr: string;
      events: Web3Event[];
      hasEvents: boolean;
      isToday: boolean;
      isSelected: boolean;
      isOtherMonth: boolean;
    };

    const cells: Array<{
      isEmpty: boolean;
      dayData?: DayData;
    }> = [];

    // 计算上个月的日期
    const prevMonthDays = getDaysInMonth(year, month - 1);
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    const prevMonthEventsMap = eventsByDate();
    const prevDaysNeeded = firstDayOfWeek;

    for (let i = prevDaysNeeded - 1; i >= 0; i--) {
      const day = prevMonthDays - i;
      const dateStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const events = prevMonthEventsMap[dateStr] || [];
      cells.push({
        isEmpty: false,
        dayData: {
          day,
          dateStr,
          events,
          hasEvents: events.length > 0,
          isToday: false,
          isSelected: selectedDate() === dateStr,
          isOtherMonth: true,
        },
      });
    }

    // 添加当前月日期
    const days = calendarDays();
    for (const day of days) {
      cells.push({
        isEmpty: false,
        dayData: { ...day, isOtherMonth: false },
      });
    }

    // 计算下个月的日期
    const remainingCells = TOTAL_CELLS - cells.length;
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;

    for (let i = 1; i <= remainingCells; i++) {
      const dateStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      const events = prevMonthEventsMap[dateStr] || [];
      cells.push({
        isEmpty: false,
        dayData: {
          day: i,
          dateStr,
          events,
          hasEvents: events.length > 0,
          isToday: false,
          isSelected: selectedDate() === dateStr,
          isOtherMonth: true,
        },
      });
    }

    return cells;
  });

  const getEventsForDay = (day: number) => {
    return eventsByDay()[day] || [];
  };

  // 获取指定日期的事件（用于 tooltip）
  const getEventsForDate = (dateStr: string, allEvents: EventsByDate) => {
    return allEvents[dateStr] || [];
  };

  // ===== 交互处理 =====
  const handleDateClick = (day: number, event: MouseEvent, dateStr?: string, isOtherMonth?: boolean) => {
    // 如果是拖拽操作，不处理点击
    if (isDraggingClick(event.clientX, event.clientY)) {
      return;
    }

    const currentDateStr = dateStr || `${currentYear()}-${String(currentMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // 从 eventsByDate 获取该日期的事件（支持其他月份）
    const allEvents = eventsByDate();
    const events = allEvents[currentDateStr] || [];

    // 无事件的日期不响应点击
    if (events.length === 0) {
      return;
    }

    // 如果点击的是当前已选中的日期，关闭卡片
    if (hoverDate() === currentDateStr) {
      setHoverDate(null);
      setSelectedDate(null);
    } else {
      // 显示事件卡片
      setHoverDate(currentDateStr);

      // 智能计算 tooltip 位置 - 确保完全在视口内
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const events = allEvents[currentDateStr] || [];
      const eventCount = events.length;

      // 卡片尺寸常量
      const CARD_WIDTH = 240;
      const ITEM_HEIGHT = 40;
      const PADDING = 16;
      const SPACING = 8;
      const MAX_VISIBLE_ITEMS = 5;

      // 计算卡片实际高度
      const cardContentHeight = Math.min(eventCount, MAX_VISIBLE_ITEMS) * ITEM_HEIGHT + PADDING * 2;
      const cardHeight = cardContentHeight;

      // 视口边界
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const MARGIN = 8; // 与视口边缘的最小间距

      // ===== 水平位置计算 =====
      // 默认：卡片中心对齐日期单元格中心
      let cardLeft = rect.left + rect.width / 2 - CARD_WIDTH / 2;
      let showLeft = false;

      // 检查左边界
      if (cardLeft < MARGIN) {
        cardLeft = MARGIN;
      }
      // 检查右边界
      else if (cardLeft + CARD_WIDTH > viewportWidth - MARGIN) {
        cardLeft = viewportWidth - CARD_WIDTH - MARGIN;
      }

      // ===== 垂直位置计算 =====
      // 默认显示在下方
      let cardTop = rect.bottom + SPACING;
      let showAbove = false;

      // 检查下方空间是否足够
      if (cardTop + cardHeight > viewportHeight - MARGIN) {
        // 尝试显示在上方
        const aboveTop = rect.top - cardHeight - SPACING;

        if (aboveTop >= MARGIN) {
          // 上方空间足够，显示在上方
          cardTop = aboveTop;
          showAbove = true;
        } else {
          // 上下都不够，选择空间较大的一侧
          const spaceBelow = viewportHeight - rect.bottom - MARGIN;
          const spaceAbove = rect.top - MARGIN;

          if (spaceBelow >= spaceAbove) {
            // 下方空间更大，使用下方并限制在视口内
            cardTop = Math.min(rect.bottom + SPACING, viewportHeight - cardHeight - MARGIN);
            showAbove = false;
          } else {
            // 上方空间更大，使用上方并限制在视口内
            cardTop = Math.max(MARGIN, rect.top - cardHeight - SPACING);
            showAbove = true;
          }
        }
      }

      setHoverPosition({
        x: cardLeft,
        y: cardTop,
        showAbove,
        showLeft,
      });
      setSelectedDate(currentDateStr);
    }
  };

  // 记录鼠标按下时的位置（用于区分点击和拖拽）
  const handleMouseDown = (event: MouseEvent) => {
    mouseDownPos = { x: event.clientX, y: event.clientY };
  };

  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    // 获取当前元素的 ID
    const elementId = getElementIdFromEvent(event.target);
    if (!elementId) {
      console.warn('[Calendar] Could not find element ID for context menu');
      return;
    }

    // 组件特有的菜单项
    const componentItems: ContextMenuItem[] = [
      {
        label: '切换视图模式',
        action: () => toggleViewMode(),
      },
      {
        label: '刷新事件数据',
        action: () => {
          clearCache();
          refreshEventsForCurrentMonth();
        },
      },
      {
        label: '组件设置...',
        action: () => {
          // TODO: 实现组件设置
        },
        disabled: true,
      },
    ];

    // 合并组件菜单项和默认菜单项（删除）
    const menuItems = mergeMenuItems(componentItems, elementId, false);

    showContextMenu(event.clientX, event.clientY, menuItems);
  };

  const closeTooltip = () => {
    setHoverDate(null);
    setSelectedDate(null);
  };

  // ===== 日期格式化 =====
  const formatDate = () => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const date = now.getDate();
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const weekday = weekdays[now.getDay()];

    return { month: `${month}月${date}日`, weekday };
  };

  // ===== 渲染 =====
  return (
    <>
      <div
        class="calendar-widget"
        classList={{ 'calendar-widget--compact': viewMode() === 'compact' }}
        onContextMenu={handleContextMenu}
      >
        {/* 完整视图 */}
        <Show when={viewMode() === 'full'}>
          <div class="calendar-widget__full">
            {/* 头部 - Bloomberg 终端风格 */}
            <div class="calendar-header">
              <span class="calendar-header__title">
                {currentYear()}年{currentMonth() + 1}月
              </span>
              <div class="calendar-header__right">
                <Show when={!isCurrentMonthToday()}>
                  <button class="calendar-header__btn calendar-header__btn--today" onClick={goToToday}>
                    今日
                  </button>
                </Show>
                <button class="calendar-header__btn" onClick={prevMonth} aria-label="上一月">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
                  </svg>
                </button>
                <button class="calendar-header__btn" onClick={nextMonth} aria-label="下一月">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* 星期标题 */}
            <div class="calendar-weekdays">
              <For each={['日', '一', '二', '三', '四', '五', '六']}>
                {(day) => <div class="calendar-weekday">{day}</div>}
              </For>
            </div>

            {/* 日期网格 - 固定6行 */}
            <div class="calendar-days">
              <For each={calendarGridCells()}>
                {(cell) => {
                  const dayData = cell.dayData;
                  if (!dayData) return null;

                  const dayNum = dayData.day;
                  const events = dayData.events;
                  const hasEvents = dayData.hasEvents;
                  const isOtherMonth = dayData.isOtherMonth;
                  const dateStr = dayData.dateStr;

                  return (
                    <div
                      class={`calendar-day ${dayData.isToday ? 'calendar-day--today' : ''} ${dayData.isSelected ? 'calendar-day--selected' : ''} ${hasEvents ? 'calendar-day--has-events' : ''} ${isOtherMonth ? 'calendar-day--other-month' : ''}`}
                      onMouseDown={(e) => handleMouseDown(e)}
                      onClick={(e) => handleDateClick(dayNum, e, dateStr, isOtherMonth)}
                    >
                      <span class="calendar-day__number">{dayNum}</span>

                      {/* 事件计数 */}
                      <Show when={hasEvents}>
                        <span class="calendar-day__count">
                          {events.length > 9 ? '9+' : events.length}
                        </span>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        </Show>

        {/* 极简视图 */}
        <Show when={viewMode() === 'compact'}>
          <div class="calendar-widget__compact">
            {/* 日期信息 */}
            <div class="compact-header">
              <div class="compact-header__date">
                <span class="compact-header__month">{formatDate().month}</span>
                <span class="compact-header__weekday">{formatDate().weekday}</span>
              </div>
            </div>

            {/* 今日事件列表 */}
            <div class="compact-events">
              <div class="compact-events__title">今日重要事件</div>
              <Show
                when={todayEvents().length > 0}
                fallback={<div class="compact-events__empty">今日无重要事件</div>}
              >
                <For each={todayEvents().slice(0, 4)}>
                  {(event) => (
                    <div class="compact-event">
                      <span
                        class="compact-event__bar"
                        style={{ 'background-color': EVENT_TYPE_CONFIG[event.type].color }}
                      />
                      <span class="compact-event__icon">{EVENT_TYPE_CONFIG[event.type].icon}</span>
                      <span class="compact-event__title">{event.title}</span>
                      <Show when={event.time}>
                        <span class="compact-event__time">{event.time}</span>
                      </Show>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </Show>
      </div>

      {/* Tooltip 使用 Portal 渲染到 body */}
      <Show when={hoverDate()}>
        <Portal enabled={true}>
          <>
            {/* 点击外部关闭 overlay */}
            <div
              class="event-tooltip__overlay"
              onClick={closeTooltip}
            />
            {/* 悬浮事件卡片 */}
            <div
              class="event-tooltip"
              classList={{ 'event-tooltip--above': hoverPosition().showAbove }}
              style={{
                left: `${hoverPosition().x}px`,
                top: `${hoverPosition().y}px`,
              }}
            >
              <div class="event-tooltip__triangle" />
              <div class="event-tooltip__list">
                <For each={getEventsForDate(hoverDate()!, eventsByDate())}>
                  {(event) => (
                    <div
                      class="event-tooltip__item"
                      classList={{ 'event-tooltip__item--clickable': !!event.url }}
                      onMouseDown={(e) => {
                        // 阻止 mousedown 事件冒泡，防止被拖拽检测捕获
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        if (event.url) {
                          e.stopPropagation();
                          e.preventDefault();
                          // 在扩展环境使用 chrome.tabs，否则使用创建 a 标签的方式跳转
                          if (chrome.tabs) {
                            chrome.tabs.create({ url: event.url });
                          } else {
                            // 使用创建 a 标签并模拟点击的方式，避免弹窗拦截
                            const link = document.createElement('a');
                            link.href = event.url;
                            link.target = '_blank';
                            link.rel = 'noopener noreferrer';
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                          }
                        }
                      }}
                      onContextMenu={(e) => {
                        // 阻止右键菜单，防止与组件右键菜单冲突
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                    >
                      <span
                        class="event-tooltip__bar"
                        style={{ 'background-color': EVENT_TYPE_CONFIG[event.type].color }}
                      />
                      <div class="event-tooltip__content">
                        <div class="event-tooltip__title">{event.title}</div>
                        <div class="event-tooltip__time">{event.time || ''}</div>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </>
        </Portal>
      </Show>

      {/* 右键菜单组件 */}
      <ContextMenuComponent />

      <style>{`
        .calendar-widget {
          background: #0a0b0d;
          border: 1px solid #1c1f24;
          border-radius: 16px;
          width: 100%;
          height: 100%;
          position: relative;
          overflow: hidden;
        }

        /* ===== 完整视图 ===== */
        .calendar-widget__full {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
        }

        /* 头部 - Bloomberg 终端风格 */
        .calendar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 32px;
          background: #14171a;
          padding: 0 16px;
        }

        .calendar-header__right {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .calendar-header__title {
          font-size: 11px;
          font-weight: 700;
          color: #ffffff;
          letter-spacing: 0;
        }

        .calendar-header__btn {
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          background: transparent;
          color: rgba(255, 255, 255, 0.4);
          cursor: pointer;
          border-radius: 4px;
          transition: color 0.15s ease;
        }

        .calendar-header__btn:hover {
          color: #ffffff;
        }

        .calendar-header__btn svg {
          display: block;
        }

        /* 今日按钮 */
        .calendar-header__btn--today {
          font-size: 10px;
          font-weight: 500;
          padding: 2px 8px;
          height: auto;
          color: rgba(255, 255, 255, 0.6);
        }

        .calendar-header__btn--today:hover {
          color: #ffffff;
          background: rgba(255, 255, 255, 0.08);
        }

        /* 星期标题 - 终端风格 */
        .calendar-weekdays {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          border-top: 1px solid rgba(255, 255, 255, 0.12);
        }

        .calendar-weekday {
          font-size: 10px;
          font-weight: 700;
          color: rgba(255, 255, 255, 0.4);
          text-align: center;
          padding: 4px 0;
          border-right: 1px solid rgba(255, 255, 255, 0.12);
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.02);
        }

        .calendar-weekday:last-child {
          border-right: none;
        }

        /* 日期网格 - 固定6行，带网格线 */
        .calendar-days {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          grid-template-rows: repeat(6, 1fr);
          flex: 1;
          overflow: hidden;
        }

        .calendar-day {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.15s ease;
          min-height: 0;
          width: 100%;
          border-right: 1px solid rgba(255, 255, 255, 0.12);
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          box-sizing: border-box;
        }

        .calendar-day:nth-child(7n) {
          border-right: none;
        }

        .calendar-day:nth-last-child(-n+7) {
          border-bottom: none;
        }

        .calendar-day:hover {
          background: rgba(255, 255, 255, 0.04);
        }

        /* 其他月份日期 - 极低透明度 */
        .calendar-day--other-month {
          opacity: 1;
        }

        .calendar-day--other-month .calendar-day__number {
          color: rgba(255, 255, 255, 0.1);
        }

        .calendar-day--other-month {
          background: rgba(0, 0, 0, 0.15);
        }

        .calendar-day__number {
          font-size: 10px;
          color: rgba(255, 255, 255, 0.9);
          line-height: 1;
        }

        /* 今日高亮 - 终端蓝 */
        .calendar-day--today {
          background: #0095ff;
        }

        .calendar-day--today .calendar-day__number {
          color: #ffffff;
          font-weight: 700;
        }

        .calendar-day--selected {
          outline: 1px solid #0095ff;
          outline-offset: -1px;
        }

        /* 事件计数 - 彭博橙角标 */
        .calendar-day__count {
          position: absolute;
          top: 1px;
          right: 2px;
          font-size: 8px;
          font-weight: 700;
          color: #FF9900;
          line-height: 1;
        }

        .calendar-day--today .calendar-day__count {
          color: #ffffff;
        }

        /* 事件类型指示点 */
        .calendar-day__dots {
          position: absolute;
          bottom: 2px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 1px;
        }

        .calendar-day__dot {
          width: 3px;
          height: 3px;
          border-radius: 50%;
        }

        .calendar-day__dot-more {
          font-size: 6px;
          color: var(--text-tertiary);
          line-height: 1;
        }

        /* ===== 极简视图 ===== */
        .calendar-widget__compact {
          display: flex;
          flex-direction: column;
          padding: 12px;
          height: 100%;
          width: 100%;
          background: #0a0b0d;
        }

        .compact-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }

        .compact-header__date {
          display: flex;
          flex-direction: column;
        }

        .compact-header__month {
          font-size: 16px;
          font-weight: 700;
          color: #ffffff;
          line-height: 1.2;
        }

        .compact-header__weekday {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.4);
        }

        .compact-events {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .compact-events__title {
          font-size: 9px;
          font-weight: 700;
          color: rgba(255, 255, 255, 0.4);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 4px;
        }

        .compact-events__empty {
          font-size: 10px;
          color: rgba(255, 255, 255, 0.4);
          text-align: center;
          padding: 12px;
        }

        .compact-event {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px;
          border-radius: 4px;
          transition: background 0.15s ease;
          cursor: pointer;
        }

        .compact-event:hover {
          background: rgba(255, 255, 255, 0.04);
        }

        .compact-event__bar {
          width: 3px;
          height: 14px;
          border-radius: 2px;
          flex-shrink: 0;
        }

        .compact-event__icon {
          font-size: 11px;
          flex-shrink: 0;
        }

        .compact-event__title {
          flex: 1;
          font-size: 10px;
          color: rgba(255, 255, 255, 0.9);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .compact-event__time {
          font-size: 8px;
          color: rgba(255, 255, 255, 0.4);
          flex-shrink: 0;
        }

        /* ===== 悬浮事件卡片 ===== */
        .event-tooltip {
          position: fixed;
          z-index: 1000;
          background: #14171a;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 8px;
          padding: 8px;
          width: 240px;
          max-width: 240px;
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
          pointer-events: auto;
        }

        /* 三角指示器 - 动态位置 */
        .event-tooltip__triangle {
          position: absolute;
          width: 0;
          height: 0;
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
        }

        /* 卡片显示在下方时，三角在顶部 */
        .event-tooltip:not(.event-tooltip--above) .event-tooltip__triangle {
          top: -6px;
          left: 50%;
          transform: translateX(-50%);
          border-bottom: 6px solid #14171a;
        }

        /* 卡片显示在上方时，三角在底部 */
        .event-tooltip--above .event-tooltip__triangle {
          bottom: -6px;
          left: 50%;
          transform: translateX(-50%);
          border-top: 6px solid #14171a;
        }

        .event-tooltip__list {
          max-height: 280px;
          overflow-y: auto;
          overflow-x: hidden;
          padding-right: 3px;
        }

        /* 自定义滚动条样式 */
        .event-tooltip__list::-webkit-scrollbar {
          width: 4px;
        }

        .event-tooltip__list::-webkit-scrollbar-track {
          background: transparent;
        }

        .event-tooltip__list::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.15);
          border-radius: 2px;
        }

        .event-tooltip__list::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.25);
        }

        .event-tooltip__item {
          display: flex;
          gap: 8px;
          padding: 6px 8px;
          border-radius: 4px;
          min-height: 32px;
          transition: background 0.15s ease;
        }

        .event-tooltip__item--clickable {
          cursor: pointer;
        }

        .event-tooltip__item:hover {
          background: rgba(255, 255, 255, 0.04);
        }

        .event-tooltip__item:not(:last-child) {
          margin-bottom: 2px;
        }

        .event-tooltip__bar {
          width: 3px;
          border-radius: 2px;
          flex-shrink: 0;
        }

        .event-tooltip__content {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 2px;
        }

        .event-tooltip__title {
          font-size: 11px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.9);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.3;
        }

        .event-tooltip__time {
          font-size: 10px;
          color: rgba(255, 255, 255, 0.4);
          line-height: 1;
          min-height: 10px;
        }

        .event-tooltip__overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          z-index: 999;
          pointer-events: auto;
        }
      `}</style>
    </>
  );
};
