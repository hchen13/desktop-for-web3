/**
 * Portal 组件
 * 将子组件渲染到 document.body，避免被父组件的 overflow 裁剪
 * 用于 Tooltip、ContextMenu 等需要覆盖全屏的组件
 */

import { createSignal, onMount, onCleanup, JSX } from 'solid-js';
import { Portal as SolidPortal } from 'solid-js/web';

interface PortalProps {
  children: JSX.Element;
  /**
   * 是否启用 portal
   * 为 false 时直接渲染子组件（用于 SSR 或调试）
   */
  enabled?: boolean;
}

/**
 * Portal 组件
 *
 * 使用示例：
 * ```tsx
 * <Portal>
 *   <Tooltip />
 * </Portal>
 * ```
 */
export function Portal(props: PortalProps) {
  const enabled = props.enabled !== false;
  const [mount, setMount] = createSignal(enabled);

  onMount(() => {
    if (!enabled) return;

    // 只在客户端挂载时启用
    setMount(true);

    onCleanup(() => {
      setMount(false);
    });
  });

  // 如果未启用，直接渲染子组件
  if (!enabled || !mount()) {
    return props.children;
  }

  // 使用 SolidJS 的 Portal 将子组件渲染到 body
  return <SolidPortal mount={document.body}>{props.children}</SolidPortal>;
}

/**
 * 可选的命名 Portal 容器
 *
 * 使用示例：
 * ```tsx
 * <NamedPortal name="tooltip">
 *   <Tooltip />
 * </NamedPortal>
 * ```
 */
interface NamedPortalProps {
  name: string;
  children: JSX.Element;
}

export function NamedPortal(props: NamedPortalProps) {
  return <SolidPortal mount={document.body}>{props.children}</SolidPortal>;
}
