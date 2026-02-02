# Binance API 调研文档

日期：2026-01-31

## 1. 概述

本文档记录 Binance 网站使用的币种基础信息与价格数据 API，为 Watchlist 组件提供数据源参考。

**API 基础地址**: `https://www.binance.com`

---

## 2. API 调用流程

```
┌─────────────────────────────────────────────────────────────────┐
│                        数据获取流程                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │  币种基础信息    │ -> │  CMC ID 映射    │ -> │  价格数据    │ │
│  │  get-product-   │    │  cmc/map        │    │  cmc/quotes │ │
│  │  static         │    │                 │    │  /latest    │ │
│  └─────────────────┘    └─────────────────┘    └─────────────┘ │
│         ↓                      ↓                     ↓          │
│    symbol/name          symbol -> CMC ID      price, change    │
│    (BTC, Bitcoin)       (BTC -> 1)           24h vol, mcap     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**流程说明**:
1. **方案A**: 获取币种 symbol 与 name 列表
2. **方案B**: 获取 symbol → CMC ID 映射关系
3. **方案C**: 根据 CMC ID 获取实时价格、涨跌幅、交易量、市值

---

## 3. 币种基础信息 API

### 3.1 接口说明

获取 Binance 上架所有币种的 symbol 与 name 映射关系。

**端点**：`GET /bapi/asset/v2/friendly/asset-service/product/get-product-static`

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| includeEtf | boolean | 否 | 是否包含 ETF 产品，默认 `true`（当前无实际效果） |

**请求头**：

```
Accept-Encoding: gzip, deflate, br
User-Agent: Mozilla/5.0
```

### 2.2 响应结构

```json
{
  "code": "000000",
  "message": null,
  "messageDetail": null,
  "data": [
    {
      "s": "BTCUSDT",     // 交易对 symbol
      "st": "TRADING",    // 交易状态
      "b": "BTC",         // base asset symbol (币种代码) ✅
      "q": "USDT",        // quote asset symbol (计价币种)
      "i": "0.00001000",  // 最小交易量
      "ts": "0.01",       // 最小价格精度
      "an": "Bitcoin",   // asset name (币种全名) ✅
      "qn": "TetherUS",  // quote name (计价币种全名)
      "pm": "USDT",       // 计价币种
      "pn": "USDT",       // 计价币种名称
      "cs": 19806450,     // ? (可能跟交易相关)
      "tags": ["pow", "mining-zone", "Payments"],  // 标签
      "st": "TRADING",    // 状态
      "etf": false       // 是否 ETF
    }
  ]
}
```

**字段说明**：

| 字段 | 说明 | 示例 |
|------|------|------|
| `b` | base asset symbol，币种代码 | `BTC`, `ETH` |
| `an` | asset name，币种全名 | `Bitcoin`, `Ethereum` |
| `q` | quote asset symbol，计价币种代码 | `USDT`, `BTC` |
| `qn` | quote name，计价币种全名 | `TetherUS`, `Bitcoin` |
| `tags` | 币种标签 | `["DeFi", "Layer1_Layer2"]` |
| `st` | 交易状态 | `TRADING`, `BREAK` |

**数据规模**：返回 1,152 个交易对，去重后约 447 个唯一币种。

### 2.3 示例请求 & 响应

**请求**：
```bash
curl -H "Accept-Encoding: gzip" \
  "https://www.binance.com/bapi/asset/v2/friendly/asset-service/product/get-product-static?includeEtf=true"
