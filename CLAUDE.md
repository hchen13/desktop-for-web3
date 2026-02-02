# Desktop for Web3

Chrome 新标签页扩展 - Web3 信息桌面，可拖拽自定义布局

## 项目简介

把浏览器「新标签页」变成一块 Web3 信息桌面：整体是克制的深色“终端风”视觉，支持像手机桌面一样拖拽摆放内容模块与快捷入口，一屏聚合链上动态、行情自选、资讯订阅、日历提醒与世界时钟等。适合加密投资者、交易者、研究员与重度信息用户用于日常监控与快速跳转。

## 核心特性

- 🖱️ **拖拽式布局**: 类 iOS 桌面体验，支持自由拖拽摆放组件和图标
- 📊 **链上监控**: 实时追踪 ETH/BTC/SOL 等主流链的 Block Time、Gas、TPS、TVL
- 💰 **价格监控**: 自选币种实时行情，支持搜索添加和自定义分类
- 📰 **Web3 资讯**: 聚合 BlockBeats、Odaily、Cointelegraph 等主流媒体
- 📅 **事件日历**: 显示加密行业重要事件和日程
- 🌍 **世界时钟**: 多时区时间显示，方便跨区域协作
- 🎨 **Bloomberg 终端风格**: 专业深色主题，信息密度高
- 💾 **本地优先**: 数据存储在本地，隐私安全

## 技术栈

- **框架**: SolidJS 1.8.22, TypeScript 5.3
- **构建**: Vite 5.0 + @crxjs/vite-plugin 2.0 (Chrome Extension MV3)
- **状态管理**: SolidJS Store + chrome.storage.local 持久化
- **样式**: CSS Variables (Bloomberg Terminal 风格)
- **事件系统**: EventOrchestrator 统一编排 + DragSystem BFS 推开算法
- **数据服务**: 
  - Binance API (REST + WebSocket)
  - DefiLlama API (TVL 数据)
  - RPC 直连 (ETH/SOL/BSC/Polygon)
  - RSS 订阅解析

## 目录结构

```
src/
├── manifest.json              # Chrome Extension 配置
├── newtab/
│   ├── App.tsx               # 根组件,布局加载,滚轮切换
│   ├── index.tsx             # 入口
│   ├── index.html
│   └── styles/
│       ├── variables.css     # CSS 变量 (Grid, Bloom berg风格, 终端色彩)
│       ├── global.css        # 全局样式
│       └── components.css    # 组件样式
├── grid/
│   ├── GridContainer.tsx     # 布局容器 (685行)
│   ├── AnimatedLayoutContainer.tsx  # 带动画的布局容器
│   ├── Sidebar.tsx           # 侧边栏,桌面切换
│   ├── SidebarIcons.tsx      # 侧边栏图标
│   ├── FixedArea.tsx         # 固定区域容器
│   ├── GridIcon.tsx          # Grid 图标组件
│   ├── AddIconDialog.tsx     # 添加图标对话框
│   ├── AddTabDialog.tsx      # 添加标签对话框
│   ├── SettingsButton.tsx    # 设置按钮
│   ├── store.ts              # 状态管理 (318行)
│   ├── animationStore.ts     # 动画状态管理
│   ├── utils.ts              # 位置转换,边界验证 (386行)
│   ├── contextMenuUtils.ts   # 右键菜单工具
│   ├── types.ts              # 类型定义,GRID常量
│   ├── defaultLayouts.ts     # 4个预设布局配置
│   ├── tabIconConfig.ts      # 标签图标配置
│   └── grid.css              # Grid 样式
├── events/
│   ├── EventOrchestrator.ts  # 事件编排中心 (优先级分发)
│   ├── DragSystem.ts         # 拖拽系统 (BFS推开算法)
│   └── types.ts              # 事件类型定义
├── components/
│   ├── SearchBar/
│   │   ├── SearchBar.tsx      # 搜索框 + Web3地址识别
│   │   └── searchUtils.ts     # 地址/tx hash 判断逻辑
│   ├── TimeDisplay/
│   │   └── TimeDisplay.tsx    # 时间日期显示
│   ├── Widgets/
│   │   ├── index.ts           # Widget 统一导出
│   │   ├── types.ts           # Widget 类型定义
│   │   ├── NewsWidget.tsx     # 资讯 (RSS订阅, Bloomberg风格)
│   │   ├── CalendarWidget.tsx # 日历 (终端风格)
│   │   ├── ChainMonitorWidget.tsx # 链上监控
│   │   ├── WatchlistWidget.tsx # 价格监控
│   │   ├── WorldClockWidget.tsx  # 世界时钟
│   │   ├── EconMapWidget.tsx  # 经济地图
│   │   ├── calendarTypes.ts   # 日历类型
│   │   └── calendarMockData.ts # 日历模拟数据
│   ├── layout/
│   │   ├── ContextMenu.tsx    # 右键菜单组件
│   │   └── Portal.tsx         # Portal 组件
│   └── BootstrapIcon.tsx      # Bootstrap 图标组件
├── services/
│   ├── faviconService.ts      # 多源图标服务 (icon.horse, Google, DDG)
│   ├── iconCache.ts           # 图标缓存
│   ├── builtinIcons.ts        # 内置图标映射
│   ├── rssService.ts          # RSS 订阅服务
│   ├── coinmarketcalService.ts # 日历事件服务
│   ├── binance/               # 币安 API (REST + WS)
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── binanceRest.ts
│   │   └── binanceWs.ts
│   └── chain-monitor/         # 链上监控服务
│       ├── index.ts
│       ├── types.ts
│       ├── chainMonitorService.ts
│       ├── defillamaClient.ts
│       ├── rpcClient.ts
│       └── apiClient.ts
├── config/
│   ├── defaultLayouts.json    # 预设布局 JSON
│   ├── watchlistConfig.ts     # 价格监控配置
│   └── chainMonitorConfig.ts  # 链上监控配置
├── utils/
│   ├── formatters.ts          # 格式化工具
│   └── imageColorExtractor.ts # 图片颜色提取
└── i18n/
    └── index.ts               # 国际化

tests/
└── TEST_CHECKLIST.md          # 测试清单
```

