# Desktop for Web3

> A customizable Chrome new tab extension for Web3 enthusiasts. Transform your new tab into an information dashboard with drag-and-drop layout, real-time blockchain monitoring, price tracking, and aggregated news.

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome)](https://github.com/hchen13/desktop-for-web3)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript)](https://www.typescriptlang.org/)
[![SolidJS](https://img.shields.io/badge/SolidJS-1.8-blue?logo=solid)](https://www.solidjs.com/)

## Features

- Drag-and-drop layout system inspired by iOS
- Real-time blockchain monitoring (Block Time, Gas, TPS, TVL)
- Customizable watchlist with live price updates via WebSocket
- Aggregated Web3 news from multiple sources
- Event calendar for crypto industry
- Multi-timezone world clock
- Bloomberg Terminal-inspired dark theme
- Privacy-focused with local-first data storage

## Architecture

```
Frontend (SolidJS + TypeScript)
├── Grid System - Drag-and-drop layout engine with BFS algorithm
├── Event System - Event orchestration and dispatching
└── Widget Components - 7 reusable components

Service Layer
├── Binance API (WebSocket + REST)
├── DefiLlama API (TVL data)
├── RPC Direct Connection (ETH/SOL/BSC/Polygon)
└── RSS Feed Service

Data Layer
├── chrome.storage.local (persistence)
└── In-memory cache (performance)
```

## Quick Start

### 开发环境

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 访问 http://localhost:5173/src/newtab/index.html
```

### 构建发布

```bash
# 构建生产版本
npm run build

# 产物在 dist/ 目录
# 在 chrome://extensions/ 加载解压的扩展
```

### Worker 服务 (可选)

如需使用完整的链上监控功能，可部署 Cloudflare Worker：

```bash
cd worker

# 安装依赖
npm install

# 本地开发
npm run dev

# 部署到生产
npm run deploy
```

查看 [worker/README.md](worker/README.md) 了解详细配置。

## Components

| Component | Description | Size | Data Source |
|-----------|-------------|------|-------------|
| NewsWidget | Web3 news feed | 3×3 | RSS aggregation |
| CalendarWidget | Event calendar | 3×2 | CoinMarketCal |
| ChainMonitorWidget | Blockchain metrics | 2×2 | RPC + DefiLlama |
| WatchlistWidget | Price tracking | 2×2 | Binance WebSocket |
| WorldClockWidget | Multi-timezone clock | 2×1 | Local time |
| EconMapWidget | Economic heatmap | 3×2 | IMF + World Bank |
| RateMonitorWidget | Exchange rates | 1×1 | CoinGecko |

## Usage

### 拖拽布局

- **拖动组件**: 按住组件拖动到新位置
- **添加组件**: 右键空白区域 → 选择组件类型
- **删除组件**: 右键组件 → 删除
- **添加图标**: 右键空白区域 → 添加图标 → 输入网址

### 切换桌面

- 点击左侧边栏图标切换桌面
- 支持 4 个独立桌面，布局自动保存

### 自定义组件

大部分组件支持右键菜单进行个性化设置：

- **价格监控**: 搜索添加币种，设置自定义分类
- **世界时钟**: 添加/删除城市，最多 4 个时区
- **资讯组件**: 右键刷新最新内容

## 🛠️ 技术栈

- **框架**: [SolidJS](https://www.solidjs.com/) 1.8.22 - 高性能响应式框架
- **语言**: [TypeScript](https://www.typescriptlang.org/) 5.3
- **构建**: [Vite](https://vitejs.dev/) 5.0 + [@crxjs/vite-plugin](https://crxjs.dev/)
- **状态管理**: SolidJS Store + chrome.storage.local
- **样式**: CSS Variables (Bloomberg Terminal 风格)
- **测试**: Puppeteer (UI 自动化测试)

## 📁 项目结构

```
src/
├── grid/                    # Grid 布局系统
│   ├── GridContainer.tsx    # 核心布局容器
│   ├── store.ts             # 状态管理
│   ├── utils.ts             # 坐标转换工具
│   └── types.ts             # 类型定义
├── events/                  # 事件系统
│   ├── EventOrchestrator.ts # 事件编排器
│   └── DragSystem.ts        # 拖拽算法 (BFS)
├── components/
│   └── Widgets/             # 7 个 Widget 组件
├── services/                # 数据服务
│   ├── binance/             # Binance API
│   ├── chain-monitor/       # 链上数据
│   └── rssService.ts        # RSS 订阅
└── config/                  # 配置文件
    └── defaultLayouts.json  # 预设布局
```

## 🔧 配置

## Configuration

### Customize Default Layout

Edit `src/config/defaultLayouts.json`:

```json
{
  "desktop-1": {
    "name": "Main",
    "elements": [
      {
        "id": "widget-news",
        "type": "widget",
        "component": "news",
        "position": { "x": 2, "y": 2 },
        "size": { "width": 3, "height": 3 }
      }
    ]
  }
}
```

### Add Custom Icons

Edit `src/grid/tabIconConfig.ts`:

```typescript
export const ICON_CONFIG = {
  'custom-icon': {
    name: 'Custom',
    url: 'https://example.com',
    category: 'tools'
  }
}
```

## Testing

```bash
# Run UI automation tests
npm run test

# Quick test (skip some checks)
npm run test:quick
```

Test reports and screenshots are saved in `tests/screenshots/`.

## Documentation

- [CLAUDE.md](CLAUDE.md) - Complete technical documentation
- [Grid System Design](design/layout/grid-system-design.md) - Layout system details
- [Chain Monitor Implementation](docs/chain-monitor-implementation-summary.md) - Architecture overview
- [Worker Deployment Guide](worker/README.md) - Cloudflare Worker setup

## Contributing

Contributions are welcome! Please feel free to submit Issues and Pull Requests.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Commit Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation update
- `style`: Code formatting
- `refactor`: Code refactoring
- `perf`: Performance improvement
- `test`: Testing
- `chore`: Build/tooling

## License

[MIT License](LICENSE) © 2026

## Acknowledgments

- Design inspired by [Bloomberg Terminal](https://www.bloomberg.com/professional/solution/bloomberg-terminal/)
- Icon service powered by [icon.horse](https://icon.horse/)
- Blockchain data from [DefiLlama](https://defillama.com/)
- Price data from [Binance API](https://www.binance.com/en/binance-api)

## Links

- [Issues](https://github.com/hchen13/desktop-for-web3/issues)
- [Changelog](CHANGELOG.md)

