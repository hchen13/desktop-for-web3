/**
 * 添加图标对话框组件
 * 允许用户输入名称和URL来创建新图标
 * 支持自动补全 URL 前缀
 */

import { createSignal, Show, createEffect } from 'solid-js';
import { Portal } from '../components/layout/Portal';

interface AddIconDialogProps {
  /** 对话框是否显示 */
  isOpen: boolean;
  /** 关闭对话框回调 */
  onClose: () => void;
  /** 确认创建/修改回调 */
  onConfirm: (name: string, url: string) => void;
  /** 是否为编辑模式 */
  isEditMode?: boolean;
  /** 编辑模式下的初始名称 */
  initialName?: string;
  /** 编辑模式下的初始URL */
  initialUrl?: string;
}

/**
 * 规范化 URL，自动添加协议前缀
 * - 已包含 http:// 或 https:// → 保持不变
 * - 以 // 开头 → 添加 https:
 * - 其他格式 → 添加 https://
 */
function normalizeUrl(input: string): string {
  const trimmed = input.trim();

  // 空字符串直接返回
  if (!trimmed) return trimmed;

  // 已包含协议
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // 以 // 开头（协议相对 URL）
  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }

  // 默认使用 https://
  return `https://${trimmed}`;
}

export const AddIconDialog = (props: AddIconDialogProps) => {
  const [iconName, setIconName] = createSignal(props.initialName || '');
  const [iconUrl, setIconUrl] = createSignal(props.initialUrl || '');
  let nameInputRef: HTMLInputElement | undefined;

  // 重置表单
  const resetForm = () => {
    setIconName(props.initialName || '');
    setIconUrl(props.initialUrl || '');
  };

  // 当对话框打开或编辑模式变化时，更新表单值
  createEffect(() => {
    if (props.isOpen) {
      if (props.isEditMode) {
        setIconName(props.initialName || '');
        setIconUrl(props.initialUrl || '');
      } else {
        setIconName('');
        setIconUrl('');
      }
    }
  });

  // 关闭对话框
  const handleClose = () => {
    resetForm();
    props.onClose();
  };

  // 确认创建
  const handleConfirm = () => {
    const name = iconName().trim();
    const rawUrl = iconUrl().trim();

    if (!name || !rawUrl) {
      return;
    }

    // 规范化 URL
    const url = normalizeUrl(rawUrl);

    // 验证URL格式
    try {
      new URL(url);
    } catch {
      return;
    }

    props.onConfirm(name, url);
    resetForm();
  };

  // 当对话框打开时，聚焦到名称输入框
  createEffect(() => {
    if (props.isOpen && nameInputRef) {
      // 使用setTimeout确保DOM已渲染
      setTimeout(() => {
        nameInputRef?.focus();
      }, 0);
    }
  });

  return (
    <Show when={props.isOpen}>
      <Portal>
        <div class="add-icon-dialog-overlay" onClick={handleClose}>
          <div class="add-icon-dialog" onClick={(e) => e.stopPropagation()}>
            <div class="add-icon-dialog__header">
              <h2 class="add-icon-dialog__title">{props.isEditMode ? '编辑图标' : '添加图标'}</h2>
              <button class="add-icon-dialog__close" onClick={handleClose}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* 名称输入区域 */}
            <div class="add-icon-dialog__section">
              <label class="add-icon-dialog__label" for="icon-name-input">
                名称
              </label>
              <input
                id="icon-name-input"
                ref={nameInputRef}
                type="text"
                class="add-icon-dialog__input"
                value={iconName()}
                onInput={(e) => setIconName(e.currentTarget.value)}
                placeholder="例如: Google"
                maxLength={50}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && iconName().trim() && iconUrl().trim()) {
                    handleConfirm();
                  }
                }}
              />
            </div>

            {/* URL输入区域 */}
            <div class="add-icon-dialog__section">
              <label class="add-icon-dialog__label" for="icon-url-input">
                URL
              </label>
              <input
                id="icon-url-input"
                type="text"
                class="add-icon-dialog__input"
                value={iconUrl()}
                onInput={(e) => setIconUrl(e.currentTarget.value)}
                placeholder="example.com 或 https://example.com"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && iconName().trim() && iconUrl().trim()) {
                    handleConfirm();
                  }
                }}
              />
            </div>

            {/* 操作按钮 */}
            <div class="add-icon-dialog__actions">
              <button
                class="add-icon-dialog__btn add-icon-dialog__btn--cancel"
                onClick={handleClose}
              >
                取消
              </button>
              <button
                class="add-icon-dialog__btn add-icon-dialog__btn--confirm"
                onClick={handleConfirm}
                disabled={!iconName().trim() || !iconUrl().trim()}
              >
                {props.isEditMode ? '修改' : '创建'}
              </button>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
};