## Grid System

### 常量
- `GRID_UNIT = 100px` - 基础单元格尺寸 (固定)
- `GRID_GAP = 20px` - 单元格间距 (固定)
- `Cell Size = GRID_UNIT + GRID_GAP = 120px`

配置位置: `src/grid/types.ts`

### 坐标系统
- **绝对坐标 (GridPosition)**: 元素在 Grid System 中的实际位置
- **锚点相对坐标 (AnchorRelativePosition)**: 相对于锚点的位置 (用于布局保存)
  - 锚点位于 Grid Area 第一行中心列
  - x 可为负 (锚点左侧) 或正 (锚点右侧)
  - y 始终 >= 0

### 预设尺寸 (GRID_SIZES)
```typescript
ICON: 1×1              # 图标
STANDARD_WIDGET: 2×2   # 标准组件
NEWS_WIDGET: 2×4       # 资讯组件 (高度动态)
SEARCH_BAR: 1×4        # 搜索框
TIME_DISPLAY: 2×1      # 时间显示
```

### 位置转换
```
pixelToGridPosition()     // 像素 → Grid
  → clampGridPosition()     // 边界限制
    → isValidGridPosition() // 验证
gridToPixelPosition()      // Grid → 像素
anchorToAbsolute()         // 锚点相对 → 绝对坐标
```

### 预设布局 (4个桌面)

#### desktop-1: 主页 (15 元素)
| ID | 类型 | 位置 | 尺寸 | 组件 |
|----|------|------|------|------|
| `fixed-time` | fixed | (-4, 0) | 2×1 | TimeDisplay |
| `widget-world-clock` | widget | (-4, 1) | 2×1 | WorldClockWidget |
| `fixed-search` | fixed | (-2, 0) | 4×1 | SearchBar |
| `widget-calendar` | widget | (2, 0) | 3×2 | CalendarWidget |
| `widget-news` | widget | (2, 2) | 3×3 | NewsWidget |
| `widget-chain-monitor` | widget | (-2, 1) | 2×2 | ChainMonitorWidget |
| `widget-watchlist` | widget | (0, 1) | 2×2 | WatchlistWidget |
| `icon-binance` ~ `icon-curve` | icon | 行3-4, 每行4个 | 1×1 | AppIcon |

#### desktop-2: 交易所 (8 个 CEX 图标)
Binance, OKX, Bitget, Bybit, Coinbase, MEXC, KuCoin, Bitfinex

