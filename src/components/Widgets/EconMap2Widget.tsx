/**
 * EconMap2 Widget - 本地实现，使用 IMF DataMapper API
 */

import { createMemo, createSignal, createEffect, Show, For } from 'solid-js';
import { feature } from 'topojson-client';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import worldAtlas from 'world-atlas/countries-110m.json';
import {
  ECON_MAP2_METRICS,
  ECON_MAP2_METRIC_NAMES,
  fetchEconMap2Data,
  getEconMap2Color,
  numericToAlpha3,
  formatEconValue,
  type EconMap2Metric,
  type EconMap2DataSet,
} from '../../services/econMap2Service';
import './EconMap2Widget.css';

const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 520;

type CountryFeature = {
  id?: string;
  properties?: { name?: string };
};

type TopoJSONCountries = {
  type: string;
  features: CountryFeature[];
};

const countriesGeoJson = (() => {
  const countries = feature(
    worldAtlas as unknown as { objects: { countries: unknown } },
    (worldAtlas as unknown as { objects: { countries: unknown } }).objects.countries,
  ) as unknown as TopoJSONCountries;

  return {
    ...countries,
    features: countries.features.filter((f) => f.properties?.name !== 'Antarctica'),
  };
})();

const countryNamesById = new Map<string, string>();
for (const f of countriesGeoJson.features) {
  if (f.id && f.properties?.name) {
    countryNamesById.set(f.id, f.properties.name);
  }
}

const projection = geoNaturalEarth1().fitSize(
  [VIEWBOX_WIDTH, VIEWBOX_HEIGHT],
  countriesGeoJson as unknown as object,
);
const pathGenerator = geoPath(projection);

import type { WidgetState } from '../../config/widgetDefaults';

/** Widget 组件接收的 props（由 GridContainer 传入） */
interface EconMapWidgetProps {
  elementId?: string;
  state?: WidgetState;
  onStateChange?: (newState: WidgetState) => void;
}

export const EconMapWidget = (props: EconMapWidgetProps) => {
  const METRIC_TAB_LABELS: Record<EconMap2Metric, string> = {
    gdp: 'GDP',
    ur: 'UNEMPLOY',
    gdg: 'DEBT',
    intr: 'INTR',
    iryy: 'INFL',
  };
  const METRIC_TOOLTIP_LABELS: Record<EconMap2Metric, string> = {
    gdp: 'GDP',
    ur: 'Unemployment',
    gdg: 'Govt Debt/GDP',
    intr: 'Interest Rate',
    iryy: 'Inflation',
  };
  const [metric, setMetric] = createSignal<EconMap2Metric>('gdp');
  const [dataSet, setDataSet] = createSignal<EconMap2DataSet | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  const [hover, setHover] = createSignal<{ name: string; value: number | null; x: number; y: number } | null>(null);
  let mapWrapperRef: HTMLDivElement | undefined;

  createEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    fetchEconMap2Data(metric())
      .then((data) => {
        if (cancelled) return;
        setDataSet(data);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  });

  const getCountryValue = (numericId: string | number): number | null => {
    // TopoJSON IDs are strings, convert to number for lookup
    const numId = typeof numericId === 'string' ? parseInt(numericId, 10) : numericId;
    if (isNaN(numId)) return null;
    const iso3 = numericToAlpha3(numId);
    if (!iso3) return null;
    const data = dataSet();
    return data?.data.get(iso3)?.value ?? null;
  };

  const handleMetricSelect = (newMetric: EconMap2Metric) => {
    setMetric(newMetric);
  };

  const handlePointerEnter = (e: PointerEvent, name: string, value: number | null) => {
    if (!mapWrapperRef) return;
    const wrapperRect = mapWrapperRef.getBoundingClientRect();
    const x = e.clientX - wrapperRect.left;
    const y = e.clientY - wrapperRect.top;
    setHover({ name, value, x, y });
  };

  // Calculate tooltip position to avoid clipping at edges
  const getTooltipStyle = () => {
    const h = hover();
    if (!h || !mapWrapperRef) return {};
    
    const wrapperWidth = mapWrapperRef.clientWidth;
    const wrapperHeight = mapWrapperRef.clientHeight;
    const tooltipWidth = 120; // Approximate tooltip width
    const tooltipHeight = 50; // Approximate tooltip height
    const offset = 12;
    
    let left = h.x + offset;
    let top = h.y + offset;
    
    // Flip to left if near right edge
    if (left + tooltipWidth > wrapperWidth) {
      left = h.x - tooltipWidth - offset;
    }
    
    // Flip to top if near bottom edge
    if (top + tooltipHeight > wrapperHeight) {
      top = h.y - tooltipHeight - offset;
    }
    
    // Ensure tooltip doesn't go negative
    left = Math.max(4, left);
    top = Math.max(4, top);
    
    return {
      left: `${left}px`,
      top: `${top}px`,
    };
  };

  return (
    <div class="econ-map2-widget">
      <div class="econ-map2-widget__header">
        <div class="econ-map2-widget__tabs" role="tablist">
          <For each={ECON_MAP2_METRICS}>
            {(item) => (
              <button
                type="button"
                class={`econ-map2-widget__tab ${metric() === item ? 'is-active' : ''}`}
                role="tab"
                aria-selected={metric() === item}
                onClick={() => handleMetricSelect(item)}
                title={ECON_MAP2_METRIC_NAMES[item]}
              >
                {METRIC_TAB_LABELS[item]}
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="econ-map2-widget__map-wrapper" ref={mapWrapperRef}>
        <svg
          class="econ-map2-widget__map"
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          role="img"
          aria-label="Economic map"
        >
          <For each={countriesGeoJson.features}>
            {(featureItem) => {
              const id = featureItem.id;
              const countryName = id ? countryNamesById.get(id) : undefined;
              if (!countryName || !id) return null;
              const path = pathGenerator(featureItem as any);
              if (!path) return null;
              
              // Make fill reactive by wrapping in a function that accesses dataSet() and metric()
              const getFill = () => {
                const value = getCountryValue(id);
                const currentMetric = metric(); // Access reactive to trigger updates
                if (value === null || Number.isNaN(value) || value === 0) {
                  return 'var(--econ-map2-nodata)';
                }
                return getEconMap2Color(currentMetric, value) ?? 'var(--econ-map2-nodata)';
              };
              
              return (
                <path
                  d={path}
                  fill={getFill()}
                  class="econ-map2-widget__country"
                  onPointerEnter={(e) => handlePointerEnter(e, countryName, getCountryValue(id))}
                  onPointerLeave={() => setHover(null)}
                />
              );
            }}
          </For>
        </svg>

        <Show when={hover()}>
          {(item) => (
            <div
              class="econ-map2-widget__tooltip"
              style={getTooltipStyle()}
            >
              <div class="econ-map2-widget__tooltip-name">{item().name}</div>
              <div class="econ-map2-widget__tooltip-metric">
                {METRIC_TOOLTIP_LABELS[metric()]}
              </div>
              <div class="econ-map2-widget__tooltip-value">
                {formatEconValue(metric(), item().value)}
              </div>
            </div>
          )}
        </Show>
      </div>

      <Show when={isLoading()}>
        <div class="econ-map2-widget__loading">
          <div class="econ-map2-widget__loading-spinner" />
        </div>
      </Show>
    </div>
  );
};
