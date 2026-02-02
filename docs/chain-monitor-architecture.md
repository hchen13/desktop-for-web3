# 链上监控组件架构设计

## 架构原则

1. **数据层与UI层完全分离**
   - 数据层：负责数据获取、缓存、优先级管理
   - UI层：只负责渲染，不关心数据来源

2. **优先级机制**
   - 优先使用不需要API KEY的纯前端调用（RPC、DefiLlama）
   - 失败后自动回退到Worker接口

3. **组件状态管理**
   - 使用组件内部数据缓存（类似WatchlistWidget）
   - 通过响应式信号管理状态
   - 子组件通过函数获取数据，建立响应式依赖

## 架构层次

```
┌─────────────────────────────────────────┐
│         UI Layer (Components)           │
│  - ChainMonitorWidget (主组件)          │
│  - ChainRow (单个链显示)                 │
│  - MetricDisplay (指标显示子组件)        │
└─────────────────────────────────────────┘
                    ↓ (通过 getData 函数)
┌─────────────────────────────────────────┐
│      Data Layer (Services)              │
│  - chainMonitorService                  │
│    ├─ 数据缓存管理                       │
│    ├─ 优先级数据获取                     │
│    │  ├─ 优先级1: 纯前端RPC               │
│    │  ├─ 优先级2: Worker API             │
│    │  └─ 优先级3: Dune (通过Worker)      │
│    ├─ 自动刷新机制                       │
│    └─ 数据新鲜度检查                     │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│      Data Sources                       │
│  - 纯前端RPC (eth_getBlockByNumber等)   │
│  - DefiLlama API (TVL)                  │
│  - Worker API (所有指标)                 │
└─────────────────────────────────────────┘
```

## 数据层设计

### 1. 数据服务接口

```typescript
interface ChainMonitorService {
  // 获取链的所有指标
  getAllMetrics(chain: string): Promise<ChainMetrics | null>;
  
  // 获取单个指标
  getBlockTimeDelay(chain: string): Promise<BlockTimeDelay | null>;
  getGasPrice(chain: string): Promise<GasPrice | null>;
  getTPS(chain: string): Promise<TPS | null>;
  getActiveAddresses(chain: string): Promise<ActiveAddresses | null>;
  getTVL(chain: string): Promise<TVL | null>;
  
  // 订阅数据更新
  subscribe(chain: string, callback: (data: ChainMetrics) => void): () => void;
  
  // 获取缓存数据（同步）
  getCachedData(chain: string): ChainMetrics | null;
}
```

### 2. 优先级数据获取策略

#### Block Time Delay
1. **优先级1**: 纯前端RPC调用
   - ETH/BSC/Polygon: `eth_getBlockByNumber('latest')`
   - BTC: Blockstream API (public)
   - SOL: `getSlot()` + `getBlockTime()`
2. **优先级2**: Worker API (`/api/blockchain-monitor/block-time-delay`)
3. **优先级3**: Dune (通过Worker，如果RPC失败)

#### Gas Price
1. **优先级1**: 纯前端RPC调用
   - EVM: `eth_gasPrice`
   - BTC: Blockstream API fee estimates
   - SOL: `getRecentPrioritizationFees()`
2. **优先级2**: Worker API (`/api/blockchain-monitor/gas-price`)

#### TPS
1. **优先级1**: 纯前端RPC调用（仅SOL）
   - SOL: `getRecentPerformanceSamples()`
2. **优先级2**: Worker API (`/api/blockchain-monitor/tps`)
3. **优先级3**: Dune (通过Worker)

#### Active Addresses
1. **优先级1**: Worker API (`/api/blockchain-monitor/active-addresses`)
2. **优先级2**: Dune (通过Worker)

#### TVL
1. **优先级1**: DefiLlama API (纯前端)
   - `https://api.llama.fi/v2/chains` (不需要API KEY)
2. **优先级2**: Worker API (`/api/blockchain-monitor/tvl`)

### 3. 数据缓存策略

- 每个链的指标数据独立缓存
- 缓存时间：
  - Block Time Delay: 10秒
  - Gas Price: 30秒
  - TPS: 60秒
  - Active Addresses: 5分钟
  - TVL: 5分钟
- 使用时间戳判断数据新鲜度
- 自动刷新过期数据

## UI层设计

### 1. 组件结构

```
ChainMonitorWidget (主组件)
├─ 数据缓存: createSignal<Map<string, ChainMetrics>>
├─ 订阅数据更新
├─ 自动刷新机制
└─ ChainRow[] (子组件)
    ├─ 静态部分: 链图标、名称
    └─ MetricDisplay (动态部分)
        ├─ BlockTimeDelayDisplay
        ├─ GasPriceDisplay
        ├─ TPSDisplay
        ├─ ActiveAddressesDisplay
        └─ TVLDisplay
```

### 2. 响应式数据流

```typescript
// 主组件
const [metricsCache, setMetricsCache] = createSignal<Map<string, ChainMetrics>>(new Map());

// 获取数据的函数（建立响应式依赖）
const getMetrics = (chain: string): ChainMetrics | null => {
  return metricsCache().get(chain) || null;
};

// 子组件中使用
const ChainRow = (props: { chain: string; getMetrics: (chain: string) => ChainMetrics | null }) => {
  const metrics = createMemo(() => props.getMetrics(props.chain));
  // 渲染 metrics
};
```

### 3. 状态管理

- **Loading**: 初始数据获取中
- **Error**: 所有数据源都失败
- **Success**: 至少一个数据源成功
- **Stale**: 数据过期，正在刷新

## 实现步骤

1. 创建数据服务层 (`src/services/chain-monitor/`)
   - `rpcClient.ts`: 纯前端RPC调用
   - `defillamaClient.ts`: DefiLlama API调用
   - `chainMonitorService.ts`: 主服务，管理优先级和缓存
   - `types.ts`: 类型定义

2. 重构UI组件 (`src/components/Widgets/ChainMonitorWidget.tsx`)
   - 使用数据服务
   - 实现响应式数据流
   - 创建子组件

3. 更新配置 (`src/config/chainMonitorConfig.ts`)
   - 添加RPC端点配置
   - 添加DefiLlama链名映射