```

**响应**（简化）：
```json
{
  "code": "000000",
  "data": [
    {
      "s": "BTCUSDT",
      "b": "BTC",
      "an": "Bitcoin",
      "q": "USDT",
      "qn": "TetherUS",
      "tags": ["pow", "mining-zone", "Payments"]
    },
    {
      "s": "ETHUSDT",
      "b": "ETH",
      "an": "Ethereum",
      "q": "USDT",
      "qn": "TetherUS",
      "tags": ["Layer1_Layer2", "pos", "mining-zone"]
    },
    {
      "s": "BNBUSDT",
      "b": "BNB",
      "an": "BNB",
      "q": "USDT",
      "qn": "TetherUS",
      "tags": ["Layer1_Layer2", "BSC", "pos", "bnbchain"]
    }
  ]
}
```

---

## 4. CMC ID 映射 API

### 4.1 接口说明

获取 Binance symbol → CoinMarketCap ID 的映射关系。

**端点**：`GET /bapi/composite/v1/public/promo/cmc/cryptocurrency/map`

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| symbol | string | 否 | 按 symbol 筛选，支持大小写不敏感、多值逗号分隔（如 `BTC,ETH`） |
| limit | number | 否 | 返回数量限制，**只在未传 symbol 时生效**，默认返回全量（~9000 条） |

**请求头**：

```
Accept-Encoding: gzip, deflate, br
User-Agent: Mozilla/5.0
```

### 4.2 响应结构

```json
{
  "code": "000000",
  "data": {
    "body": {
      "data": [
        {
          "id": 1,                  // CMC ID ✅
          "name": "Bitcoin",        // 币种全名
          "symbol": "BTC",          // 币种代码 ✅
          "slug": "bitcoin",
          "rank": 1,
          "is_active": 1
        },
        {
          "id": 1027,
          "name": "Ethereum",
          "symbol": "ETH",
          "slug": "ethereum",
          "rank": 2,
          "is_active": 1
        }
      ]
    }
  }
}
```

**字段说明**：

| 字段 | 说明 | 示例 |
|------|------|------|
| `id` | CMC ID，用于查询价格数据 | `1` (BTC) |
| `symbol` | 币种代码 | `BTC`, `ETH` |
| `name` | 币种全名 | `Bitcoin`, `Ethereum` |
| `rank` | CMC 排名 | `1`, `2` |
| `is_active` | 是否活跃 | `1` |

**注意**：
- 同一个 symbol 可能对应**多个 CMC ID**（不同链上的代币），需要选择 `rank` 最小且 `is_active=1` 的作为主币种。
- 示例：`symbol=BTC` 返回 11 条结果，包括主网 BTC（id=1, rank=1）以及各链上的 BTC 代币。
- 压缩行为：limit>=10 时启用 gzip，否则返回未压缩数据。

### 4.3 示例请求 & 响应

**请求**（查询 BTC）：
```bash
curl -s "https://www.binance.com/bapi/composite/v1/public/promo/cmc/cryptocurrency/map?symbol=BTC" \
  | gunzip
