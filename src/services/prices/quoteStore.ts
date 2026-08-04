/**
 * 逐 instrument 的最新报价存储
 *
 * 每个 (venue, instrumentId) 的 sourceTimestamp 必须单调：迟到的旧 REST/WS 数据
 * 不能覆盖更新的数据。
 */

import type { AssetKey, VenueQuote } from './types';

function instrumentKey(quote: VenueQuote): string {
  return `${quote.venue}|${quote.instrumentId}`;
}

export class QuoteStore {
  private byInstrument = new Map<string, VenueQuote>();
  private instrumentsByAsset = new Map<AssetKey, Set<string>>();

  /** 返回 true 表示被接受；false 表示时间戳倒退已被拒绝 */
  ingest(quote: VenueQuote): boolean {
    const key = instrumentKey(quote);
    const existing = this.byInstrument.get(key);
    if (existing && quote.sourceTimestamp < existing.sourceTimestamp) return false;

    this.byInstrument.set(key, quote);
    const set = this.instrumentsByAsset.get(quote.assetKey);
    if (set) set.add(key);
    else this.instrumentsByAsset.set(quote.assetKey, new Set([key]));
    return true;
  }

  quotesFor(assetKey: AssetKey): VenueQuote[] {
    const keys = this.instrumentsByAsset.get(assetKey);
    if (!keys) return [];
    const out: VenueQuote[] = [];
    for (const key of keys) {
      const quote = this.byInstrument.get(key);
      if (quote) out.push(quote);
    }
    return out;
  }

  /** 按条件丢弃某个资产的部分报价（例如换层之后清掉旧层的残留） */
  dropWhere(assetKey: AssetKey, predicate: (quote: VenueQuote) => boolean): void {
    const keys = this.instrumentsByAsset.get(assetKey);
    if (!keys) return;
    for (const key of Array.from(keys)) {
      const quote = this.byInstrument.get(key);
      if (quote && predicate(quote)) {
        this.byInstrument.delete(key);
        keys.delete(key);
      }
    }
    if (keys.size === 0) this.instrumentsByAsset.delete(assetKey);
  }

  /** 资产被移出订阅时释放它的报价，避免长时间留存过期数据 */
  dropAsset(assetKey: AssetKey): void {
    const keys = this.instrumentsByAsset.get(assetKey);
    if (!keys) return;
    for (const key of keys) this.byInstrument.delete(key);
    this.instrumentsByAsset.delete(assetKey);
  }

  clear(): void {
    this.byInstrument.clear();
    this.instrumentsByAsset.clear();
  }

  size(): number {
    return this.byInstrument.size;
  }
}
