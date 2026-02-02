> **让 AI coding agent / 前端工程师在「没有任何设计图」的情况下，也能稳定实现风格统一、结构正确、气质一致的桌面级 UI。**

你可以把它当作 **唯一权威规范**（Single Source of Truth）。

---

# Desktop for Web3

## Unified Style Guideline

*(AI Coding Agent First)*

---

## 0. Guideline 的适用前提（非常重要）

* 产品形态：**Chrome Extension · New Tab**
* 核心隐喻：**Web3 专用桌面系统（Desktop OS-like）**
* 目标用户：

  * Web3 老手（效率、信息密度、可信赖）
  * Web3 新手（清晰、安全、避免钓鱼）
* 使用场景：

  * 间歇式查看
  * 演示 / 展示
* 参考对象：**WeTab（但更专业、更垂直）**

---

## 1. 核心设计哲学（不可违背）

### 1.1 这不是网页

❌ 不要把它当作：

* 官网
* SaaS Dashboard
* 管理后台
* 营销页面

✅ 必须把它当作：

> **一个“每天会被反复打开”的 Web3 桌面工作台**

---

### 1.2 三条铁律

1. **秩序优先于表现**
2. **克制优先于炫技**
3. **可信赖高于一切视觉刺激**

如果一个 UI 元素：

* 很酷，但显得不稳 ❌
* 很炫，但影响判断 ❌
* 很新，但不耐看 ❌

都必须被削弱或移除。

---

## 2. 整体结构：Desktop + Grid System

### 2.1 桌面整体结构

桌面由 **两类层级**构成：

1. **系统外壳层**

   * Sidebar（侧边栏）
2. **桌面内容层（Grid System）**

   * 组件
   * 图标
3. **系统固定层**

   * 搜索框
   * 时间 / 日期

---

## 3. Grid System（最高优先级规则）

### 3.1 Grid 的本质

Grid 不是排版工具，而是**秩序系统**。

* ❌ 不允许自由定位
* ❌ 不允许随意 px
* ✅ 所有桌面元素必须服从 Grid

---

### 3.2 Grid 基础参数（默认）

```ts
GRID_UNIT = 72px   // Grid Unit 尺寸
GRID_GAP  = 8px    // Grid 间隙
```

> 详细说明请参阅：[Grid System 设计说明文档](./layout/grid-system-design.md)

* Grid 列数根据视口宽度**动态计算**
* Grid Unit 尺寸**固定不变**，大窗口显示更多列

---

### 3.3 Grid 占用声明（强制）

任何元素必须声明：

```ts
gridWidth: n
gridHeight: m
```

❌ 禁止：

* auto 尺寸
* 不对齐 grid 的宽高
* 半格、浮点数

---

### 3.4 常用 Grid Size 约定

| 类型    | Grid Size |
| ----- | --------- |
| 网站图标  | 1 × 1     |
| 小组件   | 2 × 1     |
| 标准组件  | 2 × 2     |
| 大组件   | 4 × 2     |
| 纵向资讯流 | 2 × auto  |

---

## 4. 固定元素（不参与 Grid Flow）

### 4.1 搜索框

* 固定在 **桌面 top-center**
* 类 Google 首页搜索框
* Placeholder：`Search web3`
* 不随桌面滚动 / 切换

```ts
gridWidth: 4
gridHeight: 1
position: fixed
```

---

### 4.2 时间 / 日期

* 位于搜索框正下方
* iOS 风格
* 包含：

  * 当前时间（大号）
  * 日期
  * 星期

```ts
gridWidth: 2
gridHeight: 1
position: fixed
```

---

## 5. Sidebar（脱离 Grid 的系统层）

### 5.1 结构规则

* Sidebar **不占用任何 Grid 列**
* 看起来像悬浮在桌面之上
* 是“系统外壳”，不是内容

---

### 5.2 内容规则

* Tabs：

  * 主页
  * 交易所
  * 链上
* 每个 Tab = 一整套桌面布局
* 支持：

  * 点击切换
  * 桌面空白区域垂直滚动切换
* 底部固定一个 `+`

  * 新增自定义桌面布局

---

## 6. 组件宏观规则（不涉及内部 UI）

### 6.1 通用规则

* 组件只能按 Grid 整格移动
* 拖拽时吸附 Grid
* 不允许覆盖其他元素

---

### 6.2 已知组件类型（布局语义）

* 资讯（右侧纵向信息流，可滚动）
* Web3 日历（月视图，hover 显示事件）
* Watchlist（TradingView 风格）
* 链上监控（BTC / ETH / SOL）
* Web3 计算器

---

## 7. 图标系统（桌面基础元素）

### 7.1 桌面图标

* 占用 `1 × 1 Grid`
* 正方形
* 圆角 `12px`
* Icon = 网站 logo 原图
* 下方显示：

  * 网站品牌名（如 Binance）
  * ❌ 不显示域名

---

### 7.2 排列规则

* 有序排列
* 从左上角开始
* 不允许自由散落

---

## 8. 颜色系统（深色模式优先）

### 8.1 背景色

```ts
--bg-root:     #0A0A0B
--bg-panel:    #111214
--bg-elevated: #16181D
```

* 不使用纯黑
* 背景层级靠亮度区分

---

### 8.2 文本色

```ts
--text-primary:   rgba(255,255,255,0.92)
--text-secondary: rgba(255,255,255,0.64)
--text-tertiary:  rgba(255,255,255,0.40)
```

---

### 8.3 语义色（仅用于信息）

```ts
--green-up:  #00C087
--red-down:  #FF3B30
--blue-main: #3B82F6
```

❌ 禁止语义色大面积铺背景

---

## 9. 圆角、阴影与质感

### 9.1 圆角系统

```ts
8px   // 小元素
12px  // 图标、普通组件
16px  // Widget
20px  // 搜索框
```

---

### 9.2 阴影（极度克制）

```css
box-shadow: 0 4px 24px rgba(0,0,0,0.4);
```

---

### 9.3 毛玻璃（有限使用）

```css
backdrop-filter: blur(20px);
background: rgba(255,255,255,0.06);
```

只允许用于：

* 搜索框
* 悬浮层

---

## 10. 字体与数字规范

### 10.1 字体

```css
font-family:
-apple-system,
BlinkMacSystemFont,
"SF Pro Text",
"Inter",
sans-serif;
```

---

### 10.2 数字 / 时间 / 价格

```css
font-variant-numeric: tabular-nums;
```

---

## 11. 状态与交互（必须存在）

每个可交互元素必须有：

* default
* hover
* active / selected

表现方式：

* 亮度微调
* 描边 / underline
* icon / text 颜色变化

❌ 禁止夸张动画

---

## 12. AI Coding Agent 最终 Checklist

在实现任何 UI 前，必须确认：

* [ ] 是否遵守 Grid System？
* [ ] 是否避免自由 px 布局？
* [ ] Sidebar 是否脱离 Grid？
* [ ] 搜索框 / 时间是否固定？
* [ ] 风格是否克制、专业、可信赖？

---

## 14. 给 AI 的一句话总结

> **你正在实现一个 Web3 专业用户每天都会打开的桌面系统，而不是一个普通网页。
> 秩序、稳定、可信赖，高于一切视觉表现。**
