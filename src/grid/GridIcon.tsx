/**
 * Grid 中用户添加的图标组件
 * 支持渐进式图标优化：所有源并发请求，谁回来就比较，更好的立即替换
 * 支持防止拖拽后的误点击
 */

import { createSignal, Show, createEffect, onCleanup } from 'solid-js';
import { getDDGFavicon } from '../services/faviconService';
import { DragSystem } from '../events/DragSystem';
import { getCachedIconUrl, getIconLoadState, setIconLoadState, detectBestIcon, isStorageLoaded, onIconUpdate } from '../services/iconCache';

interface GridIconProps {
  url: string;
  name: string;
}

export const GridIcon = (props: GridIconProps) => {
  // 从缓存获取初始 URL
  const initialUrl = getCachedIconUrl(props.url);
  const [iconUrl, setIconUrl] = createSignal(initialUrl);

  // 全局加载状态
  const globalState = getIconLoadState(props.url);
  const [isLoading, setIsLoading] = createSignal(globalState !== 'loaded');
  const [hasLoaded, setHasLoaded] = createSignal(globalState === 'loaded');
  const [imageError, setImageError] = createSignal(false);

  // 本地状态：追踪实际图片元素是否已加载完成
  const [isImgLoaded, setIsImgLoaded] = createSignal(false);

  // 注册渐进式更新回调：当更好的图标被发现时立即更新
  createEffect(() => {
    const url = props.url;
    
    // 注册图标更新回调
    const unsubscribe = onIconUpdate(url, (newIconUrl) => {
      setIconUrl(newIconUrl);
      setIsImgLoaded(false); // 新图片需要重新加载
    });

    // 清理回调
    onCleanup(unsubscribe);
  });

  // 监听 URL 变化，触发图标检测
  createEffect((prevUrl) => {
    const url = props.url;
    const storageReady = isStorageLoaded();
    
    // 如果有缓存，先使用缓存
    const cachedUrl = getCachedIconUrl(url);
    if (cachedUrl) {
      setIconUrl(cachedUrl);
    }
    
    if (url === prevUrl && !storageReady) return prevUrl;

    const state = getIconLoadState(url);
    setIsLoading(state !== 'loaded');
    setHasLoaded(state === 'loaded');
    setIsImgLoaded(state === 'loaded');
    setImageError(false);

    // 如果缓存已就绪且未完成检测，触发渐进式检测
    // detectBestIcon 内部会通过 onIconUpdate 回调通知更好的图标
    if (storageReady && state !== 'loaded' && state !== 'error') {
      detectBestIcon(url);
    }

    return url;
  }, '');

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();

    if (DragSystem.justFinishedDrag()) {
      return;
    }

    if (isLoading() || imageError()) {
      return;
    }

    window.open(props.url, '_blank');
  };

  const handleImageLoad = (e: Event) => {
    const img = e.target as HTMLImageElement;

    setIsLoading(false);
    setHasLoaded(true);
    setIsImgLoaded(true);
    setIconLoadState(props.url, 'loaded');
  };

  const handleImageError = (e: Event) => {
    const target = e.currentTarget as HTMLImageElement;
    const currentSrc = target.src;

    if (!currentSrc.includes('duckduckgo')) {
      const fallback = getDDGFavicon(props.url);
      target.src = fallback;
    } else {
      setIsLoading(false);
      setImageError(true);
      setHasLoaded(true);
      setIconLoadState(props.url, 'error');
    }
  };

  return (
    <div class="grid-icon" onClick={handleClick}>
      <div class="grid-icon__icon-wrapper">
        <img
          src={iconUrl()}
          alt={props.name}
          classList={{
            'grid-icon__img': true,
            'grid-icon__img--loaded': isImgLoaded() && !imageError(),
            'grid-icon__img--hidden': !isImgLoaded() || imageError(),
          }}
          draggable={false}
          onLoad={handleImageLoad}
          onError={handleImageError}
        />

        <Show when={!isImgLoaded() && !imageError()}>
          <div class="grid-icon__loading">
            <div class="spinner spinner--small"></div>
          </div>
        </Show>

        <Show when={imageError()}>
          <div class="grid-icon__placeholder">
            <span class="grid-icon__error">{props.name.charAt(0).toUpperCase()}</span>
          </div>
        </Show>
      </div>
      <span class="grid-icon__name">{props.name}</span>
    </div>
  );
};
