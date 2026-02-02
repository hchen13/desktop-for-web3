/**
 * News Widget - Web3 资讯组件
 * 显示最新的 Web3 资讯和动态
 * 风格: Bloomberg Terminal × Modern Web3
 */

import { For, Show, onCleanup, onMount, createSignal } from 'solid-js';
import { rssService, type RSSDataState } from '../../services/rssService';
import { DragSystem } from '../../events/DragSystem';

type NewsTag = 'news' | 'newsflash' | 'article' | 'policy' | 'markets' | 'tech' | 'defi';

const NEWS_TAG_CONFIG: Record<NewsTag, { label: string }> = {
  news: { label: 'NEWS' },
  newsflash: { label: 'FLASH' },
  article: { label: 'ARTICLE' },
  policy: { label: 'POLICY' },
  markets: { label: 'MARKETS' },
  tech: { label: 'TECH' },
  defi: { label: 'DEFI' },
};

const getTagConfig = (tag: string): { label: string } => {
  const normalizedTag = tag.toLowerCase() as NewsTag;
  return NEWS_TAG_CONFIG[normalizedTag] || { label: tag.toUpperCase() };
};

const formatTime = (isoDate: string, currentTime: number): string => {
  const date = new Date(isoDate);
  const diff = currentTime - date.getTime();

  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;

  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
};

// 图标组件 - 使用函数返回新的 JSX，避免 SolidJS 复用同一个 DOM 节点
const RssIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 11a9 9 0 0 1 9 9" />
    <path d="M4 4a16 16 0 0 1 16 16" />
    <circle cx="5" cy="19" r="1" />
  </svg>
);

const SyncingIndicator = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" class="news-widget__sync-spin">
    <path
      d="M12 2C6.477 2 2 6.477 2 12C2 17.523 6.477 22 12 22C17.523 22 22 17.523 22 12"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
    />
  </svg>
);

const LiveDot = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <circle cx="6" cy="6" r="4" fill="currentColor" class="news-widget__live-pulse" />
  </svg>
);

import type { WidgetState } from '../../config/widgetDefaults';

const SKELETON_ITEMS = Array.from({ length: 5 }, (_, i) => `skeleton-${i}`);

/** Widget 组件接收的 props（由 GridContainer 传入） */
interface NewsWidgetProps {
  elementId?: string;
  state?: WidgetState;
  onStateChange?: (newState: WidgetState) => void;
}

