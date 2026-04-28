/**
 * Vitest setup file
 * - 注入 chrome.storage.local 内存实现
 * - 注入 chrome.runtime mock
 * - mock fetch / WebSocket（默认不发数据，按需在测试里 spy）
 * - 注入 @testing-library/jest-dom 自定义 matcher
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';

type StorageRecord = Record<string, any>;

const createInMemoryStorage = () => {
  let store: StorageRecord = {};

  const get = vi.fn((keys: any, callback?: (result: StorageRecord) => void) => {
    let result: StorageRecord = {};
    if (keys === null || keys === undefined) {
      result = { ...store };
    } else if (typeof keys === 'string') {
      if (keys in store) result[keys] = store[keys];
    } else if (Array.isArray(keys)) {
      for (const k of keys) {
        if (k in store) result[k] = store[k];
      }
    } else if (typeof keys === 'object') {
      for (const k of Object.keys(keys)) {
        result[k] = k in store ? store[k] : keys[k];
      }
    }
    if (typeof callback === 'function') {
      callback(result);
    }
    return Promise.resolve(result);
  });

  const set = vi.fn((items: StorageRecord, callback?: () => void) => {
    Object.assign(store, items);
    if (typeof callback === 'function') callback();
    return Promise.resolve();
  });

  const remove = vi.fn((keys: string | string[], callback?: () => void) => {
    const arr = Array.isArray(keys) ? keys : [keys];
    for (const k of arr) {
      delete store[k];
    }
    if (typeof callback === 'function') callback();
    return Promise.resolve();
  });

  const clear = vi.fn((callback?: () => void) => {
    store = {};
    if (typeof callback === 'function') callback();
    return Promise.resolve();
  });

  return {
    get,
    set,
    remove,
    clear,
    __reset() {
      store = {};
      get.mockClear();
      set.mockClear();
      remove.mockClear();
      clear.mockClear();
    },
    __getStore() {
      return store;
    },
    __setStore(next: StorageRecord) {
      store = { ...next };
    },
  };
};

const inMemoryLocal = createInMemoryStorage();

(globalThis as any).__memoryStorage = inMemoryLocal;

// chrome.* 命名空间
(globalThis as any).chrome = {
  storage: {
    local: inMemoryLocal,
  },
  runtime: {
    id: 'test-extension-id',
    lastError: undefined as any,
  },
};

// fetch — 默认抛错，每个测试自行覆盖
if (!(globalThis as any).fetch) {
  (globalThis as any).fetch = vi.fn(() => Promise.reject(new Error('fetch not mocked')));
}

// localStorage — 简易内存实现（jsdom 默认会带，但 vitest 偶有不一致）
if (
  typeof (globalThis as any).localStorage === 'undefined' ||
  typeof (globalThis as any).localStorage.clear !== 'function'
) {
  let lsStore: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem(key: string) {
      return key in lsStore ? lsStore[key] : null;
    },
    setItem(key: string, value: string) {
      lsStore[key] = String(value);
    },
    removeItem(key: string) {
      delete lsStore[key];
    },
    clear() {
      lsStore = {};
    },
    key(index: number) {
      return Object.keys(lsStore)[index] ?? null;
    },
    get length() {
      return Object.keys(lsStore).length;
    },
  };
}

// WebSocket — 默认 stub，可被测试替换
class StubWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  url: string;
  onopen: ((ev: any) => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  constructor(url: string) {
    this.url = url;
  }
  send() {}
  close() {
    this.readyState = StubWebSocket.CLOSED;
    if (typeof this.onclose === 'function') {
      this.onclose({ code: 1000, reason: '' });
    }
  }
}
if (!(globalThis as any).WebSocket) {
  (globalThis as any).WebSocket = StubWebSocket;
}

// 每个测试结束后重置存储与计时器
beforeEach(() => {
  inMemoryLocal.__reset();
  (globalThis as any).chrome.runtime.lastError = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});
