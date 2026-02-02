# 链上监控组件调试检查清单

## 开发服务器状态

✅ **开发服务器已启动**
- 端口: 5173
- URL: http://localhost:5173

## 已测试的功能

### ✅ RPC 客户端（纯前端）
- ETH Block Time Delay: ✅ 测试通过
  - Block Number: 24276899
  - Delay: 5秒
  - Source: RPC

## 需要检查的项目

### 1. 浏览器控制台错误
打开浏览器开发者工具，检查：
- [ ] 是否有 JavaScript 错误
- [ ] 是否有导入错误
- [ ] 是否有类型错误

### 2. 网络请求
检查 Network 标签页：
- [ ] RPC 请求是否正常（eth.llamarpc.com, blockstream.info 等）
- [ ] DefiLlama API 请求是否正常（api.llama.fi）
- [ ] Worker API 请求是否正常（如果需要回退）
- [ ] CORS 错误（如果有）

### 3. 组件渲染
检查页面：
- [ ] ChainMonitorWidget 是否正常显示
- [ ] 链列表是否显示（BTC, ETH, SOL, BSC, Polygon）
- [ ] 指标数据是否显示（延迟、Gas、TPS）
- [ ] 加载状态是否正常
- [ ] 错误状态是否正常处理

### 4. 数据获取流程
检查数据获取优先级：
- [ ] 优先使用 RPC（纯前端）
- [ ] RPC 失败时回退到 Worker API
- [ ] 数据缓存是否正常工作
- [ ] 自动刷新是否正常工作

## 常见问题排查

### 问题1: CORS 错误
**症状**: 浏览器控制台显示 CORS 错误
**解决**: 
- RPC 端点应该支持 CORS
- 如果 Worker API 有 CORS 问题，检查 Worker 的 CORS 配置

### 问题2: RPC 请求失败
**症状**: 所有 RPC 请求都失败
**解决**:
- 检查网络连接
- 检查 RPC 端点是否可访问
- 检查是否有速率限制

### 问题3: 组件不显示数据
**症状**: 组件显示但数据为空
**解决**:
- 检查浏览器控制台是否有错误
- 检查数据服务是否正常初始化
- 检查订阅机制是否正常工作

### 问题4: 类型错误
**症状**: TypeScript 编译错误
**解决**:
- 检查类型定义是否正确
- 检查导入路径是否正确
- 运行 `npm run build` 检查构建错误

## 调试命令

```bash
# 检查 TypeScript 错误
npx tsc --noEmit

# 检查开发服务器
curl http://localhost:5173

# 测试 RPC 客户端（Node.js 环境）
node -e "import('./src/services/chain-monitor/rpcClient.ts').then(m => m.getBlockTimeDelayRPC('eth').then(console.log).catch(console.error))"
```

## 下一步

1. 打开浏览器访问 http://localhost:5173
2. 打开开发者工具（F12）
3. 检查控制台和网络请求
4. 报告发现的任何错误
