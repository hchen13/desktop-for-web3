/**
 * 扩展 popup —— 把当前 tab 添加为图标到选定桌面
 *
 * 设计：
 *  - 读取当前活动 tab（chrome.tabs.query）
 *  - 读取桌面列表（chrome.storage.local 的 'gridLayouts'）
 *  - 用户点击某桌面 → 写一条记录到 'pendingIconAdds' 队列
 *  - newtab 监听 storage 变化 / 启动时消费队列，调 addElement 自动找位置
 *
 * Popup 不直接调 addElement，因为 popup 没有 grid 上下文（viewport 尺寸来自 popup 自己）。
 */
import { render } from 'solid-js/web';
import { createSignal, createEffect, onMount, For, Show } from 'solid-js';
import './popup.css';

interface DesktopLayout {
  id: string;
  name: string;
  elements: Array<{ id: string; type: string; data?: { name?: string; url?: string } }>;
}

interface CurrentPage {
  url: string;
  title: string;
  favIconUrl: string | null;
}

interface PendingIconAdd {
  targetLayoutId: string;
  icon: {
    name: string;
    url: string;
    category: string;
  };
  enqueuedAt: number;
}

const STORAGE_LAYOUTS_KEY = 'gridLayouts';
const STORAGE_PENDING_KEY = 'pendingIconAdds';

function deriveCategory(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (
      /binance|coinbase|okx|bybit|bitget|kraken|kucoin|gate|huobi|htx|mexc|crypto\.com|gemini|bitfinex|bitmart|bingx|deribit|upbit/.test(
        host,
      )
    )
      return 'cex';
    if (
      /uniswap|sushi|pancakeswap|curve|1inch|raydium|jupiter|aerodrome|dydx|gmx|hyperliquid|aevo|lighter/.test(
        host,
      )
    )
      return 'dex';
    if (
      /etherscan|solscan|blockchain|polygonscan|arbiscan|bscscan|basescan|optimistic\.etherscan|tronscan/.test(
        host,
      )
    )
      return 'explorer';
    if (/metamask|phantom|rabby|trust|coinbase-wallet|onekey/.test(host)) return 'wallet';
    if (/ondo|maple|paxos|backed|hashnote|securitize|rwa\.xyz/.test(host)) return 'rwa';
    if (
      /coindesk|cointelegraph|theblock|decrypt|odaily|panews|blockbeats|foresight|cryptopanic|followin/.test(
        host,
      )
    )
      return 'crypto-news';
    return 'tools';
  } catch {
    return 'tools';
  }
}

function getCurrentTab(): Promise<CurrentPage | null> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
      resolve(null);
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      if (!tab || !tab.url) {
        resolve(null);
        return;
      }
      // 不允许添加 chrome:// 等系统页面
      if (/^chrome(?:-extension)?:|^edge:|^about:/.test(tab.url)) {
        resolve({ url: tab.url, title: tab.title || tab.url, favIconUrl: null });
        return;
      }
      resolve({
        url: tab.url,
        title: tab.title || new URL(tab.url).hostname,
        favIconUrl: tab.favIconUrl || null,
      });
    });
  });
}

function getLayouts(): Promise<DesktopLayout[]> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve([]);
      return;
    }
    chrome.storage.local.get(STORAGE_LAYOUTS_KEY, (result) => {
      if (chrome.runtime.lastError) {
        console.error('[Popup] storage error', chrome.runtime.lastError);
        resolve([]);
        return;
      }
      resolve(Array.isArray(result?.[STORAGE_LAYOUTS_KEY]) ? result[STORAGE_LAYOUTS_KEY] : []);
    });
  });
}

function enqueueIconAdd(entry: PendingIconAdd): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve(false);
      return;
    }
    chrome.storage.local.get(STORAGE_PENDING_KEY, (result) => {
      const existing: PendingIconAdd[] = Array.isArray(result?.[STORAGE_PENDING_KEY])
        ? result[STORAGE_PENDING_KEY]
        : [];
      const next = [...existing, entry];
      chrome.storage.local.set({ [STORAGE_PENDING_KEY]: next }, () => {
        if (chrome.runtime.lastError) {
          console.error('[Popup] enqueue failed', chrome.runtime.lastError);
          resolve(false);
          return;
        }
        resolve(true);
      });
    });
  });
}

