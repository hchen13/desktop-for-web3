/**
 * Grid 中用户添加的图标组件
 * 支持全局缓存，跨 tab/session 复用加载状态
 * 支持防止拖拽后的误点击
 */

import { createSignal, Show, createEffect, onMount } from 'solid-js';
import { getDDGFavicon } from '../services/faviconService';
import { DragSystem } from '../events/DragSystem';
import { getCachedIconUrl, getIconLoadState, setIconLoadState, detectBestIcon } from '../services/iconCache';

interface GridIconProps {
  url: string;
  name: string;
}

const MIN_QUALITY_SIZE = 96;

export const GridIcon = (props: GridIconProps) => {
  // 从全局缓存获取 URL（同步，立即可用）
  const [iconUrl, setIconUrl] = createSignal(getCachedIconUrl(props.url));

  // 检查全局加载状态，如果已加载过则直接显示
  const globalState = getIconLoadState(props.url);
  const [isLoading, setIsLoading] = createSignal(globalState !== 'loaded');
  const [hasLoaded, setHasLoaded] = createSignal(globalState === 'loaded');
  const [imageError, setImageError] = createSignal(false);

  // 本地状态：追踪实际图片元素是否已加载完成
  // 即使全局缓存说已加载，新创建的 img 元素仍需重新加载
  const [isImgLoaded, setIsImgLoaded] = createSignal(false);

  // 监听 URL 变化，更新图标
  createEffect((prevUrl) => {
    const url = props.url;
    if (url === prevUrl) return prevUrl;

    const state = getIconLoadState(url);
    setIconUrl(getCachedIconUrl(url));
    setIsLoading(state !== 'loaded');
    setHasLoaded(state === 'loaded');
    setImageError(false);

    // 如果未检测过最佳图标，触发异步检测
    if (state !== 'loaded' && state !== 'error') {
      detectBestIcon(url).then(bestUrl => {
        if (bestUrl && bestUrl !== getCachedIconUrl(url)) {
          setIconUrl(bestUrl);
        }
      });
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
    const { naturalWidth, naturalHeight } = img;

    setIsLoading(false);
    setHasLoaded(true);
    setIsImgLoaded(true); // 标记本地图片已加载
    setIconLoadState(props.url, 'loaded');

    // 尺寸不达标时检测更高质量版本
    if (naturalWidth < MIN_QUALITY_SIZE || naturalHeight < MIN_QUALITY_SIZE) {
      detectBestIcon(props.url).then(bestUrl => {
        const current = getCachedIconUrl(props.url);
        if (bestUrl && bestUrl !== current) {
          setIconUrl(bestUrl);
          setIsImgLoaded(false); // 新图片需要重新加载
        }
      });
    }
  };

  const handleImageError = (e: Event) => {
    const target = e.currentTarget as HTMLImageElement;
    const currentSrc = target.src;

    if (!currentSrc.includes('duckduckgo')) {
      target.src = getDDGFavicon(props.url);
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
            'grid-icon__img--loaded': isImgLoaded(),
            'grid-icon__img--hidden': !isImgLoaded(),
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
            <span class="grid-icon__error">?</span>
          </div>
        </Show>
      </div>
      <span class="grid-icon__name">{props.name}</span>
    </div>
  );
};
