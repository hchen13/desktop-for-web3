# Cloudflare Worker 项目结构建议

## 推荐方案：Worker 代码放在项目根目录（与 `src/` 平级）

### 推荐目录结构

```
desktop_for_web3/
├── src/                          # Extension 源代码
│   ├── components/
│   ├── services/                 # Extension 中的服务层
│   │   ├── binance/
│   │   ├── rate-monitor/
│   │   └── chain-monitor/        # 链上监控服务
│   │       └── apiClient.ts      # 调用 Worker 的客户端
│   └── ...
│
├── worker/                        # Cloudflare Worker 代码（推荐位置）
│   ├── src/
│   │   ├── index.ts              # Worker 入口
│   │   ├── routes/
│   │   │   ├── dune.ts           # Dune API 代理
│   │   │   ├── etherscan.ts      # Etherscan API 代理
│   │   │   └── coinmarketcap.ts  # CoinMarketCap API 代理
│   │   ├── utils/
│   │   │   ├── auth.ts           # API KEY 管理
│   │   │   ├── cache.ts          # 缓存逻辑
│   │   │   └── rateLimit.ts      # 限流逻辑
│   │   └── types.ts              # 共享类型定义
│   ├── wrangler.toml             # Worker 配置文件
│   ├── package.json              # Worker 依赖
│   └── tsconfig.json             # Worker TypeScript 配置
│
├── shared/                        # 可选：共享类型和工具（如果需要）
│   └── types/
│       └── api.ts                # Extension 和 Worker 共享的类型
│
├── package.json                  # 根 package.json（workspace 管理）
├── vite.config.ts                # Extension 构建配置
├── tsconfig.json                 # Extension TypeScript 配置
└── ...
```

## 为什么选择这个结构？

### ✅ 优点

1. **清晰的职责分离**
   - `src/` = Extension 前端代码
   - `worker/` = 后端代理服务
   - 逻辑上完全分离，易于理解

2. **独立的构建流程**
   - Worker 使用 `wrangler` 构建和部署
   - Extension 使用 `vite` 构建
   - 互不干扰，不会产生构建冲突

3. **独立的依赖管理**
   - Worker 可能有自己的依赖（如 `@cloudflare/workers-types`）
   - Extension 的依赖不会影响 Worker
   - 可以分别优化 bundle 大小

4. **符合最佳实践**
   - 符合 monorepo 的常见结构
   - 符合 Cloudflare Worker 项目的标准布局
   - 便于 CI/CD 分别部署

5. **环境变量隔离**
   - Worker 的 `wrangler.toml` 管理 Worker 的环境变量
   - Extension 的配置独立管理
   - API KEY 只在 Worker 中存储

### ⚠️ 不推荐放在 `src/` 内的原因

1. **构建冲突**
   - Vite 可能会尝试处理 Worker 代码
   - 需要额外配置排除规则
   - 增加构建复杂度

2. **类型配置冲突**
   - Extension 使用 DOM 类型
   - Worker 使用 Cloudflare Workers 运行时类型
   - 放在一起需要复杂的 TypeScript 配置

3. **部署混淆**
   - Worker 和 Extension 有不同的部署目标
   - 放在一起容易混淆部署流程

## 替代方案：放在 `src/worker/`（不推荐）

如果坚持放在 `src/` 内，需要：

1. **修改 `vite.config.ts`** 排除 Worker 代码：
```typescript
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['worker/**'],
    },
  },
});
```

2. **修改 `tsconfig.json`** 为 Worker 创建单独的配置：
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types"],
    "lib": ["ES2020"]
  },
  "include": ["src/worker"]
}
```

3. **在 `package.json`` 中添加 Worker 构建脚本**：
```json
{
  "scripts": {
    "worker:dev": "wrangler dev --config src/worker/wrangler.toml",
    "worker:deploy": "wrangler deploy --config src/worker/wrangler.toml"
  }
}
```

**结论：** 虽然可行，但增加了配置复杂度，不推荐。

## 推荐的实现步骤

### 1. 创建 Worker 目录结构

```bash
mkdir -p worker/src/{routes,utils}
touch worker/src/index.ts
touch worker/wrangler.toml
touch worker/package.json
touch worker/tsconfig.json
```

### 2. 配置 Worker 项目

**`worker/package.json`**:
```json
{
  "name": "desktop-for-web3-worker",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {},
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20231218.0",
    "typescript": "^5.3.0",
    "wrangler": "^3.19.0"
  }
}
```

