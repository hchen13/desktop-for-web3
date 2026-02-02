/**
 * World Clock Widget - 世界时钟组件
 *
 * 显示三个城市的当前时间
 * 支持右键菜单编辑城市
 */

import { createSignal, createEffect, onMount, Show, For, Index } from 'solid-js';
import { Portal } from '../layout/Portal';
import { useContextMenu } from '../layout/ContextMenu';
import type { ContextMenuItem } from '../layout/ContextMenu';
import { mergeMenuItems, getElementIdFromEvent } from '../../grid/contextMenuUtils';

interface City {
  id: string;
  name: string;
  timezone: string;
  offset: number;
}

const AVAILABLE_CITIES: Omit<City, 'id'>[] = [
  { name: '北京', timezone: 'Asia/Shanghai', offset: 8 },
  { name: '纽约', timezone: 'America/New_York', offset: -5 },
  { name: '伦敦', timezone: 'Europe/London', offset: 0 },
  { name: '东京', timezone: 'Asia/Tokyo', offset: 9 },
  { name: '首尔', timezone: 'Asia/Seoul', offset: 9 },
  { name: '新加坡', timezone: 'Asia/Singapore', offset: 8 },
  { name: '香港', timezone: 'Asia/Hong_Kong', offset: 8 },
  { name: '迪拜', timezone: 'Asia/Dubai', offset: 4 },
  { name: '巴黎', timezone: 'Europe/Paris', offset: 1 },
  { name: '柏林', timezone: 'Europe/Berlin', offset: 1 },
  { name: '莫斯科', timezone: 'Europe/Moscow', offset: 3 },
  { name: '洛杉矶', timezone: 'America/Los_Angeles', offset: -8 },
  { name: '芝加哥', timezone: 'America/Chicago', offset: -6 },
  { name: '多伦多', timezone: 'America/Toronto', offset: -5 },
  { name: '圣保罗', timezone: 'America/Sao_Paulo', offset: -3 },
  { name: '悉尼', timezone: 'Australia/Sydney', offset: 11 },
  { name: '墨尔本', timezone: 'Australia/Melbourne', offset: 11 },
];

const STORAGE_KEY = 'world-clock-cities';

const DEFAULT_CITIES: City[] = [
  { id: '1', name: '北京', timezone: 'Asia/Shanghai', offset: 8 },
  { id: '2', name: '纽约', timezone: 'America/New_York', offset: -5 },
  { id: '3', name: '伦敦', timezone: 'Europe/London', offset: 0 },
];

interface TimeData {
  hours: number;
  minutes: number;
  isDay: boolean;
}

function getTimeInTimezone(timezone: string): TimeData {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  };
  const timeStr = new Intl.DateTimeFormat('en-US', options).format(now);
  const [hours, minutes] = timeStr.split(':').map(Number);

  const hourOptions: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  };
  const hour = parseInt(new Intl.DateTimeFormat('en-US', hourOptions).format(now), 10);

  return {
    hours,
    minutes,
    isDay: hour >= 6 && hour < 18,
  };
}