function isSystemUrl(url: string): boolean {
  return /^chrome(?:-extension)?:|^edge:|^about:/.test(url);
}

function PopupApp() {
  const [page, setPage] = createSignal<CurrentPage | null>(null);
  const [layouts, setLayouts] = createSignal<DesktopLayout[]>([]);
  const [status, setStatus] = createSignal<{
    kind: 'loading' | 'success' | 'error' | null;
    text: string;
  }>({
    kind: 'loading',
    text: '加载中…',
  });

  onMount(async () => {
    const [tab, ls] = await Promise.all([getCurrentTab(), getLayouts()]);
    setPage(tab);
    setLayouts(ls);
    if (!tab) {
      setStatus({ kind: 'error', text: '无法读取当前页面' });
    } else if (isSystemUrl(tab.url)) {
      setStatus({ kind: 'error', text: '无法添加 chrome:// / 扩展页面' });
    } else if (ls.length === 0) {
      setStatus({ kind: 'error', text: '尚未初始化桌面，请先打开新标签页一次' });
    } else {
      setStatus({ kind: null, text: '' });
    }
  });

  const handleAdd = async (layoutId: string) => {
    const p = page();
    if (!p || isSystemUrl(p.url)) return;

    setStatus({ kind: 'loading', text: '添加中…' });
    const ok = await enqueueIconAdd({
      targetLayoutId: layoutId,
      icon: {
        name: p.title.length > 30 ? p.title.slice(0, 30) + '…' : p.title,
        url: p.url,
        category: deriveCategory(p.url),
      },
      enqueuedAt: Date.now(),
    });

    if (ok) {
      setStatus({ kind: 'success', text: '✓ 已加入队列，下次打开桌面或当前桌面会自动出现' });
      // 给用户看一眼提示再关
      setTimeout(() => window.close(), 900);
    } else {
      setStatus({ kind: 'error', text: '添加失败，请重试' });
    }
  };

  const canAdd = () => {
    const p = page();
    return !!p && !isSystemUrl(p.url) && layouts().length > 0;
  };

  return (
    <>
      <header class="popup-header">
        <span class="popup-header__title">添加到桌面</span>
      </header>

      <Show when={page()} fallback={<div class="popup-empty">无当前页面</div>}>
        {(p) => (
          <div class="popup-page-card">
            <Show when={p().favIconUrl} fallback={<div class="popup-page-card__favicon" />}>
              <img
                class="popup-page-card__favicon"
                src={p().favIconUrl!}
                alt=""
                onError={(e) => ((e.currentTarget as HTMLImageElement).style.opacity = '0')}
              />
            </Show>
            <div class="popup-page-card__info">
              <span class="popup-page-card__title">{p().title}</span>
              <span class="popup-page-card__url">{p().url}</span>
            </div>
          </div>
        )}
      </Show>

      <Show when={canAdd()}>
        <div class="popup-section-label">选择目标桌面</div>
        <div class="popup-desktop-list">
          <For each={layouts()}>
            {(l) => (
              <button
                type="button"
                class="popup-desktop-item"
                onClick={() => handleAdd(l.id)}
                disabled={status().kind === 'loading'}
              >
                <span class="popup-desktop-item__name">{l.name}</span>
                <span class="popup-desktop-item__count">{l.elements.length} 项</span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={status().kind}>
        <div
          class="popup-status"
          classList={{
            'popup-status--loading': status().kind === 'loading',
            'popup-status--success': status().kind === 'success',
            'popup-status--error': status().kind === 'error',
          }}
        >
          {status().text}
        </div>
      </Show>
    </>
  );
}

const root = document.getElementById('popup-root');
if (root) {
  render(() => <PopupApp />, root);
}
