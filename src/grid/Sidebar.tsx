/**
 * Sidebar 组件 - 脱离Grid的系统层
 */

import { createSignal, Show, For, createMemo } from 'solid-js';
import { gridStore, switchLayout, addLayout, deleteLayout, updateLayout } from './store';
import type { DesktopLayout } from './types';
import { AddTabDialog } from './AddTabDialog';
import { useContextMenu } from '../components/layout/ContextMenu';
import { BootstrapIcon } from '../components/BootstrapIcon';
import { TAB_ICON_CONFIG } from './tabIconConfig';
import { HomeIcon, KlineIcon, BlockchainIcon, GlobeIcon } from './SidebarIcons';
import './grid.css';

const UNDELETABLE_TABS = ['主页'];

const DEFAULT_TAB_ICONS: Record<string, () => JSX.Element> = {
  '主页': HomeIcon,
  '交易所': KlineIcon,
  '链上': BlockchainIcon,
  '资讯': GlobeIcon,
};

export const Sidebar = () => {
  const layouts = () => gridStore.layouts;
  const currentId = () => gridStore.currentLayoutId;
  const [isDialogOpen, setIsDialogOpen] = createSignal(false);
  const [isEditMode, setIsEditMode] = createSignal(false);
  const [editingLayoutId, setEditingLayoutId] = createSignal<string | null>(null);
  const [tooltip, setTooltip] = createSignal<{ text: string; top: number } | null>(null);

  // 右键菜单
  const { ContextMenuComponent, showContextMenu, closeContextMenu } = useContextMenu();

  // 检查是否可删除
  const isDeletable = (layoutName: string): boolean => {
    return !UNDELETABLE_TABS.includes(layoutName);
  };

  const handleAddClick = () => {
    setIsEditMode(false);
    setEditingLayoutId(null);
    setIsDialogOpen(true);
  };

  const handleEditClick = (layout: DesktopLayout) => {
    setIsEditMode(true);
    setEditingLayoutId(layout.id);
    setIsDialogOpen(true);
  };

  const handleDialogClose = () => {
    setIsDialogOpen(false);
    setIsEditMode(false);
    setEditingLayoutId(null);
  };

  const handleConfirm = (name: string, iconId: string) => {
    if (isEditMode() && editingLayoutId()) {
      updateLayout(editingLayoutId()!, name, iconId);
    } else {
      addLayout(name, iconId);
      // 自动切换到新创建的桌面
      const newLayout = gridStore.layouts[gridStore.layouts.length - 1];
      if (newLayout) {
        switchLayout(newLayout.id);
      }
    }
    // 关闭弹窗
    setIsDialogOpen(false);
    setIsEditMode(false);
    setEditingLayoutId(null);
  };

  // Tab 右键菜单
  const handleTabContextMenu = (layout: DesktopLayout, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const canDelete = isDeletable(layout.name);
    const items = [
      {
        label: '编辑',
        action: () => handleEditClick(layout),
      },
    ];

    if (canDelete) {
      items.push({
        label: '删除',
        variant: 'danger' as const,
        action: () => deleteLayout(layout.id),
      });
    }

    showContextMenu(e.clientX, e.clientY, items);
  };

  const handleTabMouseEnter = (e: MouseEvent, name: string) => {
    const tab = e.currentTarget as HTMLElement;
    const rect = tab.getBoundingClientRect();
    setTooltip({ text: name, top: rect.top + rect.height / 2 });
  };

  const handleTabMouseLeave = () => {
    setTooltip(null);
  };

  return (
    <>
      <div class="grid-sidebar">
        <div class="grid-sidebar__tabs">
          <For each={layouts()}>
            {(layout) => {
              const icon = createMemo(() => {
                if (layout.iconId) {
                  const iconConfig = TAB_ICON_CONFIG.find(i => i.id === layout.iconId);
                  if (iconConfig) {
                    return { iconName: iconConfig.iconName };
                  }
                }
                const DefaultIcon = DEFAULT_TAB_ICONS[layout.name];
                if (DefaultIcon) {
                  return { Component: DefaultIcon };
                }
                return { iconName: 'grid' };
              });

              return (
                <div
                  class={`grid-sidebar__tab ${
                    layout.id === currentId() ? 'grid-sidebar__tab--active' : ''
                  }`}
                  onClick={() => switchLayout(layout.id)}
                  onContextMenu={(e) => handleTabContextMenu(layout, e)}
                  onMouseEnter={(e) => handleTabMouseEnter(e, layout.name)}
                  onMouseLeave={handleTabMouseLeave}
                >
                  {icon().Component ? (
                    <div class="grid-sidebar__icon grid-sidebar__icon--custom">
                      {icon().Component!()}
                    </div>
                  ) : (
                    <div class="grid-sidebar__icon">
                      <BootstrapIcon iconName={icon().iconName || 'grid'} size={24} />
                    </div>
                  )}
                </div>
              );
            }}
          </For>
        </div>

        <div class="grid-sidebar__separator" />

        <div class="grid-sidebar__add" onClick={handleAddClick}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </div>
      </div>

      <Show when={tooltip()}>
        {(t) => (
          <div
            class="grid-sidebar__tooltip"
            style={{ top: `${t().top}px` }}
          >
            {t().text}
          </div>
        )}
      </Show>

      <AddTabDialog
        isOpen={isDialogOpen()}
        onClose={handleDialogClose}
        onConfirm={handleConfirm}
        isEditMode={isEditMode()}
        initialName={editingLayoutId() ? layouts().find(l => l.id === editingLayoutId())?.name : undefined}
        initialIconId={editingLayoutId() ? layouts().find(l => l.id === editingLayoutId())?.iconId : undefined}
      />
      <ContextMenuComponent />
    </>
  );
};
