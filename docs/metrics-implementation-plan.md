# 链上监控指标实现方案（重新评估版）

## 已实现指标

### ✅ 1. Block Time Delay（最新区块延迟）
- **实现方式**: RPC
- **状态**: 已实现并测试通过
- **数据源**: RPC 节点直接获取最新区块
- **各链支持**: ✅ ETH ✅ BSC ✅ Polygon ✅ BTC ✅ SOL

### ✅ 2. Gas Price（当前 Gas 费）
- **实现方式**: RPC
- **状态**: 已实现并测试通过（所有5个链）
- **数据源**: 
  - EVM 链（ETH/BSC/Polygon）: `eth_gasPrice` RPC (Gwei)
  - BTC: Blockstream API 费用估算 (sat/vB) - **替代指标**
  - SOL: Solana RPC `getFees` (Lamports) - **替代指标**
- **各链支持**: ✅ ETH ✅ BSC ✅ Polygon ✅ BTC（费用率） ✅ SOL（优先费）

---

## 待实现指标调研

### 3. TPS（最近1小时）
**需求**: 14.8 tx/s ↓8%

#### 各链支持情况

| 链 | RPC 方案 | Dune 方案 | 推荐方案 |
|----|---------|-----------|---------|
| **ETH/BSC/Polygon** | ⚠️ 需计算（采样区块） | ✅ 完全支持 | **Dune** |
| **BTC** | ⚠️ 需计算（采样区块） | ✅ 完全支持 | **Dune** |
| **SOL** | ✅ 原生支持 (`getRecentPerformanceSamples`) | ✅ 完全支持 | **RPC（优先）或 Dune** |

#### 实现方案对比

**RPC 方案**:
- **EVM 链 & BTC**: 需要遍历最近1小时的所有区块
  - ETH 约 300 个区块/小时，需要 300+ 次 RPC 调用
  - 响应时间长（10-30秒），对公共 RPC 压力大
  - 结论：**不推荐**
- **SOL**: 原生支持 `getRecentPerformanceSamples`
  - 直接返回 `numTransactions` 和 `samplePeriodSecs`
  - 实时性极高，推荐使用
  - 结论：**推荐**

**Dune 方案**:
```sql
-- EVM 链 & BTC
SELECT 
  COUNT(*) as tx_count,
  COUNT(*) / 3600.0 as tps
FROM {{tx_table}}
WHERE {{block_time_field}} > NOW() - INTERVAL '1' hour

-- SOL (使用 solana.transactions)
SELECT 
  COUNT(*) as tx_count,
  COUNT(*) / 3600.0 as tps
FROM solana.transactions
WHERE block_time > NOW() - INTERVAL '1' hour
```
- 单次 SQL 查询即可
- 响应快（通常 < 5秒）
- **所有链都支持**
- 数据延迟可接受（监控场景）
- 结论：**推荐（SOL 可用 RPC 作为备选）**

---

### 4. 24h 链上成交量
**需求**: $2.47B ↑5.2%

#### 各链支持情况

| 链 | RPC 方案 | Dune 方案 | 推荐方案 |
|----|---------|-----------|---------|
| **ETH/BSC/Polygon** | ❌ 不可行 | ✅ 完全支持 | **Dune** |
| **BTC** | ❌ 不可行 | ✅ 完全支持 | **Dune** |
| **SOL** | ❌ 不可行 | ✅ 完全支持 | **Dune** |

#### 实现方案对比

**RPC 方案**:
- 需要遍历过去 24 小时的所有交易
- ETH 约 7200 个区块，需要解析数十万笔交易
- BTC 约 144 个区块，但需要解析所有交易金额
- SOL 约 15 万个区块，计算量巨大
- 需要获取代币价格（USD）进行转换
- 结论：**所有链都不可行**

