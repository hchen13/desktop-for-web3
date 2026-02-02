# TPS 查询 SQL 模板

## 指标说明
TPS (Transactions Per Second) - 每秒交易数，计算最近1小时内的平均TPS。

## EVM 链（ETH/BSC/Polygon）- 参数化查询

### 查询名称
`TPS - EVM Chains (Parameterized)`

### SQL 查询
```sql
SELECT 
  COUNT(*) as tx_count,
  COUNT(*) / 3600.0 as tps
FROM {{tx_table}}
WHERE block_time > NOW() - INTERVAL '1' hour
```

### 参数配置
在 Dune 查询编辑器中添加以下参数：

| 参数名 | 类型 | 默认值（ETH） | 说明 |
|--------|------|--------------|------|
| `tx_table` | Text | `ethereum.transactions` | 交易表名 |

### 参数值映射（用于不同链）

**ETH:**
- `tx_table`: `ethereum.transactions`

**BSC:**
- `tx_table`: `bnb.transactions`

**Polygon:**
- `tx_table`: `polygon.transactions`

### 说明
- EVM 链的交易表（`ethereum.transactions`, `bnb.transactions`, `polygon.transactions`）都使用 `block_time` 字段（不是 `time`）
- 因此 SQL 中直接使用 `block_time`，无需参数化

### 预期返回字段
- `tx_count`: 交易总数（整数）
- `tps`: 每秒交易数（浮点数）

---

## BTC - 硬编码查询

### 查询名称
`TPS - Bitcoin`

### SQL 查询
```sql
SELECT 
  COUNT(*) as tx_count,
  COUNT(*) / 3600.0 as tps
FROM bitcoin.transactions
WHERE block_time > NOW() - INTERVAL '1' hour
```

### 说明
- BTC 使用 `bitcoin.transactions` 表
- 时间字段为 `block_time`（与 EVM 链一致）
- 无需参数，硬编码查询

### 预期返回字段
- `tx_count`: 交易总数（整数）
- `tps`: 每秒交易数（浮点数）

### 注意
根据之前的经验，BTC 的 blocks 表使用 `time` 字段，但 transactions 表可能使用 `block_time`。如果上述 SQL 报错，请尝试：
```sql
SELECT 
  COUNT(*) as tx_count,
  COUNT(*) / 3600.0 as tps
FROM bitcoin.transactions
WHERE time > NOW() - INTERVAL '1' hour
```

---

## SOL - 使用 RPC（无需 Dune 查询）

SOL 链已使用 RPC 方案实现，无需创建 Dune 查询。

---

## 创建步骤

1. **EVM 链查询（参数化）**：
   - 在 Dune 中创建新查询
   - 粘贴 EVM 链的 SQL
   - 添加参数 `tx_table` 和 `block_time_field`
   - 设置默认值为 ETH 的配置
   - 保存查询（建议勾选 "Make Private"）
   - 获取 query_id（URL 中的第一个数字）

2. **BTC 查询（硬编码）**：
   - 在 Dune 中创建新查询
   - 粘贴 BTC 的 SQL
   - 保存查询（建议勾选 "Make Private"）
   - 获取 query_id

3. **配置查询 ID**：
   - 更新 `worker/src/config/duneQueryIds.ts` 中的 `tps` 配置：
   ```typescript
   tps: {
     eth: YOUR_EVM_QUERY_ID,  // 参数化查询，支持所有 EVM 链
     bsc: YOUR_EVM_QUERY_ID,  // 使用相同的参数化查询
     polygon: YOUR_EVM_QUERY_ID, // 使用相同的参数化查询
     btc: YOUR_BTC_QUERY_ID,  // 硬编码查询
     sol: 0, // SOL 使用 RPC，不需要 query ID
   },
   ```
