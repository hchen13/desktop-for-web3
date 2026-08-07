import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { NewsWidget } from './NewsWidget';
import { rssService } from '../../services/rssService';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('NewsWidget 打开外链', () => {
  it('window.open 带上 noopener,noreferrer，不把 opener 交给第三方代理转发的链接', () => {
    vi.spyOn(rssService, 'subscribe').mockImplementation((cb) => {
      cb({
        status: 'live',
        lastSync: Date.now(),
        items: [
          {
            guid: 'g1',
            title: '标题',
            link: 'https://evil.example/post',
            pubDate: new Date().toISOString(),
            description: '',
            source: 'BlockBeats',
            category: 'news',
            combinedTag: 'news',
          },
        ],
      });
      return () => {};
    });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    const { container } = render(() => <NewsWidget />);
    container.querySelector<HTMLElement>('.news-item')!.click();

    expect(openSpy).toHaveBeenCalledWith(
      'https://evil.example/post',
      '_blank',
      'noopener,noreferrer',
    );
  });
});
