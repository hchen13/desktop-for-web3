# 已知问题记录

## ✅ 已解决的问题

### SOL Block Time Delay 返回 null（已解决）
**状态**: ✅ 已解决  
**原因**: `getBlockTime` 可能返回 `null`，需要回退到 `getBlock`  
**解决方案**: 更新了 `getSOLBlock` 函数，添加了回退逻辑和 slot 验证

### SOL Gas Price 和 TPS 返回 403 错误（已解决）
**状态**: ✅ 已解决  
**原因**: 公共 Solana RPC 端点有速率限制  
**解决方案**: 使用 Alchemy API key 访问 Solana RPC（如果可用）

### Polygon Block Time Delay 间歇性失败（已解决）
**状态**: ✅ 已解决  
**原因**: 公共 RPC 端点不稳定  
**解决方案**: 使用 Alchemy API key 访问 Polygon RPC（如果可用），并添加了 Dune 回退机制

### ETH/Polygon RPC 失败（已解决）
**状态**: ✅ 已解决  
**原因**: 代码逻辑问题，已添加详细调试日志和修复  
**解决方案**: 
- 优化了 `getRPCEndpoint` 函数，统一处理 Alchemy API key
- 添加了详细的调试日志（`getRPCEndpoint`, `getEVMBlock`, `getBlockTimeDelayRPC`）
- 所有链现在都能正常使用 RPC（优先使用 Alchemy，失败时回退到公共端点或 Dune）

---

## 当前问题

无

---

## 历史问题记录

### 问题 1: SOL Block Time Delay - blockNumber 为 null（已解决）

**现象**: SOL 链的 Block Time Delay 接口返回 `blockNumber: null`，但 `latestBlockTime` 有值。

**原因分析**:
- `getSOLBlock()` 函数中，如果 `getBlockTime` 返回 null，会使用 `getBlock` 获取时间戳
- 此时返回的 `blockNumber` 是 `slot`，但如果 `slot` 本身是 null 或 undefined，就会导致 `blockNumber` 为 null

**修复方案**:
```typescript
// 在 getSOLBlock() 中，如果 slot 为 null，应该处理错误
const slot = slotData.result;
if (!slot) {
  throw new Error('Failed to get Solana slot');
}
```

**状态**: ✅ 已修复

---

### 问题 2: Polygon Block Time Delay - 间歇性失败（已解决）

**现象**: Polygon 链的 Block Time Delay 接口偶尔返回 `success: false`。

**原因分析**:
- Polygon RPC 端点可能不稳定
- 公共 RPC 端点可能有速率限制

**修复方案**:
- 使用 Alchemy API key 访问 Polygon RPC（如果可用）
- 添加了 Dune 回退机制

**状态**: ✅ 已修复

---

### 问题 3: SOL Gas Price 和 TPS 返回 403 错误（已解决）

**现象**: SOL 链的 Gas Price 和 TPS 接口返回 403 错误。

**原因分析**:
- 公共 Solana RPC 端点有速率限制
- 需要 API key 才能稳定访问

**修复方案**:
- 使用 Alchemy API key 访问 Solana RPC（如果可用）
- 如果 Alchemy key 不可用，回退到公共端点

**状态**: ✅ 已修复

---

### 问题 4: ETH/Polygon RPC 失败（已解决）

**现象**: ETH 和 Polygon 链的 Block Time Delay 接口回退到 Dune，而不是使用 RPC。

**原因分析**:
- 代码逻辑问题，可能没有正确获取 Alchemy API key
- 缺少详细的调试日志

**修复方案**:
- 优化了 `getRPCEndpoint` 函数，统一处理 Alchemy API key
- 添加了详细的调试日志：
  - `getRPCEndpoint`: 显示选择的端点和 API key 状态
  - `getEVMBlock`: 显示请求、响应状态、错误信息
  - `getBlockTimeDelayRPC`: 显示调用链和错误堆栈
- 修复了 Response body 只能读取一次的问题（使用 `clone()`）

**状态**: ✅ 已修复

**测试结果**:
- ETH: ✅ RPC (Alchemy) - Delay: 12s
- BSC: ✅ RPC - Delay: 2s
- Polygon: ✅ RPC (Alchemy) - Delay: 2s
- BTC: ✅ RPC - Delay: 208s
- SOL: ✅ RPC (Alchemy) - Delay: 14s