**Dune 方案**:
```sql
-- EVM 链: 原生代币转账 + ERC20 转账
SELECT 
  SUM(value / {{value_divisor}}) as total_volume_native,
  -- 需要结合价格表计算 USD 价值
  SUM(value / {{value_divisor}} * price_usd) as total_volume_usd
FROM {{tx_table}}
WHERE {{block_time_field}} > NOW() - INTERVAL '24' hour
LEFT JOIN prices.usd ON ...

-- BTC: 仅原生 BTC 转账
SELECT 
  SUM(value / 1e8) as total_volume_btc,
  SUM(value / 1e8 * price_usd) as total_volume_usd
FROM bitcoin.transactions
WHERE block_time > NOW() - INTERVAL '24' hour
LEFT JOIN prices.usd ON ...

-- SOL: 原生 SOL 转账 + SPL Token 转账
SELECT 
  SUM(amount / 1e9) as total_volume_sol,
  SUM(amount / 1e9 * price_usd) as total_volume_usd
FROM solana.transactions
WHERE block_time > NOW() - INTERVAL '24' hour
LEFT JOIN prices.usd ON ...
```
- 可以聚合所有交易的价值
- 可以关联价格表计算 USD 价值
- **所有链都支持**
- 结论：**推荐（唯一可行方案）**

---

### 5. 活跃地址数（24小时）
**需求**: 42.3k ↓4.2%

#### 各链支持情况

| 链 | RPC 方案 | Dune 方案 | 推荐方案 |
|----|---------|-----------|---------|
| **ETH/BSC/Polygon** | ❌ 不可行 | ✅ 完全支持 | **Dune** |
| **BTC** | ❌ 不可行 | ✅ 完全支持 | **Dune** |
| **SOL** | ❌ 不可行 | ✅ 完全支持 | **Dune** |

#### 实现方案对比

**RPC 方案**:
- 需要遍历过去 24 小时的所有交易
- 需要去重统计唯一地址
- 所有链都需要大量 RPC 调用
- 结论：**所有链都不可行**

**Dune 方案**:
```sql
-- EVM 链
SELECT 
  COUNT(DISTINCT "from") + COUNT(DISTINCT "to") - 
  COUNT(DISTINCT CASE WHEN "from" = "to" THEN "from" END) as active_addresses
FROM {{tx_table}}
WHERE {{block_time_field}} > NOW() - INTERVAL '24' hour

-- BTC
SELECT 
  COUNT(DISTINCT input_address) + COUNT(DISTINCT output_address) as active_addresses
FROM bitcoin.transactions
WHERE block_time > NOW() - INTERVAL '24' hour

-- SOL
SELECT 
  COUNT(DISTINCT signer) + COUNT(DISTINCT account_keys) as active_addresses
FROM solana.transactions
WHERE block_time > NOW() - INTERVAL '24' hour
```
- SQL 可以直接去重统计
- **所有链都支持**
- 结论：**推荐（唯一可行方案）**

---

### 6. TVL（总锁仓价值）
**需求**: $1.47B ↑2.1%

#### 各链支持情况

| 链 | 是否有 DeFi | RPC 方案 | Dune/API 方案 | 推荐方案 |
|----|-----------|---------|---------------|---------|
| **ETH/BSC/Polygon** | ✅ 有大量 DeFi | ❌ 不可行 | ✅ 完全支持 | **Dune/DefiLlama** |
| **BTC** | ⚠️ 无原生 DeFi，但有 L2/闪电网络 | ❌ 不适用 | ⚠️ 需使用替代指标 | **Lightning 容量或 L2 TVL** |
| **SOL** | ✅ 有 DeFi 生态 | ❌ 不可行 | ✅ 完全支持 | **Dune/DefiLlama** |

#### BTC 链上的 TVL 类似概念

虽然 BTC L1 没有原生 DeFi，但存在以下类似 TVL 的概念：

1. **闪电网络（Lightning Network）容量**
   - **定义**: 锁定在闪电网络公共支付通道中的 BTC 总量
   - **含义**: 反映 BTC 作为支付网络的承载能力
   - **获取方式**: 
     - API: `https://mempool.space/api/v1/lightning/statistics/latest`
     - 或通过 LND 节点 RPC（需要专门的闪电网络节点）
   - **可行性**: ⚠️ 需第三方 API，RPC 无法直接获取