#### desktop-3: 链上 (3 元素)
Hyperliquid, Lighter 图标 + ChainMonitorWidget

#### desktop-4: 宏观 (1 元素)
EconMapWidget - 经济地图

### 图标配置 (ICON_CONFIG, 20+ 个)
- **CEX** (8): Binance, OKX, Bybit, Coinbase, Kraken, Bitget, MEXC, KuCoin, Bitfinex
- **DEX** (5): Uniswap, PancakeSwap, Curve, SushiSwap, Hyperliquid, Lighter
- **L2** (3): Arbitrum, Optimism, Base
- **Tools** (4): Etherscan, Dune, DeFi Llama, CoinGecko

## 事件系统

### EventOrchestrator - 事件编排中心
统一处理所有鼠标事件，按优先级分发：
- **事件优先级**: CONTEXT_MENU > INTERACTION > DRAG
- **拖拽阈值**: DRAG_THRESHOLD = 5px
- **点击时间**: CLICK_TIME_MAX = 300ms

### DragSystem - 拖拽系统
位置: `src/events/DragSystem.ts`

核心算法:
- `calculateNewLayout()` - BFS 推开算法
- `clampPosition()` - 位置边界检查 + 固定元素重叠检测
- `getOccupiedCells()` - 获取元素占用格子
- `overlapsWithFixedElement()` - 固定元素重叠检测

## 拖拽规则

1. **固定元素不可拖拽**: `fixed: true` (时间、搜索框)
2. **1×1 图标仅水平推开**: BFS 方向 `[右, 左]`, 不换行
3. **边界硬约束**: 任何情况下元素不得超出 viewport
4. **Scale 动态**: 缩放后超边界的元素用 `scale(1)` (如资讯组件全高时)
5. **BFS 推开**: 拖拽占据位置时,其他元素寻找最近空位
6. **点击/拖拽区分**: 移动超过 5px 视为拖拽，否则为点击

## Widget 组件

| 组件 | 尺寸 | 功能 | 数据源 |
|------|------|------|--------|
| NewsWidget | 3×3 | Web3 资讯流 | RSS (BlockBeats, Odaily, Cointelegraph, Coindesk) |
| CalendarWidget | 3×2 | 日历事件 | CoinMarketCal API |
| ChainMonitorWidget | 2×2 | 链上监控 | RPC 直连 (优先), DefiLlama, Worker API (回退) |
| WatchlistWidget | 2×2 | 价格监控 | CoinCap API (图标), Binance WebSocket (价格) |
| WorldClockWidget | 2×1 | 世界时钟 | Intl.DateTimeFormat (本地) |
| EconMapWidget | 3×2 | 经济地图 | IMF + World Bank 数据 |
| RateMonitorWidget | 1×1 | 汇率监控 | CoinGecko, Upbit API |

### 数据获取策略
- **优先级机制**: 优先使用不需要 API Key 的公开服务，失败后回退到 Worker API
- **缓存策略**: 每个指标独立缓存，带过期时间戳
- **自动刷新**: 后台定时刷新过期数据
- **错误处理**: 显示友好的加载/错误状态

## 服务模块

### 图标服务 (src/services/)
- `faviconService.ts` - 多源图标获取
  - icon.horse (主要)
  - Google Favicon API (备用)
  - DuckDuckGo (备用)
- `iconCache.ts` - 图标缓存机制
  - 全局 Map 缓存避免重复请求
  - 质量检测 (最小 96×96)
  - 自动切换备用源
- `builtinIcons.ts` - 内置图标映射 (20+ 主流平台)

