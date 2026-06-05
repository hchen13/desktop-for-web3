import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import {
  fetchBtcRealizedPrice,
  type BtcRealizedPriceSnapshot,
} from '../../services/btc-realized-price';
import './BtcRealizedPriceWidget.css';

type WidgetStatus = 'syncing' | 'live' | 'cached' | 'error';

const REFRESH_INTERVAL_MS = 60 * 1000;

const formatCompactUsd = (value: number): string => {
  if (value >= 1000) return `$${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}K`;
  return `$${value.toFixed(0)}`;
};

const formatChange = (value: number | null): string => {
  if (value === null) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

const formatDate = (date: string): string => {
  const [, month, day] = date.split('-');
  return month && day ? `${month}/${day}` : date;
};

export const BtcRealizedPriceWidget = () => {
  const [snapshot, setSnapshot] = createSignal<BtcRealizedPriceSnapshot | null>(null);
  const [status, setStatus] = createSignal<WidgetStatus>('syncing');
  let refreshTimer: ReturnType<typeof setInterval> | undefined;

  const load = async () => {
    if (!snapshot()) setStatus('syncing');

    try {
      const next = await fetchBtcRealizedPrice();
      setSnapshot(next);
      setStatus(next.stale ? 'cached' : 'live');
    } catch {
      setStatus('error');
    }
  };

  const changeClass = createMemo(() => {
    const change = snapshot()?.change24hPct;
    if (change === null || change === undefined || change === 0) return 'flat';
    return change > 0 ? 'up' : 'down';
  });

  const statusText = createMemo(() => {
    switch (status()) {
      case 'syncing':
        return 'SYNC';
      case 'cached':
        return 'CACHE';
      case 'error':
        return 'ERR';
      default:
        return 'LIVE';
    }
  });

  onMount(() => {
    void load();
    refreshTimer = setInterval(() => {
      void load();
    }, REFRESH_INTERVAL_MS);
  });

  onCleanup(() => {
    if (refreshTimer) clearInterval(refreshTimer);
  });

  return (
    <div class="btc-realized">
      <div class="btc-realized__header">
        <div>
          <div class="btc-realized__asset">BTC</div>
          <div class="btc-realized__label">REALIZED</div>
        </div>
        <span
          classList={{
            'btc-realized__status': true,
            'btc-realized__status--syncing': status() === 'syncing',
            'btc-realized__status--error': status() === 'error',
            'btc-realized__status--cached': status() === 'cached',
          }}
        >
          {statusText()}
        </span>
      </div>

      <Show
        when={snapshot()}
        fallback={
          <div class="btc-realized__empty">
            <div class="btc-realized__value">--</div>
            <div class="btc-realized__change">-- 24H</div>
          </div>
        }
      >
        {(data) => (
          <>
            <div class="btc-realized__value">{formatCompactUsd(data().realizedPrice)}</div>
            <div class={`btc-realized__change btc-realized__change--${changeClass()}`}>
              {formatChange(data().change24hPct)} 24H
            </div>
            <div class="btc-realized__footer">
              <span>{formatDate(data().latestDate)}</span>
              <span>{data().source}</span>
            </div>
          </>
        )}
      </Show>
    </div>
  );
};

export default BtcRealizedPriceWidget;
