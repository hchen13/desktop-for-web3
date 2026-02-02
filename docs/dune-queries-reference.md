# Dune 参数化查询 SQL 参考

使用参数化查询，每个指标只需创建一个查询，通过参数支持所有链。

## 在 Dune 中设置参数

创建查询时，在查询编辑器下方点击 **"Add parameter"**，添加以下参数：

- `namespace` (Text) - 链的命名空间，如 `ethereum`, `bitcoin`, `solana`, `bnb`, `polygon`
- `block_number_field` (Text) - 区块号字段名，如 `number`, `height`, `slot`
- `block_time_field` (Text) - 区块时间字段名，如 `time`, `block_time`
- `block_table` (Text) - 区块表名，如 `ethereum.blocks`
- `tx_table` (Text) - 交易表名，如 `ethereum.transactions`
- `value_divisor` (Number) - 值转换除数，如 `1000000000000000000` (1e18) 或 `100000000` (1e8)

---

## 指标 1: 最新区块延迟

```sql
SELECT 
  MAX({{block_number_field}}) as block_number,
  to_unixtime(MAX({{block_time_field}})) as latest_block_time,
  date_diff('second', MAX({{block_time_field}}), NOW()) as delay_seconds
FROM {{block_table}}
WHERE {{block_time_field}} > NOW() - INTERVAL '1' hour
```

**参数默认值示例（Ethereum）：**
- `namespace`: `ethereum`
- `block_number_field`: `number`
- `block_time_field`: `time`
- `block_table`: `ethereum.blocks`

---

## 指标 2: Gas 价格（仅 EVM 链）

```sql
SELECT 
  AVG(gas_price) / 1e9 as avg_gas_gwei,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY gas_price) / 1e9 as median_gas_gwei,
  MIN(gas_price) / 1e9 as min_gas_gwei,
  MAX(gas_price) / 1e9 as max_gas_gwei
FROM {{tx_table}}
WHERE block_time > NOW() - INTERVAL '10' minute
```

**参数默认值示例（Ethereum）：**
- `tx_table`: `ethereum.transactions`

---

## 指标 3: TPS（最近1小时）

```sql
SELECT 
  COUNT(*) as tx_count,
  COUNT(*) / 3600.0 as tps
FROM {{tx_table}}
WHERE block_time > NOW() - INTERVAL '1' hour
```

**参数默认值示例（Ethereum）：**
- `tx_table`: `ethereum.transactions`

---

## 指标 4: 活跃地址数（24小时）

```sql
SELECT 
  COUNT(DISTINCT "from") + COUNT(DISTINCT "to") as active_addresses
FROM {{tx_table}}
WHERE block_time > NOW() - INTERVAL '24' hour
```

**参数默认值示例（Ethereum）：**
- `tx_table`: `ethereum.transactions`

---

## 指标 7: 鲸鱼警报

```sql
SELECT 
  hash, "from", "to",
  value / {{value_divisor}} as amount,
  block_time
FROM {{tx_table}}
WHERE value > CASE 
    WHEN '{{namespace}}' = 'ethereum' THEN 500 * 1e18
    WHEN '{{namespace}}' = 'bitcoin' THEN 10 * 1e8
    WHEN '{{namespace}}' = 'bnb' THEN 1000 * 1e18
    WHEN '{{namespace}}' = 'polygon' THEN 10000 * 1e18
    ELSE 1000 * 1e18
  END
  AND block_time > NOW() - INTERVAL '1' hour
ORDER BY value DESC
LIMIT 10
```

**参数默认值示例（Ethereum）：**
- `namespace`: `ethereum`
- `tx_table`: `ethereum.transactions`
- `value_divisor`: `1000000000000000000` (1e18)

---

## 指标 8: 最新区块信息

```sql
SELECT 
  {{block_number_field}} as block_number,
  to_unixtime({{block_time_field}}) as block_time,
  date_diff('second', {{block_time_field}}, NOW()) as seconds_ago
FROM {{block_table}}
ORDER BY {{block_number_field}} DESC
LIMIT 1
```

**参数默认值示例（Ethereum）：**
- `block_number_field`: `number`
- `block_time_field`: `time`
- `block_table`: `ethereum.blocks`

---

## 使用说明

1. **创建参数化查询**：在 Dune 平台创建查询时，使用 `{{parameter_name}}` 语法
2. **设置参数默认值**：为每个参数设置默认值（建议使用 Ethereum 的配置）
3. **保存查询**：保存后获取 query_id
4. **在代码中传递参数**：Worker 会自动根据链类型传递正确的参数值

## 优势

- ✅ **只需创建 6 个查询**（而不是 27 个）
- ✅ **易于维护**：修改指标逻辑只需更新一个查询
- ✅ **易于扩展**：添加新链只需更新参数映射
- ✅ **解耦设计**：链配置与查询逻辑分离