### API 服务
- **binance/** - Binance API 封装
  - `binanceRest.ts`: REST API (ticker, klines)
  - `binanceWs.ts`: WebSocket 实时价格流
  - `coinListService.ts`: 币种列表管理
  - `connectivityService.ts`: 连接状态管理
  
- **rate-monitor/** - 汇率监控服务
  - 支持 CoinGecko, Upbit, Pyth 多源
  - 自动重试和降级
  
- **chain-monitor/** - 链上数据服务
  - `rpcClient.ts`: 纯前端 RPC 调用 (ETH/SOL/BSC/Polygon)
  - `defillamaClient.ts`: DefiLlama TVL API
  - `apiClient.ts`: Worker API 回退
  - `chainMonitorService.ts`: 统一服务层
  - 优先级数据获取 + 缓存策略

### 数据服务
- `rssService.ts` - RSS 订阅解析
  - 支持多源 RSS (BlockBeats, Odaily, Cointelegraph, Coindesk)
  - CORS 代理处理
  - 数据清洗和格式化
- `coinmarketcalService.ts` - 日历事件数据
- `econMap2Service.ts` - 经济数据服务 (IMF/World Bank)
- `economicDataService.ts` - 经济指标服务

### 工具模块
- `formatters.ts` - 数字/日期/时间格式化
- `imageColorExtractor.ts` - 图片主题色提取

## UI 设计系统

### 色彩系统
- **背景**: Bloomberg 风格深色模式
  - `--bg-root: #1a1b1e`
  - `--bg-panel: #0a0b0d`
- **终端风格** (Calendar Widget)
  - `--terminal-blue: #0095ff`
  - `--terminal-orange: #FF9900`
- **金融数据色彩**
  - `--green-up: #00d395`
  - `--red-down: #ff4757`

### 间距系统
- Grid Gap: 8px
- Grid Padding: 56px (左) / 16px (右)
- 空间变量: xs=4px, sm=8px, md=12px, lg=16px, xl=24px, 2xl=32px

### 圆角系统
- sm: 8px, md: 12px, lg: 16px, xl: 20px

## 代码规范

- 组件命名: PascalCase (GridContainer.tsx)
- 函数命名: camelCase (pixelToGridPosition)
- 常量命名: UPPER_SNAKE_CASE (GRID_UNIT)
- 不使用 `console.log` (生产环境)
- 新增拖拽逻辑 → events/DragSystem.ts
- 新增事件处理 → events/EventOrchestrator.ts
- 新增 Widget → components/Widgets/ + 在 GridContainer 中 lazy 加载
- 新增布局 → src/config/defaultLayouts.json
- 新增图标 → src/grid/tabIconConfig.ts

## 开发工作流

### 本地开发
```bash
npm run dev
# 访问 http://localhost:5173/src/newtab/index.html
```

### Worker 开发 (可选)
```bash
npm run worker:install  # 首次需要安装依赖
npm run worker:dev      # 本地开发
npm run worker:deploy:staging  # 部署到测试环境
npm run worker:deploy   # 部署到生产环境
```

### 构建发布
```bash
npm run build
# 产物在 dist/ 目录
# 可加载到 chrome://extensions/ 进行测试
```

### UI 测试
```bash
npm run test         # 完整测试
npm run test:quick   # 快速测试
```

## 性能优化

- **Lazy Loading**: 所有 Widget 组件使用 `lazy()` 延迟加载
- **Suspense 边界**: 避免加载阻塞渲染
- **缓存机制**: 
  - 图标全局缓存 (iconCache.ts)
  - 链上数据缓存 (chainMonitorService.ts)
  - RSS 数据缓存 (rssService.ts)
- **WebSocket 连接管理**: 自动重连和心跳检测
- **事件优化**: 
  - 拖拽阈值 (5px) 避免误触
  - 事件优先级分发
  - 防抖和节流

## 已知限制

- RSS 订阅受 CORS 限制，需使用代理服务
- Binance WebSocket 可能因网络波动断连 (有自动重连)
- 部分 RPC 节点可能限流 (有降级策略)
- 大型布局可能因浏览器性能有渲染延迟

## 调试流程 (UI bug)

1. 关键路径添加 `console.log()` + 前缀 `[EventOrchestrator]/[DragSystem]/[xxx]`
2. `npm run dev`
3. MCP: chrome-devtools → `http://localhost:5173/src/newtab/index.html`
4. 用户复现 → 通知 agent
5. `list_console_messages()` 读取日志
6. 修复 → 验证
7. 清理: `pkill -f "npm run dev"` + 移除日志

## MCP 工具

- `list_console_messages()` - console 日志
- `take_snapshot()` - DOM 快照
- `navigate_page()` - 页面导航
- `take_screenshot()` - 截图

## 资源清理 (必须执行)

```bash
pkill -f "npm run dev"
pkill -f "vite"
lsof -ti :5173-5180 | xargs kill -9 2>/dev/null
```

## 安全

- 不存储私钥
- API 使用 HTTPS
- 最小权限
- 数据本地优先
