# Blockchain Monitor API 文档

## 概述

Blockchain Monitor API 提供链上监控所需的各种指标数据，支持 5 条主流区块链：**ETH**、**BSC**、**Polygon**、**BTC**、**SOL**。

**Base URL**: `https://desktop-for-web3-api-proxy.your-subdomain.workers.dev`

**本地开发**: `http://localhost:8787`

---

## 通用说明

### 请求格式

所有接口均使用 `GET` 方法，通过 URL 参数传递链信息。

### 响应格式

所有接口返回统一的 JSON 格式：

```json
{
  "success": true,
  "data": {
    // 具体数据
  },
  "timestamp": 1705123456789
}
```

**错误响应：**
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误描述"
  },
  "timestamp": 1705123456789
}
```

### 支持的链

| 链标识 | 链名称 | 说明 |
|--------|--------|------|
| `eth` | Ethereum | 以太坊主网 |
| `bsc` | Binance Smart Chain | 币安智能链 |
| `polygon` | Polygon | Polygon 网络 |
| `btc` | Bitcoin | 比特币主网 |
| `sol` | Solana | Solana 主网 |

---

## 接口列表

### 1. Block Time Delay（最新区块延迟）

**接口**: `GET /api/blockchain-monitor/block-time-delay`

**说明**: 获取最新区块的延迟时间，用于判断链是否正常运行。

**参数**:
- `chain` (required): 链标识，如 `eth`, `bsc`, `polygon`, `btc`, `sol`

**请求示例**:
```bash
curl "https://desktop-for-web3-api-proxy.your-subdomain.workers.dev/api/blockchain-monitor/block-time-delay?chain=eth"
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "blockNumber": 21234567,
    "latestBlockTime": 1705123456,
    "delaySeconds": 5
  },
  "timestamp": 1705123456789
}
```

**字段说明**:
- `blockNumber`: 最新区块号
- `latestBlockTime`: 最新区块时间（Unix 时间戳，秒）
- `delaySeconds`: 延迟秒数（当前时间 - 区块时间）

**数据来源**: RPC（实时数据）

---

### 2. Gas Price（Gas 费）

**接口**: `GET /api/blockchain-monitor/gas-price`

**说明**: 获取当前 Gas 费（EVM 链）或交易费用（非 EVM 链）。

**参数**:
- `chain` (required): 链标识

**请求示例**:
```bash
curl "https://desktop-for-web3-api-proxy.your-subdomain.workers.dev/api/blockchain-monitor/gas-price?chain=eth"
```

**响应示例（EVM 链）**:
```json
{
  "success": true,
  "data": {
    "avgGasGwei": 19.2,
    "medianGasGwei": 18.5,
    "minGasGwei": 15.0,
    "maxGasGwei": 25.0,
    "unit": "gwei"
  },
  "timestamp": 1705123456789
}
```

**响应示例（BTC）**:
```json
{
  "success": true,
  "data": {
    "feeRate": 15.5,
    "unit": "sat/vB"
  },
  "timestamp": 1705123456789
}
```

**响应示例（SOL）**:
```json
{
  "success": true,
  "data": {
    "computeUnitPrice": 5000,
    "unit": "lamports"
  },
  "timestamp": 1705123456789
}
```

**字段说明**:
- **EVM 链**: `avgGasGwei`, `medianGasGwei`, `minGasGwei`, `maxGasGwei`（单位：Gwei）
- **BTC**: `feeRate`（单位：sat/vB）
- **SOL**: `computeUnitPrice`（单位：Lamports）

**数据来源**: RPC（实时数据）

---

### 3. TPS（每秒交易数）

**接口**: `GET /api/blockchain-monitor/tps`

**说明**: 获取最近 1 小时内的平均 TPS（每秒交易数）。

**参数**:
- `chain` (required): 链标识

**请求示例**:
```bash
curl "https://desktop-for-web3-api-proxy.your-subdomain.workers.dev/api/blockchain-monitor/tps?chain=eth"
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "tps": 14.8,
    "txCount": 53280
  },
  "timestamp": 1705123456789
}
```

**字段说明**:
- `tps`: 每秒交易数（浮点数）
- `txCount`: 交易总数（整数）

**数据来源**: 
- EVM 链 + BTC: Dune Analytics
- SOL: RPC（`getRecentPerformanceSamples`）

---

### 4. Active Addresses（活跃地址数）

**接口**: `GET /api/blockchain-monitor/active-addresses`

**说明**: 获取过去 24 小时内的活跃地址数。

**参数**:
- `chain` (required): 链标识

**请求示例**:
```bash
curl "https://desktop-for-web3-api-proxy.your-subdomain.workers.dev/api/blockchain-monitor/active-addresses?chain=eth"
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "activeAddresses": 423000
  },
  "timestamp": 1705123456789
}
```

**字段说明**:
- `activeAddresses`: 活跃地址数（整数）

**数据来源**: Dune Analytics

**注意**: SOL 链的查询可能耗时较长（30-60秒），已优化 SQL 查询性能。

---

### 5. TVL（总锁仓价值）

**接口**: `GET /api/blockchain-monitor/tvl`

**说明**: 获取链的总锁仓价值（Total Value Locked）。

**参数**:
- `chain` (optional): 链标识。如果不传或传 `all`，返回所有链的 TVL

**请求示例（所有链）**:
```bash
curl "https://desktop-for-web3-api-proxy.your-subdomain.workers.dev/api/blockchain-monitor/tvl"
```

**请求示例（单个链）**:
```bash
curl "https://desktop-for-web3-api-proxy.your-subdomain.workers.dev/api/blockchain-monitor/tvl?chain=eth"
```

**响应示例（所有链）**:
```json
{
  "success": true,
  "data": {
    "eth": {
      "tvl": 72064632975.01,
      "tvlUSD": 72064632975.01
    },
    "bsc": {
      "tvl": 6940173560.51,
      "tvlUSD": 6940173560.51
    },
    "polygon": {
      "tvl": 1161100077.27,
      "tvlUSD": 1161100077.27
    },
    "sol": {
      "tvl": 8526436961.19,
      "tvlUSD": 8526436961.19
    },
    "btc": {
      "tvl": 0,
      "tvlUSD": 0,
      "message": "Bitcoin has no native DeFi ecosystem. TVL is not applicable."
    }
  },
  "timestamp": 1705123456789
}
```

**响应示例（单个链）**:
```json
{
  "success": true,
  "data": {
    "tvl": 72064632975.01,
    "tvlUSD": 72064632975.01
  },
  "timestamp": 1705123456789
}
```

**字段说明**:
- `tvl`: 总锁仓价值（USD）
- `tvlUSD`: 总锁仓价值（USD，与 `tvl` 相同）
- **BTC**: 返回 0，因为比特币没有原生 DeFi 生态

**数据来源**: DefiLlama API（无需 API Key）

**优化**: 一次请求返回所有链的 TVL，减少 API 调用次数。

---

### 6. All Metrics（所有指标）

**接口**: `GET /api/blockchain-monitor/metrics`

**说明**: 一次性获取指定链的所有监控指标。

**参数**:
- `chain` (required): 链标识

**请求示例**:
```bash
curl "https://desktop-for-web3-api-proxy.your-subdomain.workers.dev/api/blockchain-monitor/metrics?chain=eth"
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "blockTimeDelay": {
      "blockNumber": 21234567,
      "latestBlockTime": 1705123456,
      "delaySeconds": 5
    },
    "gasPrice": {
      "avgGasGwei": 19.2,
      "medianGasGwei": 18.5,
      "minGasGwei": 15.0,
      "maxGasGwei": 25.0,
      "unit": "gwei"
    },
    "tps": {
      "tps": 14.8,
      "txCount": 53280
    },
    "activeAddresses": {
      "activeAddresses": 423000
    },
    "tvl": {
      "tvl": 72064632975.01,
      "tvlUSD": 72064632975.01
    }
  },
  "timestamp": 1705123456789
}
```

**字段说明**: 包含上述所有指标的数据。

**注意**: 如果某个指标获取失败，该字段可能不存在。

---

## 错误码

| 错误码 | 说明 |
|--------|------|
| `UNSUPPORTED_CHAIN` | 不支持的链标识 |
| `QUERY_ID_NOT_CONFIGURED` | Dune 查询 ID 未配置 |
| `RPC_ERROR` | RPC 调用失败 |
| `DUNE_ERROR` | Dune API 调用失败 |
| `TVL_ERROR` | TVL 数据获取失败 |
| `TPS_ERROR` | TPS 数据获取失败 |
| `ACTIVE_ADDRESSES_ERROR` | 活跃地址数据获取失败 |
| `BLOCK_TIME_DELAY_ERROR` | 区块延迟数据获取失败 |
| `GAS_PRICE_ERROR` | Gas 价格数据获取失败 |

---

## 数据来源总结

| 指标 | 数据来源 | 实时性 | 缓存时间 |
|------|---------|--------|---------|
| Block Time Delay | RPC | 实时 | 无缓存 |
| Gas Price | RPC | 实时 | 无缓存 |
| TPS | Dune / RPC (SOL) | 15-30分钟延迟 | 5分钟 |
| Active Addresses | Dune | 15-30分钟延迟 | 5分钟 |
| TVL | DefiLlama API | 实时 | 5分钟 |

---

## 使用建议

1. **实时监控**: 使用 `block-time-delay` 和 `gas-price` 进行实时监控（RPC 数据）
2. **批量获取**: 使用 `metrics` 接口一次性获取所有指标
3. **TVL 查询**: 使用不带 `chain` 参数的 TVL 接口，一次获取所有链的数据
4. **错误处理**: 所有接口都可能返回错误，需要检查 `success` 字段
5. **缓存策略**: 建议客户端实现缓存，减少 API 调用（特别是 Dune 数据）

---

## 示例代码

### JavaScript/TypeScript

```typescript
const BASE_URL = 'https://desktop-for-web3-api-proxy.your-subdomain.workers.dev';

