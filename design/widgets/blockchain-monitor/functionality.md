# blockchain-monitor Widget

一个轻量级、实时链上状态监控小组件（推荐尺寸：200×200px），专为网页/仪表盘设计，帮助用户在几秒内判断区块链网络（L1/L2/DeFi链等）的当前运行健康度与潜在风险。

## 核心目标
- **一眼看懂**：区块是否正常推进？网络是否拥堵？是否有明显异常？
- **极简视觉**：大字体 + 颜色编码（绿/黄/橙/红） + 箭头变化 + 红色警报行
- **实时刷新**：每 10–60 秒更新一次，最后更新时间显示

## 显示的核心指标

| 优先级 | 指标名称                  | 显示内容示例                  | 为什么关键                              | 视觉呈现建议                     | 数据来源示例          |
|--------|---------------------------|-------------------------------|-----------------------------------------|----------------------------------|-----------------------|
| 1      | 最新区块延迟 / Block Time Delay | 14s ago / +18s               | 最直接判断链是否卡死、分叉或停摆        | 大字体（24–28px），延迟>30s变橙/红 | RPC / Explorer API   |
| 2      | 当前 Gas 费 / Gas Price   | 19.2 gwei ↑12%               | EVM 链用户最痛点，反映拥堵程度          | 当前值 + 24h 变化箭头（↑↓）      | Etherscan / Gas API  |
| 3      | TPS（最近1h）             | 14.8 tx/s ↓8%                | 网络吞吐量与真实活跃度直观指标          | 当前值 + 变化箭头                | Block Explorer       |
| 4      | 活跃地址数（24h）         | 42.3k ↓4.2%                  | 真实用户参与度，链是否"活着"            | 人数 + 涨跌百分比                | Dune / Chainalysis   |
| 6      | TVL（总锁仓价值）         | $1.47B ↑2.1%                 | DeFi 链/协议经济健康核心                | 金额 + 变化箭头                  | DefiLlama API        |
| 7      | Nakamoto 系数             | 7–10                         | 去中心化程度量化（越高越好）            | 数字 + 颜色（<5红，>20绿）       | Validator 数据 / Lido 等 |

## 典型布局示例（极简健康仪表盘型）
┌────────────────────────────┐
│       Ethereum Mainnet     │
│                            │
│     最新区块：#21,456,789    │
│           14s ago          │   ← 绿色正常 / 橙色延迟 / 红色 >60s
│                            │
│   Gas费：19.2 gwei   ↑12%   │   ← 红色 >100gwei
│   TPS：14.8 tx/s    ↓8%     │
│   活跃地址：42.3k   ↓4.2%    │
│   TVL：$1.47B       ↑2.1%  │
│                            │
│   Nakamoto 系数：8          │   ← <5 红色警告
│                            │
│   更新于 18秒前              │
└────────────────────────────┘


## 链选择功能

组件支持用户选择要监控的链，默认显示以下5条链：
- **BTC** (Bitcoin)
- **ETH** (Ethereum)
- **SOL** (Solana)
- **BSC** (Binance Smart Chain)
- **POLYGON** (Polygon)

### 配置方式
链选择配置存储在 Extension 的配置文件中（`src/config/chainMonitorConfig.ts`），支持：
- 默认链列表配置
- 用户自定义链选择（通过 chrome.storage.local 持久化）
- 链名称到 Dune 数据表的映射关系

### 链到 Dune 数据表映射

| 链名称 | Dune Namespace | 数据表前缀 |
|--------|---------------|-----------|
| BTC | `bitcoin` | `bitcoin.blocks`, `bitcoin.transactions` |
| ETH | `ethereum` | `ethereum.blocks`, `ethereum.transactions` |
| SOL | `solana` | `solana.blocks`, `solana.transactions` |
| BSC | `bnb` | `bnb.blocks`, `bnb.transactions` |
| POLYGON | `polygon` | `polygon.blocks`, `polygon.transactions` |

## 数据来源

**所有指标数据均从 Dune Analytics 获取**，通过 Dune API 执行 SQL 查询：

- 使用 DuneSQL（基于 Trino）语法
- 通过 Cloudflare Worker 代理 API 调用
- API KEY 安全存储在 Worker 端
- 支持查询结果缓存（减少 API 调用）

## 附加特性
- **颜色语义**：绿（正常）、黄（注意）、橙（预警）、红（危险）
- **异常优先**：最严重的一条异常信号始终以醒目红色显示在底部（覆盖其他次要信息）
- **可交互**：鼠标悬停/点击可展开更多细节（如24h趋势小图、具体警报列表）
- **多链支持**：可配置显示不同链（BTC、ETH、SOL、BSC、POLYGON），标题动态切换
- **链切换**：用户可在组件中切换查看不同链的状态
- **警报机制**：支持 webhook / 浏览器通知（可选扩展）

这个 widget 适用于：散户监控链体验、项目方观察网络状态、交易员捕捉异常信号、社区管理员快速分享链健康状况。