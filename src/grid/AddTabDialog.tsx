/**
 * 添加 Tab 弹窗组件
 * 允许用户选择图标和输入名称来创建新桌面
 */

import { createSignal, createEffect, For, Show } from 'solid-js';
import { Portal } from '../components/layout/Portal';
import { BootstrapIcon } from '../components/BootstrapIcon';
import { TAB_ICON_CONFIG, TAB_CATEGORIES, TAB_CATEGORY_LABELS, getTabIconsByCategory } from './tabIconConfig';
import type { TabIcon } from './tabIconConfig';

interface AddTabDialogProps {
  /** 对话框是否显示 */
  isOpen: boolean;
  /** 关闭对话框回调 */
  onClose: () => void;
  /** 确认添加回调 */
  onConfirm: (name: string, iconId: string) => void;
  /** 是否为编辑模式 */
  isEditMode?: boolean;
  /** 编辑模式下的初始名称 */
  initialName?: string;
  /** 编辑模式下的初始图标ID */
  initialIconId?: string;
}

export const AddTabDialog = (props: AddTabDialogProps) => {
  const [tabName, setTabName] = createSignal('');
  const [selectedIconId, setSelectedIconId] = createSignal<string | null>(null);
  const [selectedCategory, setSelectedCategory] = createSignal<keyof typeof TAB_CATEGORY_LABELS>('common');
  const [hasManualInput, setHasManualInput] = createSignal(false);

  const resetForm = () => {
    setTabName('');
    setSelectedIconId(null);
    setSelectedCategory('common');
    setHasManualInput(false);
  };

  // 当对话框打开时，初始化编辑模式的值
  createEffect(() => {
    if (props.isOpen) {
      if (props.isEditMode) {
        setTabName(props.initialName || '');
        setSelectedIconId(props.initialIconId || null);
        setHasManualInput(true);
      } else {
        resetForm();
      }
    }
  });

  // 监听对话框关闭，重置分类
  createEffect(() => {
    if (!props.isOpen) {
      setSelectedCategory('common');
    }
  });

  // 关闭对话框
  const handleClose = () => {
    resetForm();
    props.onClose();
  };

  // 确认添加
  const handleConfirm = () => {
    const name = tabName().trim();
    const iconId = selectedIconId();

    if (!name) {
      return;
    }

    // 新增模式下必须选择图标
    // 编辑模式下，如果原桌面没有图标则允许不选（保持使用自定义图标）
    if (!props.isEditMode && !iconId) {
      return;
    }

    props.onConfirm(name, iconId || '');
    resetForm();
  };

  const handleSelectIcon = (icon: TabIcon) => {
    setSelectedIconId(icon.id);
    // 如果用户没有手动输入，自动填入图标名称
    if (!hasManualInput()) {
      setTabName(icon.name);
    }
  };

  // 获取当前分类的图标
  const currentIcons = () => getTabIconsByCategory(selectedCategory());

  return (
    <Show when={props.isOpen}>
      <Portal>
        <div class="add-tab-dialog-overlay" onClick={handleClose}>
          <div class="add-tab-dialog" onClick={(e) => e.stopPropagation()}>
            <div class="add-tab-dialog__header">
              <h2 class="add-tab-dialog__title">{props.isEditMode ? '编辑桌面' : '添加新桌面'}</h2>
              <button class="add-tab-dialog__close" onClick={handleClose}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* 分类选择 */}
            <div class="add-tab-dialog__categories">
              <For each={TAB_CATEGORIES}>
                {(category) => (
                  <button
                    classList={{
                      'add-tab-dialog__category': true,
                      'add-tab-dialog__category--active': selectedCategory() === category,
                    }}
                    onClick={() => setSelectedCategory(category)}
                  >
                    {TAB_CATEGORY_LABELS[category]}
                  </button>
                )}
              </For>
            </div>

            {/* 图标选择区域 */}
            <div class="add-tab-dialog__section">
              <div class="add-tab-dialog__icons">
                <For each={currentIcons()}>
                  {(icon) => (
                    <div
                      classList={{
                        'add-tab-dialog__icon': true,
                        'add-tab-dialog__icon--selected': selectedIconId() === icon.id,
                      }}
                      onClick={() => handleSelectIcon(icon)}
                    >
                      <BootstrapIcon iconName={icon.iconName} size={28} class="add-tab-dialog__icon-svg" />
                      <span class="add-tab-dialog__icon-name">{icon.name}</span>
                    </div>
                  )}
                </For>
              </div>
            </div>

            {/* 名称输入区域 */}
            <div class="add-tab-dialog__section">
              <label class="add-tab-dialog__label" for="tab-name-input">
                桌面名称
              </label>
              <input
                id="tab-name-input"
                type="text"
                class="add-tab-dialog__input"
                value={tabName()}
                onInput={(e) => {
                  setTabName(e.currentTarget.value);
                  setHasManualInput(true);
                }}
                placeholder="例如: 我的 DEX"
                maxLength={20}
              />
            </div>

            {/* 操作按钮 */}
            <div class="add-tab-dialog__actions">
              <button
                class="add-tab-dialog__btn add-tab-dialog__btn--cancel"
                onClick={handleClose}
              >
                取消
              </button>
              <button
                class="add-tab-dialog__btn add-tab-dialog__btn--confirm"
                onClick={handleConfirm}
              >
                {props.isEditMode ? '保存' : '确认'}
              </button>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
};