```

**响应**（简化）：
```json
{
  "code": "000000",
  "data": {
    "body": {
      "data": [
        {
          "id": 1,
          "name": "Bitcoin",
          "symbol": "BTC",
          "rank": 1
        }
      ]
    }
  }
}
```

**常用 CMC ID 映射表**：

| Symbol | CMC ID | Name |
|--------|--------|------|
| BTC | 1 | Bitcoin |
| ETH | 1027 | Ethereum |
| USDT | 825 | Tether USDt |
| BNB | 1839 | BNB |
| SOL | 5426 | Solana |
| XRP | 52 | XRP |
| ADA | 2010 | Cardano |
| DOGE | 74 | Dogecoin |
| AVAX | 5805 | Avalanche |
| DOT | 6636 | Polkadot |
| LINK | 1975 | Chainlink |
| UNI | 7083 | Uniswap |
| MATIC | 3890 | Polygon |

---

## 5. 价格数据 API (CoinMarketCap 代理)

### 5.1 接口说明

获取单个或多个币种的实时价格、涨跌幅、交易量、市值等数据。

**端点**：`GET /bapi/composite/v1/public/promo/cmc/cryptocurrency/quotes/latest`

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 条件必填 | CMC ID，多个用逗号分隔（如 `1,1027,2010`），与 symbol 二选一 |
| symbol | string | 条件必填 | 币种代码，多个用逗号分隔（如 `BTC,ETH`），与 id 二选一 |

> **重要**：`id` 与 `symbol` 参数**二选一**，必须传其中一个。
>
> - 使用 `id`：精确查询，返回对象结构（key 为 CMC ID）
> - 使用 `symbol`：返回该 symbol 的所有链上币种（数组），通常有多条结果
>
> 常用 CMC ID：
> - BTC = 1
> - ETH = 1027
> - USDT = 825
> - BNB = 1839
> - SOL = 5426

**请求头**：

```
Accept-Encoding: gzip, deflate, br
User-Agent: Mozilla/5.0
```

### 3.2 响应结构

```json
{
  "code": "000000",
  "data": {
    "body": {
      "data": {
        "1": {              // CMC ID 作为 key
          "id": 1,
          "name": "Bitcoin",     // 币种全名 ✅
          "symbol": "BTC",      // 币种代码 ✅
          "slug": "bitcoin",
          "circulating_supply": 19982590,
          "total_supply": 19982590,
          "max_supply": 21000000,
          "cmc_rank": 1,
          "quote": {
            "USD": {
              "price": 83826.45,                      // 当前价格 ✅
              "percent_change_1h": -0.04,             // 1h 涨跌幅 ✅
              "percent_change_24h": 1.59,             // 24h 涨跌幅 ✅
              "percent_change_7d": -6.38,              // 7d 涨跌幅
              "percent_change_30d": -4.20,             // 30d 涨跌幅
              "volume_24h": 53948404138.49,          // 24h 交易量 ✅
              "market_cap": 1675069509769.89,          // 市值 ✅
              "fully_diluted_market_cap": 1760355374611.99,
              "market_cap_dominance": 59.12,          // 市场占有率
              "last_updated": "2026-01-31T06:21:00.000Z"
            }
          }
        }
      }
    }
  }
}
```

**字段说明**：

| 字段 | 说明 | 示例 |
|------|------|------|
| `id` | CMC ID | `1` (BTC) |
| `name` | 币种全名 | `Bitcoin` |
| `symbol` | 币种代码 | `BTC` |
| `quote.USD.price` | 当前价格（美元） | `83826.45` |
| `quote.USD.percent_change_1h` | 1小时涨跌幅（百分比） | `-0.04` |
| `quote.USD.percent_change_24h` | 24小时涨跌幅 | `1.59` |
| `quote.USD.volume_24h` | 24小时交易量（美元） | `53948404138.49` |
| `quote.USD.market_cap` | 市值（美元） | `1675069509769.89` |
| `quote.USD.circulating_supply` | 流通供应量 | `19982590` |
| `quote.USD.total_supply` | 总供应量 | `19982590` |
| `quote.USD.max_supply` | 最大供应量（若有） | `21000000` |

### 3.3 示例请求 & 响应

**请求 1**（使用 CMC ID 获取 BTC、ETH、BNB）：
```bash
curl -s "https://www.binance.com/bapi/composite/v1/public/promo/cmc/cryptocurrency/quotes/latest?id=1,1027,1839" \
  | gunzip
```

**请求 2**（使用 symbol 获取 BTC）：
```bash
curl -s "https://www.binance.com/bapi/composite/v1/public/promo/cmc/cryptocurrency/quotes/latest?symbol=BTC" \
  | gunzip
```

> **注意**：使用 `symbol=BTC` 会返回 11 条结果（各链上的 BTC 代币），需自行选择主网币（`cmc_rank=1` 且 `platform=null`）。

**响应 1**（使用 id，简化）：
```bash
curl -H "Accept-Encoding: gzip" \
  "https://www.binance.com/bapi/composite/v1/public/promo/cmc/cryptocurrency/quotes/latest?id=1,1027,1839"
```

**响应**（简化）：
```json
{
  "code": "000000",
  "data": {
    "body": {
      "data": {
        "1": {
          "id": 1,
          "name": "Bitcoin",
          "symbol": "BTC",
          "quote": {
            "USD": {
              "price": 83826.45,
              "percent_change_24h": 1.59,
              "volume_24h": 53948404138.49,
              "market_cap": 1675069509769.89,
              "circulating_supply": 19982590,
              "total_supply": 19982590,
              "max_supply": 21000000
            }
          }
        },
        "1027": {
          "id": 1027,
          "name": "Ethereum",
          "symbol": "ETH",
          "quote": {
            "USD": {
              "price": 2697.35,
              "percent_change_24h": -1.28,
              "volume_24h": 33008593143.77,
              "market_cap": 325600000000000,
              "circulating_supply": 12052587554
            }
          }
        },
        "1839": {
          "id": 1839,
          "name": "BNB",
          "symbol": "BNB",
          "quote": {
            "USD": {
              "price": 851.57,
              "percent_change_24h": 0.87,
              "volume_24h": 2460209456.78,
              "market_cap": 116140000000000
            }
          }
        }
      }
    }
  }
}
```

---

## 6. 使用建议

### 6.1 获取币种列表

使用 `get-product-static` API，提取 `b` 和 `an` 字段：

```bash
curl -s "https://www.binance.com/bapi/asset/v2/friendly/asset-service/product/get-product-static?includeEtf=true" \
  | gunzip \
  | jq -r '.data[] | "\(.b)=\(.an)"' | sort -u
