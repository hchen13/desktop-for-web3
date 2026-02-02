# Copilot instructions

## Project overview
- Chrome Extension (MV3) new-tab app built with SolidJS + Vite + @crxjs/vite-plugin. Entry points are [src/newtab/index.tsx](src/newtab/index.tsx) and [src/newtab/App.tsx](src/newtab/App.tsx).
- Layout is a grid-based “desktop” system. Core layout logic lives in [src/grid/GridContainer.tsx](src/grid/GridContainer.tsx), state in [src/grid/store.ts](src/grid/store.ts), and coordinate math in [src/grid/utils.ts](src/grid/utils.ts). Grid constants are defined in [src/grid/types.ts](src/grid/types.ts).
- Mouse/drag behaviors are centralized in the event system: `EventOrchestrator` and `DragSystem` in [src/events/EventOrchestrator.ts](src/events/EventOrchestrator.ts) and [src/events/DragSystem.ts](src/events/DragSystem.ts). Drag uses BFS push-out rules and respects fixed elements.
- Widgets live under [src/components/Widgets](src/components/Widgets) and are exported via [src/components/Widgets/index.ts](src/components/Widgets/index.ts). Layout presets are in [src/config/defaultLayouts.json](src/config/defaultLayouts.json).

## Data & service boundaries
- Data fetching is isolated in [src/services](src/services). Widgets call services; services encapsulate external APIs.
- Chain monitor flow: `ChainMonitorWidget` → [src/services/chain-monitor/chainMonitorService.ts](src/services/chain-monitor/chainMonitorService.ts) → public RPC in [src/services/chain-monitor/rpcClient.ts](src/services/chain-monitor/rpcClient.ts) with fallback to Worker proxy via [src/services/chain-monitor/apiClient.ts](src/services/chain-monitor/apiClient.ts). Worker base URL is configured in `workerAPI`.
- Worker project lives in [worker](worker). It proxies API-keyed services (Dune/Etherscan/CoinMarketCap). Secrets are managed with Wrangler (see [worker/README.md](worker/README.md)).
- Icons and RSS are handled via [src/services/faviconService.ts](src/services/faviconService.ts) + [src/services/iconCache.ts](src/services/iconCache.ts) and [src/services/rssService.ts](src/services/rssService.ts).

## Styling conventions
- Theme tokens are CSS variables in [src/newtab/styles/variables.css](src/newtab/styles/variables.css) with a Bloomberg-terminal dark theme. Global/component styles are in [src/newtab/styles/global.css](src/newtab/styles/global.css) and [src/newtab/styles/components.css](src/newtab/styles/components.css).

## Developer workflows
- Dev server: `npm run dev`, then open http://localhost:5173/src/newtab/index.html.
- Build/preview: `npm run build` and `npm run preview`.
- UI tests (Puppeteer): `npm run test` or `npm run test:quick`. Test harness is in [tests/run-automated-test.cjs](tests/run-automated-test.cjs) and documented in [tests/README.md](tests/README.md).
- Worker dev/deploy: `npm run worker:dev`, `npm run worker:deploy`, `npm run worker:deploy:staging`.

## Project-specific patterns
- Fixed elements are marked `fixed: true` and must not be draggable (see grid store + drag logic).
- Avoid `console.log` in production code; when debugging, logs are prefixed by subsystem (e.g., `[EventOrchestrator]`, `[DragSystem]`) per [CLAUDE.md](CLAUDE.md).
- Chain configuration (symbols, Dune namespaces, and CoinCap logos) is centralized in [src/config/chainMonitorConfig.ts](src/config/chainMonitorConfig.ts).
