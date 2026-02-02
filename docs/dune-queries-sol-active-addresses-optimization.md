# SOL Active Addresses 查询优化方案

## 当前查询（效率较低）

```sql
SELECT 
  COUNT(DISTINCT address) as active_addresses
FROM (
  SELECT signer as address
  FROM solana.transactions
  WHERE block_time > NOW() - INTERVAL '24' hour
  UNION
  SELECT account_key as address
  FROM solana.transactions
  CROSS JOIN UNNEST(account_keys) AS t(account_key)
  WHERE block_time > NOW() - INTERVAL '24' hour
) AS all_addresses
```

### 问题分析

1. **UNION 去重开销**：UNION 会自动去重，需要额外的排序和比较操作
2. **重复时间过滤**：两个子查询都执行相同的时间过滤
3. **CROSS JOIN UNNEST 效率**：展开数组会产生大量中间行
4. **嵌套查询**：外层 COUNT(DISTINCT) 需要扫描所有数据

---

## 优化方案 1：使用 UNION ALL + 外层去重（推荐）

**原理**：UNION ALL 不去重，减少中间处理开销，在外层统一去重

```sql
SELECT 
  COUNT(DISTINCT address) as active_addresses
FROM (
  SELECT signer as address
  FROM solana.transactions
  WHERE block_time > NOW() - INTERVAL '24' hour
  
  UNION ALL
  
  SELECT account_key as address
  FROM solana.transactions
  CROSS JOIN UNNEST(account_keys) AS t(account_key)
  WHERE block_time > NOW() - INTERVAL '24' hour
) AS all_addresses
```

**优势**：
- UNION ALL 比 UNION 快（不需要去重）
- 外层 COUNT(DISTINCT) 可以更高效地处理去重
- 减少中间结果集的处理

---

## 优化方案 2：先过滤再展开（推荐）

**原理**：先过滤时间范围，减少需要展开的数据量

```sql
SELECT 
  COUNT(DISTINCT address) as active_addresses
FROM (
  SELECT signer as address
  FROM solana.transactions
  WHERE block_time > NOW() - INTERVAL '24' hour
  
  UNION ALL
  
  SELECT account_key as address
  FROM (
    SELECT account_keys
    FROM solana.transactions
    WHERE block_time > NOW() - INTERVAL '24' hour
  ) AS filtered_txs
  CROSS JOIN UNNEST(account_keys) AS t(account_key)
) AS all_addresses
```

**优势**：
- 先过滤再展开，减少 UNNEST 的数据量
- 子查询可以更好地利用索引

---

## 优化方案 3：使用 LATERAL JOIN（如果 DuneSQL 支持）

**原理**：LATERAL JOIN 可以更高效地处理相关子查询

```sql
SELECT 
  COUNT(DISTINCT address) as active_addresses
FROM (
  SELECT signer as address
  FROM solana.transactions
  WHERE block_time > NOW() - INTERVAL '24' hour
  
  UNION ALL
  
  SELECT account_key as address
  FROM solana.transactions t
  CROSS JOIN LATERAL UNNEST(t.account_keys) AS account_key
  WHERE t.block_time > NOW() - INTERVAL '24' hour
) AS all_addresses
```

**注意**：需要确认 DuneSQL（Trino）是否支持 LATERAL JOIN

---

## 优化方案 4：分离统计后合并（最优化，但需要两次查询）

**原理**：分别统计 signer 和 account_keys，然后合并去重

```sql
WITH signer_addresses AS (
  SELECT DISTINCT signer as address
  FROM solana.transactions
  WHERE block_time > NOW() - INTERVAL '24' hour
),
account_key_addresses AS (
  SELECT DISTINCT account_key as address
  FROM solana.transactions
  CROSS JOIN UNNEST(account_keys) AS t(account_key)
  WHERE block_time > NOW() - INTERVAL '24' hour
)
SELECT 
  COUNT(DISTINCT address) as active_addresses
FROM (
  SELECT address FROM signer_addresses
  UNION ALL
  SELECT address FROM account_key_addresses
) AS all_addresses
```

**优势**：
- 每个 CTE 可以独立优化
- 可以并行处理
- 减少最终 UNION 的数据量

---

## 优化方案 5：使用 APPROX_DISTINCT（近似去重，最快）

**原理**：使用近似算法，牺牲少量精度换取性能

```sql
SELECT 
  APPROX_DISTINCT(address) as active_addresses
FROM (
  SELECT signer as address
  FROM solana.transactions
  WHERE block_time > NOW() - INTERVAL '24' hour
  
  UNION ALL
  
  SELECT account_key as address
  FROM solana.transactions
  CROSS JOIN UNNEST(account_keys) AS t(account_key)
  WHERE block_time > NOW() - INTERVAL '24' hour
) AS all_addresses
```

**优势**：
- APPROX_DISTINCT 比 COUNT(DISTINCT) 快得多
- 对于大数据集，误差通常 < 1%
- 适合监控场景（不需要精确值）

**注意**：需要确认 DuneSQL 是否支持 APPROX_DISTINCT

---

## 推荐方案

**首选：方案 1（UNION ALL + COUNT(DISTINCT)）**
- 简单直接
- 性能提升明显
- 兼容性好

**备选：方案 5（APPROX_DISTINCT）**
- 如果精度要求不高（监控场景通常可以接受）
- 性能最优

**测试顺序**：
1. 先测试方案 1
2. 如果还不够快，尝试方案 5
3. 如果 DuneSQL 支持，可以尝试方案 3

---

## 性能对比预期

| 方案 | 预期执行时间 | 精度 | 复杂度 |
|------|------------|------|--------|
| 原始查询 | 60+ 秒 | 100% | 高 |
| 方案 1 | 30-40 秒 | 100% | 中 |
| 方案 2 | 25-35 秒 | 100% | 中 |
| 方案 3 | 20-30 秒 | 100% | 中 |
| 方案 4 | 15-25 秒 | 100% | 高 |
| 方案 5 | 10-15 秒 | ~99% | 低 |

---

## 实施步骤

1. 在 Dune 中创建新查询
2. 使用**方案 1**的 SQL
3. 测试执行时间
4. 如果超时，尝试**方案 5**
5. 更新 query_id 到配置中
