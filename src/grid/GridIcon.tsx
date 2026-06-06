/**
 * Grid 中用户添加的图标组件
 * 支持渐进式图标优化：所有源并发请求，谁回来就比较，更好的立即替换
 * 支持防止拖拽后的误点击
 */

import { createSignal, Show, createEffect, onCleanup } from 'solid-js';
import { DragSystem } from '../events/DragSystem';
import {
  getCachedIconUrl,
  getIconLoadState,
  detectBestIcon,
  refreshIcon,
  isStorageLoaded,
  isLikelyFallbackIcon,
  isGenericIconUrl,
  onIconUpdate,
} from '../services/iconCache';
import { BootstrapIcon } from '../components/BootstrapIcon';

interface GridIconProps {
  url: string;
  name: string;
}

const IMAGE_LOAD_TIMEOUT_MS = 8000;

export const GridIcon = (props: GridIconProps) => {
  // 从缓存获取初始 URL
  const initialUrl = getCachedIconUrl(props.url);
  const [iconUrl, setIconUrl] = createSignal(initialUrl);

  const [imageError, setImageError] = createSignal(false);

  // 本地状态：追踪实际图片元素是否已加载完成
  const [isImgLoaded, setIsImgLoaded] = createSignal(false);
  const [isRefreshing, setIsRefreshing] = createSignal(false);
  let detectionRequestId = 0;

  const requestBestIcon = (failedSrc?: string) => {
    const requestId = ++detectionRequestId;
    setImageError(false);

    detectBestIcon(props.url, {
      ignoreBuiltin: Boolean(failedSrc),
      skipUrl: failedSrc,
    })
      .then((bestIconUrl) => {
        if (requestId !== detectionRequestId) return;

        if (bestIconUrl && bestIconUrl !== failedSrc) {
          if (bestIconUrl !== iconUrl()) {
            setIconUrl(bestIconUrl);
          }
          setIsImgLoaded(false);
          setImageError(false);
          return;
        }

        if (!isImgLoaded()) {
          setImageError(true);
        }
      })
      .catch(() => {
        if (requestId !== detectionRequestId || isImgLoaded()) return;
        setImageError(true);
      })
      .finally(() => {
        if (requestId === detectionRequestId) {
          setIsRefreshing(false);
        }
      });
  };

  // 注册渐进式更新回调：当更好的图标被发现时立即更新
  createEffect(() => {
    const url = props.url;

    // 注册图标更新回调
    const unsubscribe = onIconUpdate(url, (newIconUrl) => {
      const currentIconUrl = iconUrl();
      detectionRequestId++;
      if (newIconUrl !== currentIconUrl) {
        setIconUrl(newIconUrl);
        setIsImgLoaded(false); // 新图片需要重新加载
      } else {
        setIsImgLoaded(true);
      }
      setImageError(false);
      setIsRefreshing(false);
    });

    // 清理回调
    onCleanup(unsubscribe);
  });

  createEffect(() => {
    const src = iconUrl();
    if (!src || isImgLoaded() || imageError()) return;

    const timeout = setTimeout(() => {
      if (iconUrl() !== src || isImgLoaded() || imageError()) return;
      setIsImgLoaded(false);
      requestBestIcon(src);
    }, IMAGE_LOAD_TIMEOUT_MS);

    onCleanup(() => clearTimeout(timeout));
  });

  // 监听 URL 变化，触发图标检测
  createEffect((prevUrl) => {
    const url = props.url;
    const storageReady = isStorageLoaded();

    // 如果有缓存，先使用缓存
    const cachedUrl = getCachedIconUrl(url);
    if (cachedUrl && cachedUrl !== iconUrl()) {
      setIconUrl(cachedUrl);
      setIsImgLoaded(false);
    }

    if (url === prevUrl && !storageReady) return prevUrl;

    const state = getIconLoadState(url);
    setIsImgLoaded(false);
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

    window.open(props.url, '_blank');
  };

  const handleRefreshClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const currentIconUrl = iconUrl();
    const skippedSrc =
      imageError() || !isImgLoaded() || isGenericIconUrl(currentIconUrl)
        ? currentIconUrl
        : undefined;
    const requestId = ++detectionRequestId;
    setIsRefreshing(true);
    setIsImgLoaded(false);
    setImageError(false);

    refreshIcon(props.url, skippedSrc)
      .then((bestIconUrl) => {
        if (requestId !== detectionRequestId) return;

        if (bestIconUrl) {
          if (bestIconUrl !== iconUrl()) {
            setIconUrl(bestIconUrl);
            setIsImgLoaded(false);
          } else {
            setIsImgLoaded(true);
          }
          setImageError(false);
          return;
        }

        setImageError(true);
      })
      .catch(() => {
        if (requestId !== detectionRequestId) return;
        setImageError(true);
      })
      .finally(() => {
        if (requestId === detectionRequestId) {
          setIsRefreshing(false);
        }
      });
  };

  const handleImageLoad = (e: Event) => {
    const img = e.target as HTMLImageElement;
    const currentSrc = img.currentSrc || img.src;

    if (isLikelyFallbackIcon(currentSrc, img.naturalWidth, img.naturalHeight)) {
      setIsImgLoaded(false);
      setImageError(false);
      requestBestIcon(currentSrc);
      return;
    }

    setIsImgLoaded(true);
    setImageError(false);
  };

  const handleImageError = (e: Event) => {
    const target = e.currentTarget as HTMLImageElement;
    const currentSrc = target.currentSrc || target.src;

    setIsImgLoaded(false);
    requestBestIcon(currentSrc);
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
            <div class="spinner spinner--small" />
          </div>
        </Show>

        <Show when={imageError()}>
          <div class="grid-icon__placeholder">
            <span class="grid-icon__error">{props.name.charAt(0).toUpperCase()}</span>
          </div>
        </Show>

        <button
          type="button"
          classList={{
            'grid-icon__refresh': true,
            'grid-icon__refresh--visible': imageError() || isRefreshing(),
            'grid-icon__refresh--spinning': isRefreshing(),
          }}
          title="重新加载图标"
          aria-label="重新加载图标"
          onClick={handleRefreshClick}
        >
          <BootstrapIcon iconName="arrow-clockwise" size={12} />
        </button>
      </div>
      <span class="grid-icon__name">{props.name}</span>
    </div>
  );
};
