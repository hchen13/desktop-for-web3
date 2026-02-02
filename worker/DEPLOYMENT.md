# Cloudflare Worker 部署指南

## 部署前准备

### 1. 确保已安装 Wrangler CLI

```bash
npm install -g wrangler
# 或
npm install --save-dev wrangler
```

### 2. 登录 Cloudflare

```bash
cd worker
wrangler login
```

### 3. 配置 Secrets（API Keys）

**重要**: 必须在 `worker/` 目录下运行命令。

```bash
cd worker

# 设置 Dune API Key（必需）
wrangler secret put DUNE_API_KEY

# 设置 Alchemy API Key（可选，用于 ETH/Polygon RPC）
wrangler secret put ALCHEMY_API_KEY

# 其他 API Keys（如果使用）
wrangler secret put ETHERSCAN_API_KEY
wrangler secret put COINMARKETCAP_API_KEY
```

**注意**: 
- 运行命令后，会提示输入 API Key 的值
- Secrets 不会显示在代码中，安全存储在 Cloudflare
- 如果遇到 "Required Worker name missing" 错误，确保在 `worker/` 目录下运行

---

## 部署步骤

### 方式 1: 使用 npm 脚本（推荐）

```bash
cd worker

# 部署到生产环境
npm run deploy

# 部署到开发环境
wrangler deploy --env development
```

### 方式 2: 直接使用 wrangler

```bash
cd worker

# 部署到生产环境
wrangler deploy

# 部署到开发环境
wrangler deploy --env development
```

---

## 部署后验证

### 1. 获取 Worker URL

部署成功后，Wrangler 会显示 Worker URL，格式类似：
```
https://desktop-for-web3-api-proxy.your-subdomain.workers.dev
```

### 2. 测试健康检查

```bash
curl https://desktop-for-web3-api-proxy.your-subdomain.workers.dev/health
```

### 3. 测试接口

```bash
# 测试 Block Time Delay
curl "https://desktop-for-web3-api-proxy.your-subdomain.workers.dev/api/blockchain-monitor/block-time-delay?chain=eth"

# 测试 TVL（所有链）
curl "https://desktop-for-web3-api-proxy.your-subdomain.workers.dev/api/blockchain-monitor/tvl"

# 测试所有指标
curl "https://desktop-for-web3-api-proxy.your-subdomain.workers.dev/api/blockchain-monitor/metrics?chain=eth"
```

---

## 环境配置

### 开发环境

- Worker 名称: `desktop-for-web3-api-proxy-dev`
- 用于测试和开发

### 生产环境

- Worker 名称: `desktop-for-web3-api-proxy`
- 用于正式使用

---

## 常见问题

### 1. 部署失败：类型错误

**问题**: TypeScript 类型检查失败

**解决**: 类型错误不会影响部署，Wrangler 会自动处理。如果确实需要修复，运行：
```bash
cd worker
npm install
```

### 2. 部署失败：Secret 未设置

**问题**: `Missing DUNE_API_KEY environment variable`

**解决**: 运行 `wrangler secret put DUNE_API_KEY` 设置 API Key

### 3. 接口返回 500 错误

**问题**: 部署后接口调用失败

**解决**: 
1. 检查 Cloudflare Dashboard 中的 Worker 日志
2. 确认所有必需的 Secrets 已设置
3. 检查 Dune Query IDs 是否正确配置

### 4. CORS 错误

**问题**: 从浏览器调用接口时出现 CORS 错误

**解决**: Worker 已配置 CORS 支持，如果仍有问题，检查请求头是否正确

---

## 更新部署

### 更新代码后重新部署

```bash
cd worker
npm run deploy
```

### 更新 Secrets

```bash
cd worker
wrangler secret put DUNE_API_KEY  # 会提示输入新值
```

### 查看部署历史

```bash
cd worker
wrangler deployments list
```

---

## 监控和日志

### 查看实时日志

```bash
cd worker
wrangler tail
```

### 在 Cloudflare Dashboard 查看

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 Workers & Pages
3. 选择你的 Worker
4. 查看 Logs 和 Metrics

---

## 回滚部署

如果需要回滚到之前的版本：

```bash
cd worker
wrangler deployments list  # 查看部署历史
wrangler rollback [deployment-id]  # 回滚到指定版本
```

---

## 性能优化

### 缓存策略

Worker 已实现以下缓存：
- Dune 查询结果: 5 分钟
- DefiLlama TVL 数据: 5 分钟
- RPC 数据: 无缓存（实时数据）

### 速率限制

默认无速率限制，如需添加：
1. 创建 KV Namespace
2. 在 `wrangler.toml` 中配置
3. 启用 `rateLimit.ts` 中的速率限制逻辑

---

## 安全建议

1. **不要提交 Secrets**: 使用 `wrangler secret` 管理，不要写入代码
2. **使用环境隔离**: 开发和生产环境使用不同的 Worker
3. **监控异常**: 定期检查 Worker 日志，发现异常请求
4. **限制访问**: 考虑添加 API Key 验证（如果需要）

---

## 相关文档

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Wrangler CLI 文档](https://developers.cloudflare.com/workers/wrangler/)
- [API 接口文档](../design/widgets/blockchain-monitor/api-documentation.md)