async function getBlockTimeDelay(chain: string) {
  const response = await fetch(`${BASE_URL}/api/blockchain-monitor/block-time-delay?chain=${chain}`);
  const data = await response.json();
  
  if (data.success) {
    return data.data;
  } else {
    throw new Error(data.error.message);
  }
}

async function getAllTVL() {
  const response = await fetch(`${BASE_URL}/api/blockchain-monitor/tvl`);
  const data = await response.json();
  
  if (data.success) {
    return data.data;
  } else {
    throw new Error(data.error.message);
  }
}

// 使用示例
const ethDelay = await getBlockTimeDelay('eth');
console.log(`ETH 最新区块延迟: ${ethDelay.delaySeconds}秒`);

const allTVL = await getAllTVL();
console.log(`ETH TVL: $${allTVL.eth.tvlUSD}`);
```

### Python

```python
import requests

BASE_URL = 'https://desktop-for-web3-api-proxy.your-subdomain.workers.dev'

def get_block_time_delay(chain: str):
    response = requests.get(f'{BASE_URL}/api/blockchain-monitor/block-time-delay?chain={chain}')
    data = response.json()
    
    if data['success']:
        return data['data']
    else:
        raise Exception(data['error']['message'])

# 使用示例
eth_delay = get_block_time_delay('eth')
print(f"ETH 最新区块延迟: {eth_delay['delaySeconds']}秒")
```

---

## 更新日志

### v1.0.0 (2024-01-20)
- ✅ 实现 Block Time Delay 接口（支持 5 条链）
- ✅ 实现 Gas Price 接口（支持 5 条链）
- ✅ 实现 TPS 接口（支持 5 条链）
- ✅ 实现 Active Addresses 接口（支持 5 条链）
- ✅ 实现 TVL 接口（支持 5 条链，优化为一次请求返回所有链）
- ✅ 优化 SOL Active Addresses 查询性能
- ✅ 移除未实现的接口（Nakamoto Coefficient, Whale Alerts, Latest Block Info）

---

## 技术支持

如有问题或建议，请参考项目文档或提交 Issue。
