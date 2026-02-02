# Worker 故障排查指南

## 常见错误及解决方案

### 1. "Required Worker name missing" 错误

**错误信息：**
```
✘ [ERROR] Required Worker name missing. Please specify the Worker name in your Wrangler configuration file, or pass it as an argument with `--name <worker-name>`
```

**原因：**
- 不在 `worker/` 目录下运行命令
- `wrangler.toml` 文件路径不正确
- Wrangler 无法找到配置文件

**解决方案：**

#### 方案 1：在 worker 目录下运行（推荐）

```bash
cd worker
wrangler secret put DUNE_API_KEY
```

#### 方案 2：使用 --name 参数

```bash
# 从任何目录运行
wrangler secret put DUNE_API_KEY --name desktop-for-web3-api-proxy
```

#### 方案 3：使用 --config 参数指定配置文件路径

```bash
# 从项目根目录运行
wrangler secret put DUNE_API_KEY --config worker/wrangler.toml
```

#### 方案 4：使用 --env 参数指定环境

```bash
cd worker
wrangler secret put DUNE_API_KEY --env production
```

### 2. 检查当前工作目录

```bash
# 查看当前目录
pwd

# 应该显示类似：/Users/ethan/playground/desktop_for_web3/worker
# 如果不在 worker 目录，执行：
cd worker
```

### 3. 验证 wrangler.toml 文件

```bash
# 在 worker 目录下检查文件是否存在
ls -la wrangler.toml

# 查看文件内容
cat wrangler.toml
```

确保文件包含：
```toml
name = "desktop-for-web3-api-proxy"
main = "src/index.ts"
compatibility_date = "2024-01-01"
```

### 4. 验证 Wrangler 安装

```bash
# 检查 Wrangler 版本
wrangler --version

# 检查是否已登录
wrangler whoami
```

如果未登录，执行：
```bash
wrangler login
```

## 完整的设置流程（推荐）

```bash
# 1. 进入 worker 目录
cd worker

# 2. 安装依赖（如果还没安装）
npm install

# 3. 登录 Cloudflare（如果还没登录）
wrangler login

# 4. 验证配置
wrangler whoami

# 5. 设置 Secrets（在 worker 目录下）
wrangler secret put DUNE_API_KEY
# 输入你的 API KEY，然后按 Enter

wrangler secret put ETHERSCAN_API_KEY
# 输入你的 API KEY，然后按 Enter

wrangler secret put COINMARKETCAP_API_KEY
# 输入你的 API KEY，然后按 Enter

# 6. 验证 Secrets 已设置
wrangler secret list
```

## 其他常见问题

### 问题：Wrangler 版本不兼容

**解决方案：**
```bash
cd worker
npm install wrangler@latest
```

### 问题：无法找到 TypeScript 文件

**解决方案：**
确保 `src/index.ts` 文件存在：
```bash
ls -la src/index.ts
```

### 问题：环境变量未生效

**检查：**
```bash
# 列出所有已设置的 Secrets
wrangler secret list

# 如果使用环境，指定环境
wrangler secret list --env production
```

### 问题：本地开发时无法读取 Secrets

**解决方案：**
本地开发时，Wrangler 会自动从 Cloudflare 获取 Secrets。如果无法获取：
1. 确保已登录：`wrangler whoami`
2. 确保 Secrets 已设置：`wrangler secret list`
3. 重启开发服务器：`npm run dev`

## 获取帮助

如果问题仍然存在：

1. 查看 Wrangler 日志：
   ```bash
   cat ~/.wrangler/logs/wrangler-*.log
   ```

2. 查看 Wrangler 文档：
   https://developers.cloudflare.com/workers/wrangler/

3. 检查 Cloudflare Dashboard：
   https://dash.cloudflare.com/
