import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { GridIcon } from './GridIcon';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('GridIcon 打开书签', () => {
  it('window.open 带上 noopener,noreferrer', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    const { container } = render(() => (
      <GridIcon url="https://example.com/dashboard" name="Example" />
    ));
    container.querySelector<HTMLElement>('.grid-icon')!.click();

    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com/dashboard',
      '_blank',
      'noopener,noreferrer',
    );
  });
});
