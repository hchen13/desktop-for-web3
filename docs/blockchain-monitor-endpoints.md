# 链上监控 API 端点测试文档

## 开发服务器启动

### 1. 启动 Worker 开发服务器

```bash
cd worker
npm run dev
```

Worker 将在 `http://localhost:8787` 启动。

### 2. 启动 Extension 开发服务器（可选，用于前端测试）

```bash
npm run dev
```

Extension 将在 `http://localhost:5173` 启动。

## API 端点列表

所有端点都支持 `chain` 查询参数，可选值：`btc`, `eth`, `sol`, `bsc`, `polygon`，默认为 `eth`。

### 基础端点

#### 1. 健康检查
```
GET http://localhost:8787/health
```

**响应示例：**
```json
{
  "success": true,
  "message": "Worker is healthy",
  "timestamp": 1705123456789
}
```

---

### 链上监控端点

#### 2. 获取所有监控指标（推荐）
```
GET http://localhost:8787/api/blockchain-monitor/metrics?chain=eth
```

**参数：**
- `chain` (可选): 链 ID，默认 `eth`

**响应示例：**
```json
{
  "success": true,
  "data": {
    "blockTimeDelay": {
      "blockNumber": 21234567,
      "latestBlockTime": "2024-01-15T10:30:00Z",
      "delaySeconds": 14
    },
    "gasPrice": {
      "avgGasGwei": 19.2,
      "medianGasGwei": 18.5,
      "minGasGwei": 15.0,
      "maxGasGwei": 25.0
    },
    "tps": {
      "txCount": 53280,
      "tps": 14.8
    },
    "activeAddresses": {
      "activeAddresses": 42300
    },
    "tvl": {
      "tvl": 0,
      "message": "TVL data requires DeFi protocol aggregation. This is a placeholder."
    },
    "nakamotoCoefficient": {
      "nakamotoCoefficient": 0,
      "message": "Nakamoto coefficient requires validator data. This is a placeholder."
    },
    "whaleAlerts": {
      "alerts": [],
      "count": 0
    },
    "latestBlockInfo": {
      "blockNumber": 21234567,
      "blockTime": "2024-01-15T10:30:00Z",
      "secondsAgo": 12
    }
  },
  "timestamp": 1705123456789
}
```

---

#### 3. 指标 1: 最新区块延迟 / Block Time Delay
```
GET http://localhost:8787/api/blockchain-monitor/block-time-delay?chain=eth
```

**响应示例：**
```json
{
  "success": true,
  "data": {
    "blockNumber": 21234567,
    "latestBlockTime": "2024-01-15T10:30:00Z",
    "delaySeconds": 14
  },
  "timestamp": 1705123456789
}
```

**测试命令：**
```bash
curl "http://localhost:8787/api/blockchain-monitor/block-time-delay?chain=eth"
curl "http://localhost:8787/api/blockchain-monitor/block-time-delay?chain=btc"
curl "http://localhost:8787/api/blockchain-monitor/block-time-delay?chain=sol"
```

---

#### 4. 指标 2: 当前 Gas 费 / Gas Price（仅 EVM 链）
```
GET http://localhost:8787/api/blockchain-monitor/gas-price?chain=eth
```

**注意：** 仅支持 EVM 链（eth, bsc, polygon）

**响应示例：**
```json
{
  "success": true,
  "data": {
    "avgGasGwei": 19.2,
    "medianGasGwei": 18.5,
    "minGasGwei": 15.0,
    "maxGasGwei": 25.0
  },
  "timestamp": 1705123456789
}
```

**测试命令：**
```bash
curl "http://localhost:8787/api/blockchain-monitor/gas-price?chain=eth"
curl "http://localhost:8787/api/blockchain-monitor/gas-price?chain=bsc"
curl "http://localhost:8787/api/blockchain-monitor/gas-price?chain=polygon"
```

---

#### 5. 指标 3: TPS（最近1小时）
```
GET http://localhost:8787/api/blockchain-monitor/tps?chain=eth
```

**响应示例：**
```json
{
  "success": true,
  "data": {
    "txCount": 53280,
    "tps": 14.8
  },
  "timestamp": 1705123456789
}
```

**测试命令：**
```bash
curl "http://localhost:8787/api/blockchain-monitor/tps?chain=eth"
curl "http://localhost:8787/api/blockchain-monitor/tps?chain=btc"
curl "http://localhost:8787/api/blockchain-monitor/tps?chain=sol"
```

---

#### 6. 指标 4: 活跃地址数（24小时）
```
GET http://localhost:8787/api/blockchain-monitor/active-addresses?chain=eth
```

**响应示例：**
```json
{
  "success": true,
  "data": {
    "activeAddresses": 42300
  },
  "timestamp": 1705123456789
}
```

**测试命令：**
```bash
curl "http://localhost:8787/api/blockchain-monitor/active-addresses?chain=eth"
curl "http://localhost:8787/api/blockchain-monitor/active-addresses?chain=btc"
```

---