2. **比特币 Layer 2 与侧链 TVL**
   - **定义**: 跨链桥接到 Stacks、Rootstock (RSK)、Merlin Chain、B² Network 等 L2 的 BTC 价值
   - **含义**: 反映比特币生态 DeFi 的活跃度
   - **获取方式**: 
     - DefiLlama API: `https://api.llama.fi/protocols`（筛选 Bitcoin 生态）
     - 或分别调用各 L2 链的 RPC 查询锁定合约余额
   - **可行性**: ⚠️ 需第三方聚合 API 或分别查询各 L2

3. **时间锁定的 BTC**
   - **定义**: 通过时间锁脚本（Time-locked Scripts）锁定的 BTC
   - **含义**: 反映长期持有或质押的 BTC 数量
   - **获取方式**: 需解析 UTXO 的脚本类型，RPC 方案复杂
   - **可行性**: ❌ RPC 方案不可行，需专业索引器

#### 实现方案对比

**RPC 方案**:
- 需要遍历所有 DeFi 协议合约
- 需要识别协议类型（DEX、Lending、Staking 等）
- 需要获取代币价格
- **BTC 无法通过 RPC 获取 TVL**
- 结论：**所有链都不可行**

**Dune/API 方案**:
```sql
-- EVM 链 & SOL: 使用 Dune 的 DeFi TVL 抽象表
SELECT 
  SUM(tvl_usd) as total_tvl
FROM defi.tvl
WHERE chain = '{{namespace}}'
  AND date = CURRENT_DATE

-- BTC: 使用替代指标（Lightning 容量或 L2 TVL）
-- 方案 1: 通过 DefiLlama API 获取 Bitcoin 生态 TVL
-- 方案 2: 通过 Mempool.space API 获取 Lightning 容量
-- 方案 3: 返回 0 或 N/A（如果不需要显示）
```
- Dune 已有预计算的 DeFi TVL 数据（EVM/SOL）
- **BTC 需使用替代指标或第三方 API**
- 结论：**推荐（BTC 使用 Lightning 容量或 L2 TVL 作为替代）**

---

### 7. Nakamoto 系数
**需求**: 7-10

#### 各链支持情况

| 链 | 共识机制 | RPC 方案 | Dune 方案 | 推荐方案 |
|----|---------|---------|-----------|---------|
| **ETH** | PoS (验证者) | ❌ 不可行 | ⚠️ 需确认数据 | **Dune（需确认）** |
| **BSC/Polygon** | PoS (验证者) | ❌ 不可行 | ⚠️ 需确认数据 | **Dune（需确认）** |
| **BTC** | PoW (矿工) | ❌ 不可行 | ⚠️ 需确认数据 | **Dune（需确认）或 N/A** |
| **SOL** | PoS (验证者) | ❌ 不可行 | ⚠️ 需确认数据 | **Dune（需确认）** |

#### 实现方案对比

**RPC 方案**:
- RPC 无法获取验证者/节点数据
- 所有链都不可行
- 结论：**所有链都不可行**

**Dune 方案**:
```sql
-- ETH: 查询验证者质押数据
SELECT 
  COUNT(*) as nakamoto_coefficient
FROM (
  SELECT 
    validator,
    SUM(stake) as total_stake,
    SUM(SUM(stake)) OVER (ORDER BY SUM(stake) DESC) as cumulative_stake
  FROM ethereum.validators
  GROUP BY validator
  HAVING cumulative_stake <= (SELECT SUM(stake) * 0.33 FROM ethereum.validators)
)

-- BTC: 查询矿池算力分布（如果有数据）
SELECT 
  COUNT(*) as nakamoto_coefficient
FROM (
  SELECT 
    pool,
    SUM(hashrate) as total_hashrate,
    SUM(SUM(hashrate)) OVER (ORDER BY SUM(hashrate) DESC) as cumulative_hashrate
  FROM bitcoin.mining_pools
  GROUP BY pool
  HAVING cumulative_hashrate <= (SELECT SUM(hashrate) * 0.33 FROM bitcoin.mining_pools)
)

-- SOL: 查询验证者质押数据
SELECT 
  COUNT(*) as nakamoto_coefficient
FROM (
  SELECT 
    validator,
    SUM(stake) as total_stake,
    SUM(SUM(stake)) OVER (ORDER BY SUM(stake) DESC) as cumulative_stake
  FROM solana.validators
  GROUP BY validator
  HAVING cumulative_stake <= (SELECT SUM(stake) * 0.33 FROM solana.validators)
)
```
- Dune 可能有验证者数据，但需要确认表结构
- 不同链的共识机制不同（PoS vs PoW）
- **BTC 是 PoW，可能需要查询矿池数据而非验证者数据**
- 结论：**部分可行，需要确认 Dune 数据可用性**

