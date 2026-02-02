/**
 * 时间显示组件
 */

import { onMount, onCleanup } from 'solid-js';

export const TimeDisplay = () => {
  let hoursDiv: HTMLSpanElement | undefined;
  let colonDiv: HTMLSpanElement | undefined;
  let minutesDiv: HTMLSpanElement | undefined;
  let dateDiv: HTMLDivElement | undefined;
  let timer: number | undefined;

  const updateTime = () => {
    const now = new Date();
    const milliseconds = now.getMilliseconds();

    // 格式化时间
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');

    // 冒号闪烁：每秒完成一次显隐循环（前500ms显示，后500ms隐藏）
    const showColon = milliseconds < 500;

    if (hoursDiv) hoursDiv.textContent = hours;
    if (minutesDiv) minutesDiv.textContent = minutes;
    if (colonDiv) {
      colonDiv.style.opacity = showColon ? '1' : '0';
    }

    // 格式化日期
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    };
    const dateStr = now.toLocaleDateString('zh-CN', options);

    if (dateDiv) {
      dateDiv.textContent = dateStr;
    }
  };

  onMount(() => {
    updateTime();
    timer = window.setInterval(updateTime, 50);
  });

  onCleanup(() => {
    if (timer) {
      clearInterval(timer);
    }
  });

  return (
    <div class="time-display">
      <div class="time-display__time">
        <span ref={hoursDiv!} class="time-display__hours">--</span>
        <span ref={colonDiv!} class="time-display__colon">:</span>
        <span ref={minutesDiv!} class="time-display__minutes">--</span>
      </div>
      <div ref={dateDiv!} class="time-display__date">--</div>
    </div>
  );
};
