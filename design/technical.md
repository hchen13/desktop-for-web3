在金融交易场景下，项目需求已经不仅仅是"高性能"，而是**"极低延迟（Low Latency）"**和**"高数据吞吐量"**。

"处理请求数据"是否算大量计算，取决于**数据量级**和**处理逻辑**：如果是每秒成百上千条的 Webhook/WebSocket 消息推送到前端，涉及复杂的数学公式计算、K线指标生成、多维数据聚合、或大量 DOM 节点的实时刷新，这**绝对属于高负载计算**。

针对金融交易类 Chrome Extension，采用以下**技术栈方案**：

### 1. 核心技术栈推荐：SolidJS + RxJS + TypeScript

* **UI 层：SolidJS**
* **理由**：金融界面通常有大量小组件（价格、百分比、成交量）在不停闪烁。React 的 Virtual DOM 会在每次推送时重新计算整棵树的 Diff，开销巨大。**SolidJS 的响应式是“原子级”的**，价格变了，只会更新那一个具体的 `<span>` 的文本，不会触发组件重新渲染，能显著降低 CPU 占用。


* **流处理层：RxJS (必选)**
* **理由**：RxJS 是金融业务流处理的核心。WebSocket 订阅多个频道（多对交易对、深度图、成交历史），RxJS 可以非常优雅地进行**背压控制（Backpressure）**、**数据节流（Throttling）**、**合并（Merge）**和**缓冲（Buffer）**。
* *场景示例*：WebSocket 每秒推送 100 次价格，可以使用 RxJS 将其缓冲为每 16ms（对应 60FPS）更新一次 UI。


* **计算层：Web Workers (多线程)**
* **理由**：需要将"数据接收 + 数据清洗/格式化"与"UI 渲染"剥离。



---

### 2. 金融级高性能架构设计

#### A. 离线计算与存储：Worker 与 Offscreen

* **Service Worker (Background)**：由于 Manifest V3 的限制，SW 不能长久运行。仅作为消息转发中心使用。
* **Offscreen Document**：在 V3 架构中，这是维持 **WebSocket 长连接**和**大规模数据处理**的最佳场所。它拥有完整的 Web API，可以在此运行 RxJS 逻辑，将原始数据处理成 UI 直接可用的格式。
* **Web Workers**：如果需要计算复杂的指标（如计算上万个点的 EMA/MACD），在 Offscreen 内部再开启 Web Worker 线程。

#### B. 数据传输优化：避免 JSON 序列化瓶颈

* 金融交易 API 如果支持 **Binary (ArrayBuffer / Protobuf)** 协议，优先使用。
* JavaScript 处理巨大的 JSON 字符串非常耗费 CPU。使用二进制协议配合 `DataView` 或 `TypedArray` 能极大提升数据吞吐率。

#### C. 通信策略

* 使用 `chrome.runtime.connect` 建立 **Port 长连接**，而不是 `sendMessage`（单次调用开销大）。
* 在 Content Script 和 Background 之间传输大数据时，考虑使用 **Transferable Objects**（如 `ArrayBuffer`），这可以实现内存所有权的转移，而不是耗时的内存复制。

---

### 3. 其他技术方案对比

* **React**：在处理每秒几十次的高频状态更新时，React 的调度机制（Fiber）和 Diff 算法会成为性能瓶颈，容易导致界面掉帧（Jank）。
* **Vue**：虽然 Vue 3 性能很好，但在这种极端高频的原子更新场景下，SolidJS 这种“直接操作 DOM”的性能上限更高。
* **原生 JS**：逻辑复杂度太高（金融业务逻辑极重），没有框架支撑会导致代码难以维护，Bug 丛生。

---

### 4. 技术选型清单 (2026 方案)

| 模块 | 推荐方案 |
| --- | --- |
| **构建/打包** | **Vite** + **@crxjs/vite-plugin** |
| **UI 框架** | **SolidJS** (极致更新速度) |
| **异步流控** | **RxJS** (处理多频道订阅与数据聚合) |
| **状态管理** | **Store (Solid 内置)** (原生支持代理，性能极佳) |
| **跨端通信** | **Port (chrome.runtime.connect)** |
| **复杂计算** | **Web Workers** + **Wasm** (如果涉及大量数学运算) |

### 核心要点：

对于金融交易扩展，**性能的关键不在于框架，而在于"不要阻塞主线程"**。

1. **WebSocket 放在 Offscreen 文档里**运行。
2. 使用 **RxJS** 处理数据流，利用 `sampleTime` 或 `auditTime` 操作符对 UI 刷新率进行强制限制（例如 20ms 刷一次）。
3. UI 层面，对价格变动使用 CSS 硬件加速（`transform: translateZ(0)`）来处理闪烁效果。