```

### 6.2 获取 Symbol → CMC ID 映射

```bash
curl -s "https://www.binance.com/bapi/composite/v1/public/promo/cmc/cryptocurrency/map?symbol=BTC" \
  | gunzip \
  | jq '.data.body.data[0].id'
```

### 6.3 获取价格数据

需要先知道 CMC ID，然后调用 `quotes/latest`：

```bash
curl -s "https://www.binance.com/bapi/composite/v1/public/promo/cmc/cryptocurrency/quotes/latest?id=1" \
  | gunzip \
  | jq '.data.body.data["1"].quote.USD'
```

### 6.4 完整流程示例

获取 BTC 的完整信息：

```bash
# 1. 获取 CMC ID
CMC_ID=$(curl -s "https://www.binance.com/bapi/composite/v1/public/promo/cmc/cryptocurrency/map?symbol=BTC" \
  | gunzip | jq -r '.data.body.data[0].id')

# 2. 获取价格数据
curl -s "https://www.binance.com/bapi/composite/v1/public/promo/cmc/cryptocurrency/quotes/latest?id=$CMC_ID" \
  | gunzip | jq ".data.body.data[\"$CMC_ID\"].quote.USD"
```

### 6.5 注意事项

1. **内部 API**：这些是 Binance 内部使用的 BAPI，非公开 API，未来可能变化。
2. **CMC ID 映射**：维护 Binance symbol → CMC ID 的映射表。
3. **Symbol 多链问题**：
   - 同一 symbol 可能对应多个 CMC ID（不同链上的代币）
   - 使用 `cmc/map` 时取 `rank` 最小且 `is_active=1` 且 `platform=null` 的作为主网币
   - 使用 `quotes/latest?symbol=xxx` 会返回数组，需自行过滤
4. **Gzip 压缩**：大部分响应为 gzip 压缩，小数据量（limit<10）时不压缩。
5. **请求频率**：建议适当缓存，避免频繁请求。

---

## 7. Binance.US API（备用源）

### 7.1 概述

对于无法访问 `binance.com` 的美国用户，可使用 `binance.us` 作为备用数据源。

**API 基础地址**: `https://www.binance.us`

**与 Binance.com 的差异**:
- Binance.US 只有约 **198 个唯一币种**（Binance.com 有 447 个）
- API 结构完全不同，使用 `/gateway/` 路径
- 一个综合 API 即可获取全部数据（symbol/name/price/volume/mcap）

### 7.2 综合价格 API

**端点**：`GET /gateway/trade/friendly/v1/market/prices`

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| timeFrame | string | 否 | 时间框架，默认 `DAY`，支持：`DAY`、`HOUR`、`WEEK`、`MONTH` |

**请求头**：

```
Accept: */*
```

**注意**：此 API **不需要**特殊的请求头或 Cookie，可直接调用。

### 7.3 响应结构

```json
{
  "code": "000000",
  "data": {
    "productDataList": [
      {
        "baseAsset": "BTC",                    // 币种代码 ✅
        "baseAssetName": "Bitcoin",           // 币种全名 ✅
        "cmcId": 1,                           // CMC ID ✅
        "close": 81194.61,                    // 当前价格 ✅
        "dailyQuoteVolume": 36783.41,         // 24h 交易量 ✅
        "marketCap": 1657941493317.71,        // 市值 ✅
        "open": 80500.23,                     // 开盘价（可计算涨跌幅）
        "high": 82000.00,                     // 24h 最高价
        "low": 79800.50,                      // 24h 最低价
        "symbol": "BTCUSDT",                  // 交易对
        "quoteAsset": "USDT",                 // 计价币种
        "status": 1                           // 状态
      }
    ],
    "globalData": [
      {
        "totalMarketCap": 2730227982809.65,
        "totalMarketCapYesterdayPercentageChange": -3.26
      }
    ]
  }
}
```

### 7.4 示例请求 & 响应

