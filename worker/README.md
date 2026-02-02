# Desktop for Web3 - Cloudflare Worker API Proxy

Cloudflare Worker 服务，用于安全地代理所有需要 API KEY 的第三方 API 调用。

## 功能

- ✅ **Dune Analytics API** 代理
- ✅ **Etherscan API** 代理（支持多链）
- ✅ **CoinMarketCap API** 代理
- ✅ **响应缓存**（减少 API 调用）
- ✅ **速率限制**（防止滥用）
- ✅ **CORS 支持**（允许 Extension 调用）

## 快速开始

### 1. 安装依赖

```bash
cd worker
npm install
```

### 2. 配置环境变量

设置 API Keys（使用 Cloudflare Workers Secrets）：

**重要：** 必须在 `worker/` 目录下运行命令。

```bash
cd worker

# 开发环境（默认）
wrangler secret put DUNE_API_KEY
wrangler secret put ETHERSCAN_API_KEY
wrangler secret put COINMARKETCAP_API_KEY

# 生产环境（明确指定环境）
wrangler secret put DUNE_API_KEY --env production
wrangler secret put ETHERSCAN_API_KEY --env production
wrangler secret put COINMARKETCAP_API_KEY --env production
```

**如果遇到 "Required Worker name missing" 错误：**
1. 确保在 `worker/` 目录下运行命令
2. 检查 `wrangler.toml` 文件是否存在且包含 `name` 字段
3. 或者使用 `--name` 参数：`wrangler secret put DUNE_API_KEY --name desktop-for-web3-api-proxy`

### 3. 本地开发

```bash
npm run dev
```

Worker 将在 `http://localhost:8787` 启动。

### 4. 部署

```bash
# 部署到生产环境
npm run deploy

# 部署到测试环境
npm run deploy:staging
```

## API 端点

### Dune Analytics

#### 执行查询
```
POST /api/dune/execute
Body: {
  "queryId": "123456",
  "parameters": { "param1": "value1" }
}
```

#### 获取查询结果
```
GET /api/dune/result/{executionId}
```

### Etherscan

#### 获取 Gas Oracle
```
GET /api/etherscan/gas-oracle?chain=ethereum
```

支持的链：`ethereum`, `polygon`, `bsc`, `arbitrum`, `optimism`, `base`, `avalanche`, `fantom`

#### 获取最新区块
```
GET /api/etherscan/latest-block?chain=ethereum
```

### CoinMarketCap

#### 获取加密货币报价
```
GET /api/coinmarketcap/quotes?symbols=BTC,ETH,SOL
```

## 缓存策略

- **Dune 查询结果**: 5 分钟
- **Gas Oracle**: 30 秒
- **最新区块**: 15 秒
- **CoinMarketCap 报价**: 1 分钟

## 速率限制

默认限制：每分钟 100 次请求（需要配置 KV Namespace）

## 健康检查

```
GET /health
```

## 项目结构

```
worker/
├── src/
│   ├── index.ts              # Worker 入口
│   ├── routes/               # API 路由
│   │   ├── dune.ts
│   │   ├── etherscan.ts
│   │   └── coinmarketcap.ts
│   ├── utils/                # 工具函数
│   │   ├── auth.ts          # API KEY 管理
│   │   ├── cache.ts          # 缓存逻辑
│   │   ├── cors.ts           # CORS 处理
│   │   └── rateLimit.ts      # 速率限制
│   └── types.ts              # 类型定义
├── wrangler.toml             # Worker 配置
├── package.json
└── tsconfig.json
```

## 开发注意事项

1. **环境变量**: 使用 `wrangler secret` 管理敏感信息，不要提交到代码仓库
2. **本地开发**: Worker 会自动从 `.dev.vars` 读取环境变量（如果存在）
3. **缓存**: 使用 Cloudflare Workers Cache API，无需额外配置
4. **类型检查**: 运行 `npm run type-check` 检查 TypeScript 类型

## 相关文档

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Wrangler CLI 文档](https://developers.cloudflare.com/workers/wrangler/)