function formatTime(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatOffset(offset: number): string {
  if (offset >= 0) {
    return `+${offset}h`;
  }
  return `${offset}h`;
}

import type { WidgetState } from '../../config/widgetDefaults';

/** Widget 组件接收的 props（由 GridContainer 传入） */
interface WorldClockWidgetProps {
  elementId?: string;
  state?: WidgetState;
  onStateChange?: (newState: WidgetState) => void;
}

export const WorldClockWidget = (props: WorldClockWidgetProps) => {
  const [cities, setCities] = createSignal<City[]>(DEFAULT_CITIES);
  const [times, setTimes] = createSignal<TimeData[]>([]);
  const [isEditorOpen, setIsEditorOpen] = createSignal(false);
  const [editingSlotIndex, setEditingSlotIndex] = createSignal(0);
  const [selectedTimezone, setSelectedTimezone] = createSignal('');

  const { ContextMenuComponent, showContextMenu, closeContextMenu } = useContextMenu();

  const loadCities = async () => {
    try {
      if (chrome.storage?.local) {
        const result = await chrome.storage.local.get(STORAGE_KEY);
        if (result[STORAGE_KEY] && Array.isArray(result[STORAGE_KEY])) {
          setCities(result[STORAGE_KEY]);
        }
      }
    } catch (e) {
      console.error('[WorldClock] Failed to load cities:', e);
    }
  };

  const saveCities = async (newCities: City[]) => {
    try {
      if (chrome.storage?.local) {
        await chrome.storage.local.set({ [STORAGE_KEY]: newCities });
      }
    } catch (e) {
      console.error('[WorldClock] Failed to save cities:', e);
    }
  };

  onMount(() => {
    loadCities();

    const updateTimes = () => {
      const currentCities = cities();
      const newTimes = currentCities.map((city) => getTimeInTimezone(city.timezone));
      setTimes(newTimes);
    };

    updateTimes();
    const interval = setInterval(updateTimes, 1000);

    return () => clearInterval(interval);
  });

  createEffect(() => {
    const currentCities = cities();
    const newTimes = currentCities.map((city) => getTimeInTimezone(city.timezone));
    setTimes(newTimes);
  });

  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const elementId = getElementIdFromEvent(event.target);
    if (!elementId) return;

    const componentItems: ContextMenuItem[] = [
      {
        label: '编辑',
        action: () => openEditor(),
      },
    ];

    const menuItems = mergeMenuItems(componentItems, elementId, false);
    showContextMenu(event.clientX, event.clientY, menuItems);
  };

  const openEditor = () => {
    closeContextMenu();
    setEditingSlotIndex(0);
    setSelectedTimezone(cities()[0]?.timezone || '');
    setIsEditorOpen(true);
  };

  const closeEditor = () => {
    setIsEditorOpen(false);
  };

  const handleCityChange = (index: number, timezone: string) => {
    const cityData = AVAILABLE_CITIES.find((c) => c.timezone === timezone);
    if (!cityData) return;

    const newCities = [...cities()];
    newCities[index] = {
      id: newCities[index].id,
      ...cityData,
    };
    setCities(newCities);
    saveCities(newCities);
  };

  return (
    <>
      <div class="world-clock-widget" onContextMenu={handleContextMenu}>
        <div class="world-clock-widget__header">
          <span class="world-clock-widget__title">World Clock</span>
        </div>

        <div class="world-clock-widget__cities">
          <For each={cities()}>
            {(cityData, index) => {
              const timeData = () => times()[index()];

              return (
                <div class="world-clock-widget__city" classList={{ 'world-clock-widget__city--day': timeData()?.isDay }}>
                  <div class="world-clock-widget__time-row">
                    <div class="world-clock-widget__time" classList={{ 'world-clock-widget__time--day': timeData()?.isDay }}>
                      {timeData() ? formatTime(timeData()!.hours, timeData()!.minutes) : '--:--'}
                    </div>
                    <Show
                      when={timeData()?.isDay}
                      fallback={
                        <svg class="world-clock-widget__icon world-clock-widget__icon--night" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                        </svg>
                      }
                    >
                      <svg class="world-clock-widget__icon world-clock-widget__icon--day" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="12" r="5"></circle>
                        <rect x="11.4" y="2" width="1.2" height="3" rx="0.6"></rect>
                        <rect x="11.4" y="19" width="1.2" height="3" rx="0.6"></rect>
                        <rect x="4.2" y="4.2" width="1.2" height="3" rx="0.6" transform="rotate(45 4.8 5.7)"></rect>
                        <rect x="18.6" y="16.8" width="1.2" height="3" rx="0.6" transform="rotate(45 19.2 18.3)"></rect>
                        <rect x="2" y="11.4" width="3" height="1.2" rx="0.6"></rect>
                        <rect x="19" y="11.4" width="3" height="1.2" rx="0.6"></rect>
                        <rect x="4.2" y="16.8" width="1.2" height="3" rx="0.6" transform="rotate(-45 4.8 18.3)"></rect>
                        <rect x="18.6" y="4.2" width="1.2" height="3" rx="0.6" transform="rotate(-45 19.2 5.7)"></rect>
                      </svg>
                    </Show>
                  </div>

                  <div class="world-clock-widget__info">
                    <div class="world-clock-widget__city-name">{cityData.name}</div>
                    <div class="world-clock-widget__offset">{formatOffset(cityData.offset)}</div>
                  </div>
                </div>
              );
            }}
          </For>
        </div>

        <div class="world-clock-widget__footer" />
      </div>

      <Show when={isEditorOpen()}>
        <Portal enabled={true}>
          <div class="world-clock-editor__overlay"
            onClick={closeEditor}
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          />
          <div class="world-clock-editor"
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
            <div class="world-clock-editor__header">
              <span class="world-clock-editor__title">编辑城市</span>
              <button class="world-clock-editor__close" onClick={closeEditor}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>

            <div class="world-clock-editor__content">
              <div class="world-clock-editor__slots">
                <For each={cities()}>
                  {(cityData, index) => {
                    const idx = index();
                    return (
                      <div
                        classList={{
                          'world-clock-editor__slot': true,
                          'world-clock-editor__slot--active': editingSlotIndex() === idx,
                        }}
                        onClick={() => {
                          setEditingSlotIndex(idx);
                        }}
                      >
                        <div class="world-clock-editor__slot-name">
                          {idx + 1}. {cityData.name}
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>

              <div class="world-clock-editor__city-list"
                onWheel={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
              >
                <For each={AVAILABLE_CITIES}>
                  {(city) => (
                    <div
                      class="world-clock-editor__city"
                      onClick={() => {
                        handleCityChange(editingSlotIndex(), city.timezone);
                      }}
                    >
                      <span class="world-clock-editor__city-name">{city.name}</span>
                      <span class="world-clock-editor__city-timezone">{formatOffset(city.offset)}</span>
                    </div>
                  )}
                </For>
              </div>
            </div>
            <div class="world-clock-editor__footer">
              <span class="world-clock-editor__hint">选择槽位和城市，点击外部关闭</span>
            </div>
          </div>
        </Portal>
      </Show>

      <ContextMenuComponent />

      <style>{`
        /* Bloomberg Terminal Style */
        .world-clock-widget {
          background: #0D0E12;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: var(--radius-lg);
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          position: relative;
          overflow: hidden;
        }

        .world-clock-widget__header {
          display: flex;
          align-items: center;
          padding: 6px 10px 4px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }

        .world-clock-widget__title {
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: rgba(255, 255, 255, 0.4);
          font-weight: 700;
        }

        .world-clock-widget__cities {
          display: flex;
          flex: 1;
          align-items: stretch;
        }

        .world-clock-widget__city:not(:last-child) {
          position: relative;
        }

        .world-clock-widget__city:not(:last-child)::after {
          content: '';
          position: absolute;
          right: 0;
          top: 20%;
          height: 60%;
          width: 1px;
          background: rgba(255, 255, 255, 0.05);
        }

        .world-clock-widget__city {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 4px 2px;
          text-align: center;
          background: #080808;
        }

        .world-clock-widget__city--day {
          background: rgba(10, 17, 24, 0.5);
        }

        .world-clock-widget__time-row {
          display: flex;
          align-items: center;
          gap: 3px;
          margin-bottom: 4px;
        }

        .world-clock-widget__icon {
          width: 12px;
          height: 12px;
        }

        .world-clock-widget__icon--day {
          color: #FF9900;
          filter: drop-shadow(0 0 2px rgba(255, 153, 0, 0.4));
          animation: breathe 2s ease-in-out infinite;
        }

        .world-clock-widget__icon--night {
          color: #00A3FF;
          filter: drop-shadow(0 0 2px rgba(0, 163, 255, 0.4));
          animation: breathe 2s ease-in-out infinite;
        }

        @keyframes breathe {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.65;
            transform: scale(0.92);
          }
        }

        .world-clock-widget__time {
          font-size: 16px;
          font-weight: 700;
          color: #00A3FF;
          line-height: 1;
          letter-spacing: -0.5px;
        }

        .world-clock-widget__time--day {
          color: #FF9900;
        }

        .world-clock-widget__info {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }

        .world-clock-widget__city-name {
          font-size: 9px;
          font-weight: 600;
          color: #FFFFFF;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          line-height: 1;
        }

        .world-clock-widget__offset {
          font-size: 7px;
          color: rgba(255, 255, 255, 0.4);
          font-weight: 500;
        }

        .world-clock-widget__footer {
          height: 3px;
          background: #FF9900;
          opacity: 0.8;
        }

        /* Editor Styles */
        .world-clock-editor__overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(4px);
          z-index: 1000;
        }

        .world-clock-editor {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 320px;
          max-height: 480px;
          background: var(--bg-elevated);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: var(--radius-lg);
          z-index: 1001;
          display: flex;
          flex-direction: column;
          box-shadow: var(--shadow-subtle);
        }

        .world-clock-editor__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }

        .world-clock-editor__title {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .world-clock-editor__close {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          background: transparent;
          color: var(--text-secondary);
          cursor: pointer;
          border-radius: 4px;
          transition: background 0.15s ease;
        }

        .world-clock-editor__close:hover {
          background: rgba(255, 255, 255, 0.08);
        }

        .world-clock-editor__content {
          display: flex;
          flex: 1;
          overflow: hidden;
        }

        .world-clock-editor__slots {
          width: 120px;
          padding: 8px;
          border-right: 1px solid rgba(255, 255, 255, 0.06);
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .world-clock-editor__slot {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 10px;
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        .world-clock-editor__slot:hover {
          background: rgba(255, 255, 255, 0.04);
        }

        .world-clock-editor__slot--active {
          background: rgba(59, 130, 246, 0.15);
        }

        .world-clock-editor__slot-name {
          font-size: 11px;
          color: var(--text-secondary);
        }

        .world-clock-editor__slot--active .world-clock-editor__slot-name {
          color: var(--blue-main);
        }

        .world-clock-editor__slot-arrow {
          width: 14px;
          height: 14px;
          color: var(--text-tertiary);
        }

        .world-clock-editor__city-list {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
        }

        .world-clock-editor__city {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        .world-clock-editor__city:hover {
          background: rgba(255, 255, 255, 0.04);
        }

        .world-clock-editor__city--selected {
          background: rgba(59, 130, 246, 0.15);
        }

        .world-clock-editor__city-name {
          font-size: 12px;
          color: var(--text-primary);
        }

        .world-clock-editor__city--selected .world-clock-editor__city-name {
          color: var(--blue-main);
        }

        .world-clock-editor__city-timezone {
          font-size: 10px;
          color: var(--text-tertiary);
        }

        .world-clock-editor__city-list::-webkit-scrollbar {
          width: 4px;
        }

        .world-clock-editor__city-list::-webkit-scrollbar-track {
          background: transparent;
        }

        .world-clock-editor__city-list::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.15);
          border-radius: 2px;
        }

        .world-clock-editor__footer {
          padding: 10px 16px;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          text-align: center;
        }

        .world-clock-editor__hint {
          font-size: 10px;
          color: var(--text-tertiary);
        }
      `}</style>
    </>
  );
};
