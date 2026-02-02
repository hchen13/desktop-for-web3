# BTC 和 SOL 链的 Block Time Delay 查询 SQL

## 架构说明

- **EVM 链（ETH, BSC, Polygon）**：使用参数化查询（共享 query_id: 6565581），通过参数传递链信息
- **非 EVM 链（BTC, SOL）**：由于表结构不同，需要创建单独的硬编码查询

---

## BTC 和 SOL 查询

由于不同链的表结构不同，需要为 BTC 和 SOL 创建单独的查询。

## BTC (Bitcoin) 查询

**查询名称：** `Block Time Delay - Bitcoin`

**SQL：**
```sql
SELECT 
  MAX(height) as block_number,
  to_unixtime(MAX(time)) as latest_block_time,
  date_diff('second', MAX(time), NOW()) as delay_seconds
FROM bitcoin.blocks
WHERE time > NOW() - INTERVAL '1' hour
```

**说明：**
- Bitcoin 表使用 `height` 作为区块号字段
- Bitcoin 表使用 `time` 作为时间字段（不是 `block_time`）
- 表名：`bitcoin.blocks`

**创建步骤：**
1. 在 Dune 中创建新查询
2. 粘贴上述 SQL
3. 保存查询（建议勾选 "Make Private"）
4. 获取 query_id（URL 中的第一个数字）
5. 更新 `worker/src/config/duneQueryIds.ts` 中的 `blockTimeDelay.btc`

---

## SOL (Solana) 查询

**查询名称：** `Block Time Delay - Solana`

**SQL（尝试方案 1 - 使用 time 字段）：**
```sql
SELECT 
  MAX(slot) as block_number,
  to_unixtime(MAX(time)) as latest_block_time,
  date_diff('second', MAX(time), NOW()) as delay_seconds
FROM solana.blocks
WHERE time > NOW() - INTERVAL '1' hour
```

**SQL（如果方案 1 失败，尝试方案 2 - 使用 timestamp 字段）：**
```sql
SELECT 
  MAX(slot) as block_number,
  to_unixtime(MAX(timestamp)) as latest_block_time,
  date_diff('second', MAX(timestamp), NOW()) as delay_seconds
FROM solana.blocks
WHERE timestamp > NOW() - INTERVAL '1' hour
```

**说明：**
- Solana 表使用 `slot` 作为区块号字段
- Solana 表的时间字段可能是 `time` 或 `timestamp`（不是 `block_time`）
- 表名：`solana.blocks`
- **建议**：在 Dune 的 Data Explorer 中查看 `solana.blocks` 表的实际字段名

**创建步骤：**
1. 在 Dune 中创建新查询
2. 粘贴上述 SQL
3. 保存查询（建议勾选 "Make Private"）
4. 获取 query_id（URL 中的第一个数字）
5. 更新 `worker/src/config/duneQueryIds.ts` 中的 `blockTimeDelay.sol`

---

## 配置更新

创建查询后，更新 `worker/src/config/duneQueryIds.ts`：

```typescript
export const METRIC_QUERY_IDS: Record<string, Record<string, number>> = {
  blockTimeDelay: {
    eth: 6565581, // ✅ 已配置（参数化查询，支持所有 EVM 链）
    btc: YOUR_BTC_QUERY_ID, // 填入 BTC 查询 ID（硬编码查询）
    sol: YOUR_SOL_QUERY_ID, // 填入 SOL 查询 ID（硬编码查询）
    // BSC 和 Polygon 使用 ETH 的参数化查询，无需单独配置
  },
  // ...
};
```

## 测试结果

✅ **ETH 链**：使用参数化查询（query_id: 6565581），测试通过  
✅ **BSC 链**：使用参数化查询（共享 ETH 的 query_id），测试通过  
✅ **Polygon 链**：使用参数化查询（共享 ETH 的 query_id），测试通过  
✅ **BTC 链**：使用硬编码查询（query_id: 6565798），测试通过  
✅ **SOL 链**：使用硬编码查询（query_id: 6565820），测试通过