**请求**（获取所有币种数据）：
```bash
curl -s "https://www.binance.us/gateway/trade/friendly/v1/market/prices?timeFrame=DAY"
```

**请求**（提取 BTC 价格）：
```bash
curl -s "https://www.binance.us/gateway/trade/friendly/v1/market/prices?timeFrame=DAY" \
  | jq '.data.productDataList[] | select(.baseAsset == "BTC")'
```

**响应**：
```json
{
  "baseAsset": "BTC",
  "baseAssetName": "Bitcoin",
  "cmcId": 1,
  "close": 81194.61,
  "dailyQuoteVolume": 36783.41,
  "marketCap": 1657941493317.71,
  "symbol": "BTCUSDT"
}
```

### 7.5 Binance.US 常用币种覆盖

| Symbol | Name | CMC ID | 可用 |
|--------|------|--------|------|
| BTC | Bitcoin | 1 | ✅ |
| ETH | Ethereum | 1027 | ✅ |
| BNB | BNB | 1839 | ✅ |
| SOL | Solana | 5426 | ✅ |
| XRP | XRP | 52 | ✅ |
| ADA | Cardano | 2010 | ✅ |
| DOGE | Dogecoin | 74 | ✅ |
| AVAX | Avalanche | 5805 | ✅ |
| DOT | Polkadot | 6636 | ✅ |
| LINK | Chainlink | 1975 | ✅ |
| MATIC | Polygon | 3890 | ✅ |

**注**：Binance.US 币种覆盖范围约为主站的 44%（198/447），但主流币种基本齐全。

### 7.6 降级策略

```
┌─────────────────────────────────────────────────────────────┐
│                    数据源降级策略                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    尝试失败    ┌─────────────┐           │
│  │ Binance.com │ ─────────────> │ Binance.US  │           │
│  │ (3个API)    │                │ (1个API)    │           │
│  └─────────────┘                └─────────────┘           │
│       ↓                              ↓                     │
│   447 币种                       198 币种                  │
│   symbol/name                   symbol/name               │
│   + CMC ID                      + CMC ID                  │
│   + price                       + price                   │
│   + volume                      + volume                  │
│   + market cap                  + market cap              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**降级实现建议**:
1. 优先使用 Binance.com API
2. 捕获网络错误/超时/404
3. 自动切换到 Binance.US API
4. 若 Binance.US 也不可用，使用本地缓存

---

## 8. 实际测试发现

### 8.1 参数行为实测

| API | 参数 | 实测行为 |
|-----|------|----------|
| get-product-static | `includeEtf` | true/false 结果相同（当前无 ETF 产品） |
| cmc/map | `symbol=BTC` | 返回 11 条（多链 BTC） |
| cmc/map | `symbol=BTC,ETH` | 返回 16 条（支持多值） |
| cmc/map | `symbol=btc` | 返回 11 条（大小写不敏感） |
| cmc/map | `limit=5` | 返回 5 条（未压缩） |
| cmc/map | `limit=100` | 返回 100 条（gzip 压缩） |
| cmc/map | `symbol=BTC&limit=3` | 返回 11 条（**limit 被忽略**） |
| cmc/map | 不传参数 | 返回 8971 条（全量） |
| cmc/quotes/latest | `id=1` | 返回对象（key 为 "1"） |
| cmc/quotes/latest | `symbol=BTC` | 返回数组（11 条多链数据） |
| cmc/quotes/latest | 不传参数 | 返回 400 错误 |
| Binance.US | `timeFrame=DAY` | ✅ 返回 257 条 |
| Binance.US | `timeFrame=HOUR/WEEK/MONTH` | ✅ 均有效 |
| Binance.US | `timeFrame=INVALID` | ❌ code="000002" |

### 8.2 关键发现

1. **Symbol 多链问题**：`BTC` symbol 在 CMC 数据中存在 11 条记录（主网 + 各链代币），需通过 `platform=null` 且 `cmc_rank` 最小来识别主网币。

2. **Limit 参数限制**：`cmc/map` 的 `limit` 参数只在**未传 symbol** 时生效。

3. **压缩阈值**：数据量较小时（limit<10）不启用 gzip，否则需 gunzip 解析。

4. **两种查询方式**：`cmc/quotes/latest` 支持 `id`（精确）和 `symbol`（模糊，返回数组）两种参数。
