# Cloudflare Worker 设置指南

## 快速开始

### 1. 安装 Worker 依赖

```bash
npm run worker:install
# 或
cd worker && npm install
```

### 2. 配置 API Keys

在 Cloudflare Workers 中设置环境变量（Secrets）：

**重要：** 必须在 `worker/` 目录下运行命令，或使用 `--name` 参数指定 Worker 名称。

```bash
cd worker

# 方式 1: 在 worker 目录下运行（推荐）
wrangler secret put DUNE_API_KEY
wrangler secret put ETHERSCAN_API_KEY
wrangler secret put COINMARKETCAP_API_KEY

# 方式 2: 明确指定环境（推荐用于生产环境）
wrangler secret put DUNE_API_KEY --env production
wrangler secret put ETHERSCAN_API_KEY --env production
wrangler secret put COINMARKETCAP_API_KEY --env production

# 方式 3: 使用 --name 参数（如果不在 worker 目录）
wrangler secret put DUNE_API_KEY --name desktop-for-web3-api-proxy
```

**注意：** 如果遇到 "Required Worker name missing" 错误：
1. 确保在 `worker/` 目录下运行命令
2. 或者使用 `--name` 参数明确指定 Worker 名称
3. 或者使用 `--env` 参数指定环境

**注意：** 你需要先登录 Cloudflare：

```bash
wrangler login
```

### 3. 本地开发

启动 Worker 开发服务器：

```bash
npm run worker:dev
# 或
cd worker && npm run dev
```

Worker 将在 `http://localhost:8787` 启动。

**同时启动 Extension 开发服务器（另一个终端）：**

```bash
npm run dev
```

### 4. 测试 Worker API

```bash
# 健康检查
curl http://localhost:8787/health

# 获取 Ethereum Gas Oracle
curl "http://localhost:8787/api/etherscan/gas-oracle?chain=ethereum"

# 获取最新区块
curl "http://localhost:8787/api/etherscan/latest-block?chain=ethereum"
```

### 5. 部署 Worker

```bash
# 部署到生产环境
npm run worker:deploy

# 部署到测试环境
npm run worker:deploy:staging
```

部署成功后，你会得到一个 Worker URL，例如：
```
https://desktop-for-web3-api-proxy.your-subdomain.workers.dev
```

### 6. 更新 Extension 中的 Worker URL

编辑 `src/services/chain-monitor/apiClient.ts`：

```typescript
const WORKER_URL = import.meta.env.PROD
  ? 'https://desktop-for-web3-api-proxy.your-subdomain.workers.dev' // 更新为你的 Worker URL
  : 'http://localhost:8787';
```

## API 端点文档

### Dune Analytics

#### 执行查询
```typescript
import { workerAPI } from '@/services/chain-monitor';

const result = await workerAPI.dune.executeQuery('123456', {
  param1: 'value1'
});
```

#### 获取查询结果
```typescript
const result = await workerAPI.dune.getQueryResult('execution-id');
```

### Etherscan

#### 获取 Gas Oracle
```typescript
const gasOracle = await workerAPI.etherscan.getGasOracle('ethereum');
// 返回: { SafeGasPrice, ProposeGasPrice, FastGasPrice, ... }
```

支持的链：`ethereum`, `polygon`, `bsc`, `arbitrum`, `optimism`, `base`, `avalanche`, `fantom`

#### 获取最新区块
```typescript
const block = await workerAPI.etherscan.getLatestBlock('ethereum');
// 返回: { blockNumber: 12345678, hex: '0x...' }
```

### CoinMarketCap

#### 获取加密货币报价
```typescript
const quotes = await workerAPI.coinmarketcap.getQuotes(['BTC', 'ETH', 'SOL']);
// 返回: { BTC: {...}, ETH: {...}, SOL: {...} }
```

## 缓存策略

Worker 自动缓存响应以减少 API 调用：

- **Dune 查询结果**: 5 分钟
- **Gas Oracle**: 30 秒
- **最新区块**: 15 秒
- **CoinMarketCap 报价**: 1 分钟

响应头中包含缓存状态：
- `X-Cache-Status: HIT` - 从缓存返回
- `X-Cache-Status: MISS` - 新请求

## 速率限制

默认限制：每分钟 100 次请求（需要配置 KV Namespace）

如需启用速率限制：

1. 在 Cloudflare Dashboard 创建 KV Namespace
2. 在 `wrangler.toml` 中添加：

```toml
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "your-kv-namespace-id"
```

## 故障排查

### Worker 无法启动

1. 检查是否已安装依赖：`cd worker && npm install`
2. 检查是否已登录：`wrangler whoami`
3. 检查 `wrangler.toml` 配置是否正确

### API 调用失败

1. 检查 API Keys 是否已设置：`wrangler secret list`
2. 检查 Worker URL 是否正确
3. 查看 Worker 日志：在 Cloudflare Dashboard 中查看

### CORS 错误

Worker 已配置 CORS 支持，如果仍有问题：
1. 检查请求的 Origin 头
2. 确认 Worker 的 CORS 配置允许你的 Extension ID

## 开发工作流

### 同时开发 Extension 和 Worker

**终端 1 - Worker 开发：**
```bash
npm run worker:dev
```

**终端 2 - Extension 开发：**
```bash
npm run dev
```

Extension 会自动连接到本地 Worker（`http://localhost:8787`）。

### 类型检查

```bash
cd worker
npm run type-check
```

## 相关文件

- `worker/README.md` - Worker 项目详细文档
- `docs/worker-project-structure.md` - 项目结构说明
- `src/services/chain-monitor/apiClient.ts` - Extension API 客户端
