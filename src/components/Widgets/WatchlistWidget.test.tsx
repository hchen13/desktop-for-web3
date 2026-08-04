import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { WatchlistWidget } from './WatchlistWidget';
import { exchangeCatalog } from '../../services/prices/exchangeCatalog';
import { priceService } from '../../services/prices/PriceService';

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));
});

afterEach(() => {
  cleanup();
  priceService.__resetForTest();
  exchangeCatalog.__resetForTest();
  vi.restoreAllMocks();
});

describe('编辑对话框生命周期', () => {
  it('关闭对话框后实例被销毁，catalog 监听随之解绑', () => {
    const unsubscribe = vi.fn();
    vi.spyOn(exchangeCatalog, 'onUpdate').mockReturnValue(unsubscribe);
    vi.spyOn(exchangeCatalog, 'ensureFresh').mockResolvedValue();

    const { container } = render(() => <WatchlistWidget />);
    // PriceService 自己也会订阅 catalog，这里只关心弹窗多注册的那一个
    const before = vi.mocked(exchangeCatalog.onUpdate).mock.calls.length;

    const name = container.querySelector('.price-item__main--clickable') as HTMLElement;
    name.click();
    expect(vi.mocked(exchangeCatalog.onUpdate).mock.calls.length - before).toBe(1);
    expect(unsubscribe).not.toHaveBeenCalled();

    const close = document.querySelector('.watchlist-edit-dialog__close') as HTMLElement;
    close.click();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