export const NewsWidget = (props: NewsWidgetProps) => {
  const [state, setState] = createSignal<RSSDataState>({
    status: 'syncing',
    items: [],
    lastSync: 0,
  });
  const [now, setNow] = createSignal(Date.now());

  let unsubscribe: (() => void) | null = null;
  let timeUpdateTimer: number | null = null;

  onMount(() => {
    unsubscribe = rssService.subscribe((newState) => {
      setState(newState);
    });

    timeUpdateTimer = window.setInterval(() => {
      setNow(Date.now());
    }, 30000);
  });

  onCleanup(() => {
    unsubscribe?.();
    if (timeUpdateTimer !== null) {
      clearInterval(timeUpdateTimer);
    }
  });

  const handleItemClick = (link: string) => {
    // 如果刚刚完成拖拽，忽略点击事件
    if (DragSystem.justFinishedDrag()) {
      return;
    }
    window.open(link, '_blank');
  };

  return (
    <div class="news-widget">
      <header class="news-widget__header">
        <div class="news-widget__header-left">
          <span class="news-widget__icon"><RssIcon /></span>
          <h2 class="news-widget__title">Web3 资讯</h2>
        </div>
        <Show
          when={state().status === 'syncing'}
          fallback={
            <div class="news-widget__status-pill news-widget__status-pill--live" aria-label="实时更新">
              <span class="news-widget__status-icon news-widget__status-icon--live"><LiveDot /></span>
              <span class="news-widget__status-text">LIVE</span>
            </div>
          }
        >
          <div class="news-widget__status-pill" aria-label="同步中">
            <span class="news-widget__status-icon"><SyncingIndicator /></span>
            <span class="news-widget__status-text">SYNCING</span>
          </div>
        </Show>
      </header>

      <div class="news-widget__content">
        <Show
          when={state().items.length > 0}
          fallback={
            <div class="news-widget__skeleton">
              <For each={SKELETON_ITEMS}>
                {() => (
                  <div class="news-item-skeleton">
                    <div class="news-item-skeleton__meta" />
                    <div class="news-item-skeleton__title" />
                    <div class="news-item-skeleton__source" />
                  </div>
                )}
              </For>
            </div>
          }
        >
          <div class="news-widget__list">
            <For each={state().items}>
              {(item, index) => {
                const tagConfig = getTagConfig(item.combinedTag);
                return (
                  <>
                    <div
                      class="news-item"
                      onClick={() => handleItemClick(item.link)}
                    >
                      <div class="news-item__meta">
                        <span class="news-item__category">{tagConfig.label}</span>
                      </div>
                      <h3 class="news-item__title">{item.title}</h3>
                      <div class="news-item__footer">
                        <span class="news-item__source">{item.source}</span>
                        <span class="news-item__time">{formatTime(item.pubDate, now())}</span>
                      </div>
                    </div>
                    <Show when={index() < state().items.length - 1}>
                      <div class="news-item__divider" />
                    </Show>
                  </>
                );
              }}
            </For>
          </div>
        </Show>
      </div>

      <div class="news-widget__gradient-overlay" />

      <style>{`
        .news-widget {
          background: transparent;
          border: none;
          border-radius: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          width: 100%;
          height: 100%;
          position: relative;
        }

        /* Header - 更紧凑 */
        .news-widget__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(0, 0, 0, 0.4);
          flex-shrink: 0;
          min-height: 32px;
        }

        .news-widget__header-left {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .news-widget__icon {
          color: #FF9900;
          display: flex;
          align-items: center;
        }

        .news-widget__icon svg {
          width: 16px;
          height: 16px;
        }

        .news-widget__title {
          font-size: 12px;
          font-weight: 700;
          color: #FFFFFF;
          letter-spacing: 0.3px;
          margin: 0;
        }

        /* 状态指示器 - SYNCING 胶囊 */
        .news-widget__status-pill {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          background: rgba(255, 153, 0, 0.1);
          border: 1px solid rgba(255, 153, 0, 0.2);
          border-radius: 999px;
          min-width: 68px;
          justify-content: center;
        }

        /* LIVE 状态 - 绿色呼吸闪烁 */
        .news-widget__status-pill--live {
          background: rgba(0, 255, 136, 0.1);
          border-color: rgba(0, 255, 136, 0.2);
        }

        .news-widget__status-icon {
          color: #FF9900;
          display: flex;
          width: 12px;
          height: 12px;
          flex-shrink: 0;
        }

        .news-widget__status-icon--live {
          color: #00FF88;
        }

        .news-widget__status-text {
          font-size: 9px;
          font-weight: 700;
          color: #FF9900;
          letter-spacing: 0.05em;
        }

        .news-widget__status-pill--live .news-widget__status-text {
          color: #00FF88;
        }

        .news-widget__sync-spin {
          animation: syncSpin 2s linear infinite;
        }

        @keyframes syncSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        /* LIVE 呼吸闪烁 */
        .news-widget__live-pulse {
          animation: livePulse 2s ease-in-out infinite;
        }

        @keyframes livePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        /* 内容区域 */
        .news-widget__content {
          flex: 1;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .news-widget__list {
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          flex: 1;
          min-height: 0;
          -ms-overflow-style: none;
          scrollbar-width: none;
        }

        .news-widget__list::-webkit-scrollbar {
          display: none;
        }

        /* 新闻条目 - 更紧凑 */
        .news-item {
          display: flex;
          flex-direction: column;
          padding: 8px 12px;
          cursor: pointer;
          transition: background 0.15s ease;
          position: relative;
        }

        /* 悬停效果: 背景提亮 + 左侧橙色竖线 */
        .news-item:hover {
          background: rgba(255, 255, 255, 0.05);
        }

        .news-item:hover::before {
          content: '';
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 2px;
          background-color: #FF9900;
        }

        .news-item__meta {
          display: flex;
          gap: 6px;
          margin-bottom: 4px;
        }

        /* 分类标签 - 胶囊形状 */
        .news-item__category {
          display: inline-flex;
          align-items: center;
          height: 14px;
          padding: 0 8px;
          background: #FF9900;
          color: #000000;
          font-size: 8px;
          font-weight: 800;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          border-radius: 999px;
          line-height: 1;
        }

        /* 标题 - 稍小更紧凑 */
        .news-item__title {
          font-size: 12px;
          font-weight: 700;
          line-height: 1.3;
          color: #FFFFFF;
          margin: 0 0 4px 0;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .news-item__footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }

        /* 来源 - 保持较小 */
        .news-item__source {
          font-size: 9px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.4);
          text-transform: uppercase;
          letter-spacing: 0.2px;
        }

        /* 时间 - 增大字号 */
        .news-item__time {
          font-size: 11px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.5);
          letter-spacing: 0.2px;
        }

        /* 分割线 - 极细 */
        .news-item__divider {
          height: 1px;
          background: rgba(255, 255, 255, 0.05);
          margin: 0 12px;
        }

        /* 顶部渐变叠加层 */
        .news-widget__gradient-overlay {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            linear-gradient(to bottom, rgba(255, 255, 255, 0.03), transparent 60px),
            linear-gradient(to top, rgba(0, 0, 0, 0.55), transparent 70px);
          height: 100%;
          width: 100%;
        }

        /* 骨架屏 - 更紧凑 */
        .news-widget__skeleton {
          display: flex;
          flex-direction: column;
        }

        .news-item-skeleton {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 8px 12px;
        }

        .news-item-skeleton__meta {
          width: 40px;
          height: 14px;
          background: linear-gradient(90deg, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.06) 75%);
          background-size: 200% 100%;
          border-radius: 999px;
          animation: shimmer 1.5s infinite;
        }

        .news-item-skeleton__title {
          width: 100%;
          height: 30px;
          background: linear-gradient(90deg, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.06) 75%);
          background-size: 200% 100%;
          border-radius: 4px;
          animation: shimmer 1.5s infinite;
          animation-delay: 0.1s;
        }

        .news-item-skeleton__source {
          width: 60px;
          height: 10px;
          background: linear-gradient(90deg, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.06) 75%);
          background-size: 200% 100%;
          border-radius: 4px;
          animation: shimmer 1.5s infinite;
          animation-delay: 0.2s;
        }

        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
};
