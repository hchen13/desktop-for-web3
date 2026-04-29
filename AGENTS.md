# AGENTS.md

本文件为 AI 编码代理（Claude Code、Cursor、Aider 等）提供仓库上下文。改动代码前请阅读。

## 项目

Chrome MV3 新标签页扩展，基于 SolidJS 1.8 + TypeScript 5.3 + Vite 5。把新标签页变成可拖拽的 Web3 信息桌面：链上监控、行情自选、RSS 资讯、日历、世界时钟、经济地图。详细产品介绍见 `README.md`。

## 命令

```bash
npm install                       # 安装依赖
npm run dev                       # 开发服务器，端口 5173（Vite 预览，非真实扩展上下文）
npm run build                     # 产出 dist/，可在 chrome://extensions 加载解压

# 测试 / 静态检查
npm run typecheck                 # tsc --noEmit
npm run lint                      # eslint
npm run test                      # vitest（单元 + 集成）
npm run test:coverage             # vitest + coverage report
npm run test:e2e                  # ⚠ 待实现，详见 "已知不完美"
npm run ci                        # typecheck + lint + test + build（pre-push 也会跑）

# Worker（可选回退服务，部署在 Cloudflare）
npm run worker:install
npm run worker:dev
npm run worker:deploy:staging
npm run worker:deploy
```

**husky 自动钩子**：
- `pre-commit` 跑 `lint-staged`（对 staged ts/tsx 文件 eslint --fix + prettier --write）
- `pre-push` 跑 `npm run typecheck && npm run test`

**MV3 注意**：`http://localhost:5173/src/newtab/index.html` 是 Vite 预览页，不是真实扩展上下文——`chrome.storage.local`、`chrome-extension://` 协议下的资源解析等只有在 `dist/` 加载到 Chrome 后才完整工作。功能验收必须用打包后的扩展。

**CRXJS dev manifest 注意**：`npm run dev` 会把 `dist/manifest.json` 改写为开发态 manifest，并注入 `background.service_worker = "service-worker-loader.js"`，该 worker 会 import localhost 的 Vite/CRXJS HMR 客户端。发布、换机加载或手动验收前必须重新执行 `rm -rf dist && npm run build`；不要加载跑过 dev 的 `dist/`。`npm run build` 已串联 `tests/validate-production-manifest.cjs`，会拦截 dev service worker 和 CRXJS dev `web_accessible_resources`。

## 架构关键点

### Grid System
源码常量在 `src/grid/types.ts`（**source of truth**）：

- `GRID_UNIT = 100px`，`GRID_GAP = 20px`，单元格 = 120px
- 元素位置有两套坐标：
  - `GridPosition`（绝对）：运行时使用
  - `AnchorRelativePosition`（锚点相对）：用于布局保存。锚点 = Grid Area 第一行中心列；x 可正可负，y ≥ 0
- 转换链：`pixelToGridPosition() → clampGridPosition() → isValidGridPosition()`，反向 `gridToPixelPosition()`，锚点用 `anchorToAbsolute()`
- 预设尺寸枚举见 `GRID_SIZES`（ICON 1×1, STANDARD_WIDGET 2×2, NEWS_WIDGET 2×4, SEARCH_BAR 1×4, TIME_DISPLAY 2×1 等）
- Grid padding：左 56px（Sidebar 空间）、右/上/下各 16px；最小 6×6

### 事件系统
- `src/events/EventOrchestrator.ts` 是唯一的鼠标事件入口，按优先级 `CONTEXT_MENU > INTERACTION > DRAG` 分发
- 阈值：`DRAG_THRESHOLD = 5px`、`CLICK_TIME_MAX = 300ms`，区分点击与拖拽
- `src/events/DragSystem.ts` 实现 BFS 推开布局：`calculateNewLayout()` / `clampPosition()` / `getOccupiedCells()` / `overlapsWithFixedElement()`

### 拖拽规则（非显然，写在这里）
1. `fixed: true` 的元素（时间、搜索框）不可拖
2. 所有元素（含 1×1 图标）都可在四个方向 BFS 推开，方向优先级按当前拖拽方向动态排序
3. 边界硬约束：任何元素都不得超出 viewport
4. 移动 ≤ 5px → 点击；> 5px → 拖拽（严格大于；EventOrchestrator 与 DragSystem 共用 `src/events/constants.ts` 的 `DRAG_THRESHOLD`，距离均用欧氏 `Math.hypot`）
5. BFS 推开默认方向优先级：右 → 下 → 左 → 上（避免向下挤压超出 viewport），实际顺序按拖拽矢量重排

### 数据获取策略
链上监控（`src/services/chain-monitor/`）的核心模式是 **三级回退**：
1. RPC 直连（`rpcClient.ts`，ETH/SOL/BSC/Polygon，无需 Key）
2. DefiLlama API（`defillamaClient.ts`，TVL）
3. Worker API（`apiClient.ts`，部署在 `worker/`，承担需要 Key 或 CORS 受限的调用）