---

## 实现方案总结（按链分类）

| 指标 | ETH/BSC/Polygon | BTC | SOL | 推荐方案 |
|------|----------------|-----|-----|---------|
| **Block Time Delay** | ✅ RPC | ✅ RPC | ✅ RPC | RPC（已实现） |
| **Gas Price** | ✅ RPC (Gwei) | ✅ RPC (sat/vB) | ✅ RPC (Lamports) | RPC（已实现，BTC/SOL 使用替代指标） |
| **TPS** | ✅ Dune | ✅ Dune | ✅ RPC 或 Dune | Dune（SOL 可用 RPC） |
| **24h 链上成交量** | ✅ Dune | ✅ Dune | ✅ Dune | Dune（唯一可行） |
| **活跃地址数** | ✅ Dune | ✅ Dune | ✅ Dune | Dune（唯一可行） |
| **TVL** | ✅ Dune/DefiLlama | ⚠️ Lightning/L2 TVL | ✅ Dune/DefiLlama | Dune/API（BTC 使用替代指标） |
| **Nakamoto 系数** | ⚠️ Dune（需确认） | ⚠️ Dune（需确认） | ⚠️ Dune（需确认） | Dune（需确认数据可用性） |

## 调研评分（重新评估）

### 综合评分：8.0/10

**评分标准：**
- **10分**: 完美调研，所有链都有明确方案，替代指标完整
- **8-9分**: 优秀调研，大部分链有方案，少量遗漏
- **6-7分**: 合格调研，基本覆盖，但有明显遗漏
- **<6分**: 不合格调研，大量遗漏或错误

**扣分项：**
1. **-0.5 分**: 初始调研未明确说明各链支持情况（已补充）
2. **-0.5 分**: TPS 未充分调研 SOL 的 RPC 原生支持（`getRecentPerformanceSamples`）
3. **-0.5 分**: TVL 未明确说明 BTC 无 DeFi 的情况（已补充）
4. **-0.5 分**: Nakamoto 系数未区分 PoS 和 PoW 的不同实现方式

**加分项：**
1. **+0.5 分**: Gas Price 成功找到 BTC/SOL 的替代指标（sat/vB 和 Lamports）
2. **+0.5 分**: 明确了 RPC 和 Dune 的适用场景
3. **+0.5 分**: 补充了各链支持情况矩阵

**改进后：**
1. ✅ 已补充各链支持情况矩阵（ETH/BSC/Polygon/BTC/SOL）
2. ✅ 已明确 BTC/SOL 的替代指标（Gas Price → 费用率/优先费）
3. ✅ 已说明 BTC 无 DeFi 的特殊情况（TVL 返回 0）
4. ✅ 已区分不同链的共识机制（PoS vs PoW）
5. ⚠️ TPS 的 SOL RPC 方案需要进一步验证
6. ⚠️ Nakamoto 系数需要确认 Dune 数据可用性

---

## 实施建议

### 阶段 1: 核心指标（推荐优先实现）
1. **TPS** - Dune SQL 查询
2. **活跃地址数** - Dune SQL 查询
3. **24h 链上成交量** - Dune SQL 查询（需要价格表关联）

### 阶段 2: 高级指标
4. **TVL** - Dune DeFi 抽象表
5. **Nakamoto 系数** - Dune 验证者数据（需先确认数据可用性）

### 注意事项
- 所有 Dune 查询都需要支持参数化（EVM 链）或链特定查询（BTC/SOL）
- 需要处理数据延迟（Dune 通常有 15-30 分钟延迟）
- 建议在 Worker 中实现缓存（1-5 分钟），减少 Dune API 调用
