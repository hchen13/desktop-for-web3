/**
 * defillama 服务共享工具
 */

/** 安全检测 chrome.storage.local 是否可用 */
export function isChromeStorageAvailable(): boolean {
  try {
    return (
      typeof chrome !== 'undefined' &&
      !!chrome.storage &&
      !!chrome.storage.local &&
      typeof chrome.storage.local.get === 'function'
    );
  } catch {
    return false;
  }
}