每个指标独立缓存带 TTL；后台定时刷新过期数据；失败回退到下一级。这是本仓库最容易踩坑的设计——加新指标时务必沿用同一回退链。

### CORS 与代理
- RSS 源（BlockBeats、Odaily、Cointelegraph、Coindesk）和 IMF 数据均受 CORS 限制
- 开发环境：`vite.config.ts` 配置了 `/rss-proxy/*`、`/api-proxy/imf`、`/binance-*` 代理路径
- 扩展上下文：依赖 `src/manifest.json` 的 `host_permissions` + 公共 CORS 代理（`api.allorigins.win`、`corsproxy.io`、`api.rss2json.com`）+ 自有 Worker

### 持久化
状态存 `chrome.storage.local`，由 `src/grid/store.ts` 管理。布局以 `AnchorRelativePosition` 形式保存，加载时通过 `anchorToAbsolute()` 还原成绝对坐标。

### Popup（扩展工具栏）
`src/popup/` 是独立的 SolidJS 小应用，由 `manifest.json` 的 `action.default_popup` 引导。流程：

1. 用户在任意网页点扩展图标 → popup 打开
2. Popup 读 `chrome.tabs.query` 拿当前 tab + 读 `chrome.storage.local.gridLayouts` 拿桌面列表
3. 用户点选目标桌面 → popup 写一条 `PendingIconAdd` 进 `chrome.storage.local.pendingIconAdds` 队列
4. Newtab 端 `processPendingIconAdds`（启动时 + `chrome.storage.onChanged` 监听）消费队列，调 `addElementToLayout` 自动找位置

**关键约束**：popup 的 `window` 不是 newtab 的 `window`，无法直接调 `addElement`（需要 grid context 算位置）。所以采用"队列解耦"模式：popup 只生产请求，newtab 才能消费。

**幂等性**：`addElementToLayout` 用 `enqueuedAt` 时间戳作为 element id 一部分，重复消费同一条不会产生多余元素（多 newtab 同时打开时的容错）。

## 改代码时往哪放

| 改动类型 | 位置 |
|---------|------|
| 新拖拽逻辑 | `src/events/DragSystem.ts` |
| 新事件处理 | `src/events/EventOrchestrator.ts` |
| 新 Widget | 新建 `src/components/Widgets/<Name>Widget.tsx` + 在 `src/components/Widgets/index.ts` 导出 + 在 `GridContainer.tsx` 中 `lazy()` 注册 |
| 新预设布局 | `src/config/defaultLayouts.json` |
| 新快捷图标 | `src/grid/tabIconConfig.ts` |
| 扩展品牌图标 | `src/icons/`；设计源在 `design/logo-options/raster-selected/` |
| 新链上数据源 | `src/services/chain-monitor/` 下加客户端，并在 `chainMonitorService.ts` 接入回退链 |
| Popup UI 调整 | `src/popup/popup.tsx` + `popup.css`；新增 popup→newtab 通道走 `pendingIconAdds` storage key |

## UI 调试流程（chrome-devtools MCP）

1. 在关键路径加 `console.log()`，前缀 `[EventOrchestrator]`/`[DragSystem]` 等便于过滤
2. `npm run dev` 启动
3. MCP `navigate_page()` → `http://localhost:5173/src/newtab/index.html`
4. 用户复现问题后通知 agent
5. `list_console_messages()` 抓日志、`take_snapshot()` 抓 DOM、`take_screenshot()` 抓截图
6. 修复并验证后**移除调试日志**
7. **必做清理**（防止端口占用 / 进程泄漏）：
   ```bash
   pkill -f "npm run dev"
   pkill -f "vite"
   lsof -ti :5173-5180 | xargs kill -9 2>/dev/null
   ```

## 已知限制

- RSS 受 CORS 限制，需代理（开发用 vite proxy，扩展上下文用 Worker / 公共代理）
- Binance WebSocket 偶尔断连（已实现自动重连 + 心跳）
- 公开 RPC 节点可能限流（已有降级到 DefiLlama / Worker 的回退）

## 已知不完美（待补）

- **E2E 测试缺位**：`tests/run-automated-test.cjs` 尚未补齐，`npm run test:e2e` 与 CI 的 e2e job 当前都是禁用状态（`.github/workflows/ci.yml` 已注释）。补齐时需实现 puppeteer 扩展模式（`--load-extension=dist/`）+ 至少 5 个核心场景：默认布局加载 / 拖拽不重叠 / 桌面切换 / 持久化 / resize 不破坏布局。补完后取消 ci.yml 中 e2e job 的注释。
- **覆盖率 21%**：UI 组件、对话框、`econMap2Service`、`coinmarketcalService` 等仍未覆盖；核心 grid/events/formatters/store 模块覆盖率 60–100%。
- **ESLint 250+ warning**：均来自既有代码的 `console.log` 与 `any`，分次清理。

## 敏感信息

任何文档、注释、提交信息中**不得记录完整的 API Key / Token / 密钥**。如需引用作为标识，仅写前 6–8 字符（如 `2d703765...`）或环境变量占位符（如 `$Z_AI_API_KEY`）。