#### 7. 指标 5: TVL（总锁仓价值）
```
GET http://localhost:8787/api/blockchain-monitor/tvl?chain=eth
```

**注意：** 当前为占位实现，需要 DeFi 协议数据聚合

**响应示例：**
```json
{
  "success": true,
  "data": {
    "tvl": 0,
    "message": "TVL data requires DeFi protocol aggregation. This is a placeholder."
  },
  "timestamp": 1705123456789
}
```

---

#### 8. 指标 6: Nakamoto 系数
```
GET http://localhost:8787/api/blockchain-monitor/nakamoto-coefficient?chain=eth
```

**注意：** 当前为占位实现，需要验证者数据

**响应示例：**
```json
{
  "success": true,
  "data": {
    "nakamotoCoefficient": 0,
    "message": "Nakamoto coefficient requires validator data. This is a placeholder."
  },
  "timestamp": 1705123456789
}
```

---

#### 9. 指标 7: 异常事件 / 大额流动警报
```
GET http://localhost:8787/api/blockchain-monitor/whale-alerts?chain=eth
```

**响应示例：**
```json
{
  "success": true,
  "data": {
    "alerts": [
      {
        "hash": "0x...",
        "from": "0x...",
        "to": "0x...",
        "amount": 500.5,
        "blockTime": "2024-01-15T10:25:00Z"
      }
    ],
    "count": 1
  },
  "timestamp": 1705123456789
}
```

**测试命令：**
```bash
curl "http://localhost:8787/api/blockchain-monitor/whale-alerts?chain=eth"
```

---

#### 10. 指标 8: 区块时间 / 最新区块高度
```
GET http://localhost:8787/api/blockchain-monitor/latest-block?chain=eth
```

**响应示例：**
```json
{
  "success": true,
  "data": {
    "blockNumber": 21234567,
    "blockTime": "2024-01-15T10:30:00Z",
    "secondsAgo": 12
  },
  "timestamp": 1705123456789
}
```

**测试命令：**
```bash
curl "http://localhost:8787/api/blockchain-monitor/latest-block?chain=eth"
curl "http://localhost:8787/api/blockchain-monitor/latest-block?chain=btc"
```

---

## 完整测试脚本

创建 `test-endpoints.sh` 文件：

```bash
#!/bin/bash

BASE_URL="http://localhost:8787"

echo "=== 测试链上监控 API 端点 ==="
echo ""

echo "1. 健康检查"
curl -s "${BASE_URL}/health" | jq .
echo ""

echo "2. 获取所有指标 (ETH)"
curl -s "${BASE_URL}/api/blockchain-monitor/metrics?chain=eth" | jq .
echo ""

echo "3. 区块时间延迟 (ETH)"
curl -s "${BASE_URL}/api/blockchain-monitor/block-time-delay?chain=eth" | jq .
echo ""

echo "4. Gas 价格 (ETH)"
curl -s "${BASE_URL}/api/blockchain-monitor/gas-price?chain=eth" | jq .
echo ""

echo "5. TPS (ETH)"
curl -s "${BASE_URL}/api/blockchain-monitor/tps?chain=eth" | jq .
echo ""

echo "6. 活跃地址数 (ETH)"
curl -s "${BASE_URL}/api/blockchain-monitor/active-addresses?chain=eth" | jq .
echo ""

echo "7. 鲸鱼警报 (ETH)"
curl -s "${BASE_URL}/api/blockchain-monitor/whale-alerts?chain=eth" | jq .
echo ""

echo "8. 最新区块 (ETH)"
curl -s "${BASE_URL}/api/blockchain-monitor/latest-block?chain=eth" | jq .
echo ""

echo "=== 测试不同链 ==="
echo ""

echo "BTC - 区块时间延迟"
curl -s "${BASE_URL}/api/blockchain-monitor/block-time-delay?chain=btc" | jq .
echo ""

echo "SOL - TPS"
curl -s "${BASE_URL}/api/blockchain-monitor/tps?chain=sol" | jq .
echo ""

echo "BSC - Gas 价格"
curl -s "${BASE_URL}/api/blockchain-monitor/gas-price?chain=bsc" | jq .
echo ""
```

## 注意事项

1. **Dune API 限制**：
   - 需要先在 Dune 平台创建查询，获得 `query_id`
   - 当前实现使用 SQL 直接执行，可能需要调整为使用预创建的查询 ID
   - API 调用有速率限制，建议使用缓存

2. **数据延迟**：
   - Dune 数据有 1-5 分钟延迟
   - 不适合需要秒级实时性的场景

3. **错误处理**：
   - 所有端点都返回统一的响应格式
   - 错误时 `success: false`，包含 `error` 字段

4. **缓存**：
   - Worker 自动缓存响应
   - 查看响应头 `X-Cache-Status` 了解缓存状态

## 下一步

1. 在 Dune 平台为每个指标创建查询
2. 获取查询 ID 并更新 Worker 代码
3. 测试所有端点
4. 实现 ChainMonitorWidget 组件使用这些数据
