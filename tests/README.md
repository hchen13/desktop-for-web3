# Desktop for Web3 - 测试文档

## 概述

本项目使用自动化测试方案，通过启动开发服务器并使用 Chrome DevTools MCP 进行 UI 和功能测试。

## 测试文件结构

```
tests/
├── README.md              # 本文档
├── run-automated-test.js  # 自动化测试主脚本
├── test-cases.js          # 测试用例定义
└── screenshots/           # 截图保存目录 (自动创建)
```

## 快速开始

### 方式 1: 使用 npm 脚本 (推荐)

```bash
# 启动测试服务器
npm test

# 或使用完整命令名
npm run test:ui
```

### 方式 2: 直接运行脚本

```bash
node tests/run-automated-test.js
```

### 方式 3: 手动测试

1. 构建项目:
   ```bash
   npm run build
   ```

2. 在 Chrome 中加载扩展:
   - 打开 `chrome://extensions/`
   - 启用"开发者模式"
   - 点击"加载已解压的扩展程序"
   - 选择项目的 `dist` 目录

3. 打开新标签页查看效果

### 方式 4: 使用本地服务器

1. 启动开发服务器:
   ```bash
   npm run dev
   ```

2. 在浏览器中打开:
   ```
   http://localhost:5173/src/newtab/index.html
   ```

## 测试用例

| ID | 名称 | 优先级 | 描述 |
|----|------|--------|------|
| TC001 | 页面加载测试 | 高 | 验证页面所有核心组件正确加载 |
| TC002 | 搜索 - 地址识别 | 高 | 验证以太坊地址识别 |
| TC003 | 搜索 - 交易哈希识别 | 高 | 验证交易哈希识别 |
| TC004 | 搜索 - 普通搜索 | 中 | 验证普通搜索无特殊提示 |
| TC005 | Hover - 应用图标 | 中 | 验证应用图标 hover 效果 |
| TC006 | 图标网格显示 | 高 | 验证 Web3 应用图标正确显示 |
| TC008 | Sidebar 按钮 | 中 | 验证桌面切换按钮显示 |
| TC009 | 时间显示格式 | 低 | 验证时间日期格式 |
| TC010 | 响应式测试 | 低 | 验证不同窗口大小下的响应 |

## 使用 Chrome DevTools MCP 执行测试

如果已安装 Chrome DevTools MCP 服务器，可以使用以下工具执行测试:

### 测试步骤示例

```javascript
// 1. 导航到测试页面
await mcp_chrome_devtools_navigate_page({
  type: "url",
  url: "http://localhost:5173/src/newtab/index.html"
});

// 2. 等待页面加载
await mcp_chrome_devtools_wait_for({
  text: "Search web3",
  timeout: 5000
});

// 3. 截取页面截图
await mcp_chrome_devtools_take_screenshot({
  format: "png",
  fullPage: true
});

// 4. 测试搜索功能 - 输入以太坊地址
await mcp_chrome_devtools_fill({
  uid: "<搜索框 uid>",
  value: "0x1234567890abcdef1234567890abcdef12345678"
});

// 5. 验证提示文本
// 使用 take_snapshot 验证页面内容
```

## 测试报告

测试完成后，将生成以下内容:

1. **控制台输出**: 显示测试进度和结果
2. **截图文件**: 保存在 `tests/screenshots/` 目录
3. **测试报告**: 汇总通过/失败情况

## 已知问题

### CORB 错误
Google Favicon API 可能遇到跨域阻止问题，不影响核心功能。

### 404 资源错误
某些资源可能加载失败，需要检查资源路径配置。

## 下一步计划

- [ ] 添加拖拽功能测试
- [ ] 添加 Sidebar 切换功能测试
- [ ] 添加持久化存储测试
- [ ] 集成到 CI/CD 流程
