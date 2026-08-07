import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { EconMapWidget } from './EconMap2Widget';
import {
  fetchEconMap2Data,
  type EconMap2Metric,
  type EconMap2DataSet,
} from '../../services/econMap2Service';

vi.mock('../../services/econMap2Service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/econMap2Service')>();
  return { ...actual, fetchEconMap2Data: vi.fn() };
});

const fetchMock = vi.mocked(fetchEconMap2Data);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function dataSet(metric: EconMap2Metric, iso3s: string[], value: number): EconMap2DataSet {
  return {
    metric,
    data: new Map(iso3s.map((iso3) => [iso3, { iso3, value, year: 2026 }])),
    lastUpdated: Date.now(),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const coloredCountries = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.econ-map2-widget__country')).filter(
    (path) => path.getAttribute('fill') !== 'var(--econ-map2-nodata)',
  ).length;

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

describe('EconMap2Widget metric 切换竞态', () => {
  it('先发出的慢响应不会覆盖后发出的快响应', async () => {
    const slowGdp = deferred<EconMap2DataSet>();
    const fastInflation = deferred<EconMap2DataSet>();
    fetchMock.mockReturnValueOnce(slowGdp.promise).mockReturnValueOnce(fastInflation.promise);

    const { container } = render(() => <EconMapWidget />);

    const inflationTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.econ-map2-widget__tab'),
    ).find((tab) => tab.textContent === 'INFL')!;
    inflationTab.click();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fastInflation.resolve(dataSet('iryy', ['USA', 'CHN', 'BRA', 'RUS', 'IND'], 12));
    await flush();
    expect(coloredCountries(container)).toBeGreaterThan(0);

    slowGdp.resolve(dataSet('gdp', [], 0));
    await flush();
    expect(coloredCountries(container)).toBeGreaterThan(0);
  });
});
