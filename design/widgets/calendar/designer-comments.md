为了方便你将现有的日历组件迁移至 Bloomberg 终端 / Web3 金融风格，我整理了以下核心设计规范和 CSS 参数配置：

1. 核心视觉风格描述 (Design Logic)
硬核数据感：采用深色背景与高对比度文字，通过极细的网格线（Low-opacity dividers）营造金融终端的严谨感。
克制的色彩：全界面以黑白灰为主，仅在“关键状态”使用色彩：终端蓝代表当前焦点（今日），彭博橙代表数据增量（事件统计）。
几何秩序：严格的对齐方式，固定 6 行布局确保视觉重心不随月份切换而跳动。
2. 关键色彩定义 (Color Tokens)
:root {
  /* 基础背景：深碳黑，比纯黑更有质感 */
  --color-bg: #0D0E12; 
  /* 边框与网格：极低透明度的白色，营造精细感 */
  --color-border: rgba(255, 255, 255, 0.1);
  --color-grid-line: rgba(255, 255, 255, 0.05);
  
  /* 文字颜色 */
  --text-primary: #FFFFFF;
  --text-secondary: rgba(255, 255, 255, 0.4); /* 星期表头、非本月日期 */
  
  /* 功能性色彩 */
  --accent-blue: #00A3FF;  /* 终端蓝：用于“今日”高亮 */
  --accent-orange: #FF9900; /* 彭博橙：用于事件角标 */
}
3. 容器与布局参数 (Container & Grid)
.calendar-container {
  width: 316px;
  height: 208px;
  background-color: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 16px; /* 16px 圆角 */
  padding: 12px;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
}

/* 核心日历网格：固定 6 行 */
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  grid-template-rows: repeat(6, 1fr); /* 强制 6 行 */
  flex-grow: 1;
  margin-top: 8px;
}
4. 关键组件样式 (Component States)
A. 星期表头 (Weekday Headers)
样式：使用 Inter 字体，常规或中等字重，字号 10px - 11px，全中文，颜色使用 var(--text-secondary)。
B. 今日高亮 (Today State)
.day-today {
  background-color: var(--accent-blue);
  color: #FFFFFF;
  border-radius: 4px; /* 较小的方圆角，更有终端感 */
  font-weight: 700;
}
C. 事件角标 (Event Indicator)
位置：日期单元格右上角绝对定位。
样式：
.event-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: 9px;
  font-weight: 800;
  color: var(--accent-orange);
  /* 可选：添加极小的发光效果 */
  text-shadow: 0 0 4px rgba(255, 153, 0, 0.4);
}
5. 字体配置 (Typography)
首选字体：Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif。
标题 (2026年1月)：14px, Bold (700)。
日期数字：12px, Semi-Bold (600)。