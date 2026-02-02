/**
 * Bootstrap Icon 组件
 * 使用 i 标签和 Bootstrap Icons CSS 类
 */

import { Component } from 'solid-js';

interface BootstrapIconProps {
  iconName: string;
  size?: number;
  class?: string;
}

export const BootstrapIcon: Component<BootstrapIconProps> = (props) => {
  const biClass = `bi bi-${props.iconName}`;

  return (
    <i
      class={`${biClass} ${props.class || ''}`}
      style={{
        'font-size': `${props.size || 20}px`,
        'line-height': '1',
      }}
    />
  );
};
