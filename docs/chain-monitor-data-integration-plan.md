# 链上监控数据集成计划

## 数据获取优先级

### 1. Block Time Delay（区块时间延迟）

**前端直接获取（优先级1）**:
- ✅ 已实现：`rpcClient.ts` → `getBlockTimeDelayRPC()`
- 支持：ETH, BSC, Polygon, BTC, SOL
- 数据来源：公共 RPC 端点

**后端接口（优先级2，Fallback）**:
- ✅ 已实现：`apiClient.ts` → `workerAPI.blockchainMonitor.getBlockTimeDelay()`
- 数据来源：Cloudflare Worker → RPC（带 Alchemy API Key）或 Dune Analytics

---

### 2. Gas Price（Gas 费）

**前端直接获取（优先级1）**:
- ✅ 已实现：`rpcClient.ts` → `getGasPriceRPC()`
- 支持：ETH, BSC, Polygon, BTC, SOL
- 数据来源：公共 RPC 端点

**后端接口（优先级2，Fallback）**:
- ✅ 已实现：`apiClient.ts` → `workerAPI.blockchainMonitor.getGasPrice()`
- 数据来源：Cloudflare Worker → RPC（带 Alchemy API Key）

---

### 3. TPS（每秒交易数）

**前端直接获取（优先级1，仅 SOL）**:
- ✅ 已实现：`rpcClient.ts` → `getTPSRPC()`（仅 SOL）
- 数据来源：Solana RPC `getRecentPerformanceSamples`

**后端接口（优先级2，Fallback）**:
- ✅ 已实现：`apiClient.ts` → `workerAPI.blockchainMonitor.getTPS()`
- 数据来源：
  - SOL: Cloudflare Worker → RPC（带 Alchemy API Key）
  - 其他链: Cloudflare Worker → Dune Analytics

---

### 4. Active Addresses（活跃地址数）

**前端直接获取**:
- ❌ 不支持（需要 Dune API Key）

**后端接口（唯一来源）**:
- ✅ 已实现：`apiClient.ts` → `workerAPI.blockchainMonitor.getActiveAddresses()`
- 数据来源：Cloudflare Worker → Dune Analytics

---

### 5. TVL（总锁仓价值）

**前端直接获取（优先级1）**:
- ✅ 已实现：`defillamaClient.ts` → `getTVLDefiLlama()`
- 支持：ETH, BSC, Polygon, SOL（BTC 返回 0）
- 数据来源：DefiLlama API（无需 API Key）

**后端接口（优先级2，Fallback）**:
- ✅ 已实现：`apiClient.ts` → `workerAPI.blockchainMonitor.getTVL()`
- 数据来源：Cloudflare Worker → DefiLlama API

---

## 数据层架构

### 当前实现状态

✅ **已实现**:
- 数据层和 UI 层分离（`chainMonitorService.ts` vs `ChainMonitorWidget.tsx`）
- 优先级获取机制（前端 RPC → Worker API）
- 内存缓存（`Map<ChainId, ChainMetrics>`）
- 订阅机制（`subscribe()`）

❌ **待实现**:
- localStorage 跨 session 缓存（24h 新鲜度）
- 失败后 10s 重试机制
- UI 层接入真实数据（当前使用 MOCK_DATA）
- 加载状态和错误处理 UI

---

## 实现计划

### 阶段 1: localStorage 缓存（24h 新鲜度）

**实现位置**: `src/services/chain-monitor/chainMonitorService.ts`

**缓存策略**:
- 缓存键：`chain_monitor_cache_${chainId}`
- 缓存结构：`{ version: string, timestamp: number, data: ChainMetrics }`
- 新鲜度：24 小时（86400000 ms）
- 版本号：`v1`（用于清除旧缓存）

**实现步骤**:
1. 添加 `getCacheFromStorage()`, `setCacheToStorage()`, `isCacheValid()` 函数
2. 在 `getAllMetrics()` 中：
   - 先检查 localStorage 缓存
   - 如果缓存有效，直接返回
   - 如果缓存过期，从 API 获取并更新缓存
3. 在数据更新后，写入 localStorage

---

### 阶段 2: 失败重试机制（10s 间隔）

**实现位置**: `src/components/Widgets/ChainMonitorWidget.tsx`

**重试策略**:
- 如果所有数据源都失败，显示加载状态
- 每 10 秒自动重试一次
- 最多重试 3 次（可选，或无限重试）

**实现步骤**:
1. 添加 `retryCount` 和 `retryInterval` 状态
2. 在数据获取失败时，启动 10s 定时器
3. 定时器触发时，重新调用 `chainMonitorService.getAllMetrics()`
4. 如果成功，清除定时器；如果失败，继续重试

---

### 阶段 3: UI 层接入真实数据

**实现位置**: `src/components/Widgets/ChainMonitorWidget.tsx`

**数据转换**:
- 将 `ChainMetrics` 转换为 UI 所需的格式
- 处理数据格式化（单位转换、数字格式化等）

**实现步骤**:
1. 移除 `MOCK_DATA`
2. 使用 `chainMonitorService.subscribe()` 订阅数据更新
3. 将 `ChainMetrics` 转换为 UI 数据格式
4. 处理 `null` 值（显示加载状态或占位符）

---

### 阶段 4: 加载状态和错误处理 UI

**实现位置**: `src/components/Widgets/ChainMonitorWidget.tsx`

**UI 状态**:
- `loading`: 初始加载或重试中
- `error`: 所有数据源都失败
- `partial`: 部分数据加载成功
- `success`: 所有数据加载成功

**实现步骤**:
1. 添加 `isLoading`, `hasError`, `errorMessage` 状态
2. 根据状态渲染不同的 UI：
   - Loading: 显示加载动画或骨架屏
   - Error: 显示错误信息和重试按钮
   - Partial: 显示已加载的数据，未加载的显示占位符
   - Success: 正常显示所有数据

---

## 数据新鲜度配置

根据 API 文档，不同指标的新鲜度要求不同：

| 指标 | 实时性 | 缓存时间（内存） | 缓存时间（localStorage） |
|------|--------|-----------------|------------------------|
| Block Time Delay | 实时 | 10秒 | 24小时（但优先使用内存缓存） |
| Gas Price | 实时 | 30秒 | 24小时（但优先使用内存缓存） |
| TPS | 15-30分钟延迟 | 60秒 | 24小时 |
| Active Addresses | 15-30分钟延迟 | 5分钟 | 24小时 |
| TVL | 实时 | 5分钟 | 24小时 |

**注意**: localStorage 缓存主要用于跨 session 恢复，实际使用时优先检查内存缓存（更实时）。

---

## 测试计划

1. **缓存测试**:
   - 关闭浏览器，重新打开，验证数据是否从 localStorage 恢复
   - 修改系统时间，验证 24h 新鲜度检查

2. **重试测试**:
   - 断开网络，验证是否显示加载状态
   - 恢复网络，验证是否在 10s 后自动重试

3. **数据获取测试**:
   - 验证前端 RPC 获取成功
   - 模拟前端 RPC 失败，验证是否 fallback 到 Worker API
   - 模拟所有数据源失败，验证错误处理

4. **UI 测试**:
   - 验证加载状态显示
   - 验证错误状态显示
   - 验证部分数据加载状态显示
   - 验证正常数据渲染