**`worker/wrangler.toml`**:
```toml
name = "desktop-for-web3-api-proxy"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
# 环境变量在 Cloudflare Dashboard 中设置
# 或使用 wrangler secret put

[env.production]
name = "desktop-for-web3-api-proxy"

[env.staging]
name = "desktop-for-web3-api-proxy-staging"
```

**`worker/tsconfig.json`**:
```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "ESNext",
    "lib": ["ES2021"],
    "moduleResolution": "bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"],
  "exclude": ["node_modules"]
}
```

### 3. 在 Extension 中创建 API 客户端

**`src/services/chain-monitor/apiClient.ts`**:
```typescript
/**
 * Worker API 客户端
 * 所有需要 API KEY 的请求都通过 Worker 代理
 */

const WORKER_URL = import.meta.env.PROD
  ? 'https://desktop-for-web3-api-proxy.your-subdomain.workers.dev'
  : 'http://localhost:8787'; // 本地开发时使用 wrangler dev

export interface WorkerRequest {
  endpoint: string;
  method?: 'GET' | 'POST';
  params?: Record<string, any>;
  body?: any;
}

export async function callWorkerAPI<T = any>(
  request: WorkerRequest
): Promise<T> {
  const url = new URL(request.endpoint, WORKER_URL);
  
  if (request.params) {
    Object.entries(request.params).forEach(([key, value]) => {
      url.searchParams.append(key, String(value));
    });
  }

  const response = await fetch(url.toString(), {
    method: request.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    body: request.body ? JSON.stringify(request.body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Worker API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

// 便捷方法
export const workerAPI = {
  // Dune API 代理
  dune: {
    executeQuery: (queryId: string, params?: Record<string, any>) =>
      callWorkerAPI({
        endpoint: '/api/dune/execute',
        method: 'POST',
        body: { queryId, params },
      }),
  },

  // Etherscan API 代理
  etherscan: {
    getGasOracle: (chain: string) =>
      callWorkerAPI({
        endpoint: `/api/etherscan/gas-oracle`,
        params: { chain },
      }),
  },

  // CoinMarketCap API 代理
  coinmarketcap: {
    getQuotes: (symbols: string[]) =>
      callWorkerAPI({
        endpoint: '/api/coinmarketcap/quotes',
        params: { symbols: symbols.join(',') },
      }),
  },
};
```

### 4. 根目录 package.json 配置（可选：workspace）

如果需要统一管理，可以使用 npm workspaces：

**根目录 `package.json`**:
```json
{
  "name": "desktop-for-web3",
  "version": "0.1.0",
  "private": true,
  "workspaces": [
    ".",
    "worker"
  ],
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "worker:dev": "cd worker && npm run dev",
    "worker:deploy": "cd worker && npm run deploy"
  }
}
```

## 开发工作流

### 本地开发

1. **启动 Extension 开发服务器**:
```bash
npm run dev
```

2. **启动 Worker 开发服务器**（另一个终端）:
```bash
cd worker
npm run dev
# 或从根目录: npm run worker:dev
```

3. **Extension 调用本地 Worker**:
   - Worker 默认运行在 `http://localhost:8787`
   - 在 `apiClient.ts` 中配置本地 URL

### 部署流程

1. **部署 Worker**:
```bash
cd worker
npm run deploy
```

2. **构建 Extension**:
```bash
npm run build
```

3. **更新 Extension 中的 Worker URL**:
   - 更新 `apiClient.ts` 中的 `WORKER_URL`
   - 或使用环境变量

## 环境变量管理

### Worker 环境变量（API KEY）

**开发环境**:
```bash
cd worker
wrangler secret put DUNE_API_KEY
wrangler secret put ETHERSCAN_API_KEY
wrangler secret put COINMARKETCAP_API_KEY
```

**生产环境**:
- 在 Cloudflare Dashboard 中设置
- 或使用 `wrangler secret put --env production`

### Extension 环境变量

**`vite.config.ts`**:
```typescript
export default defineConfig({
  define: {
    'import.meta.env.WORKER_URL': JSON.stringify(
      process.env.WORKER_URL || 'https://your-worker.workers.dev'
    ),
  },
});
```

## 总结

**推荐结构：**
```
worker/          # Cloudflare Worker 代码（与 src/ 平级）
src/            # Extension 代码
```

**关键点：**
- ✅ Worker 独立目录，独立构建
- ✅ 清晰的职责分离
- ✅ 便于独立部署和维护
- ✅ 符合最佳实践

**下一步：**
1. 创建 `worker/` 目录结构
2. 配置 `wrangler.toml` 和 `package.json`
3. 实现 Worker 路由和 API 代理
4. 在 Extension 中创建 API 客户端
