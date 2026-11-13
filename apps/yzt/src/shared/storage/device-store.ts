import type { z } from 'zod';

// 设备级、同步的小存储（ADR 0155 第 4 节）：三维的崩溃标记、这台设备的降档记录。它们不是偏好：不分用户，
// 也不走 VITE_PREFERENCE_* 的开关。要同步写：标签页被杀之前异步的 IndexedDB 可能还没写完，pagehide 里也不能等。
// 值存成 JSON，读出时按 schema 校验，不合法的删掉；浏览器禁用存储、空间满时读写都安静地失败

const NAMESPACE = 'yzt.device.';

/** 设备级的同步键值存储：键不带存储自己的前缀 */
export interface DeviceStore {
  /** 没有、读不了、不合法时为 undefined（不合法的顺手删掉） */
  get<T>(key: string, schema: z.ZodType<T>): T | undefined;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  /** 以 prefix 开头的所有键 */
  keys(prefix: string): string[];
}

// 禁用存储时连访问 localStorage 都会抛错
function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** storage 不给时用浏览器的 localStorage；测试传自己的 */
export function createDeviceStore(storage: Storage | null = browserStorage()): DeviceStore {
  const remove = (key: string) => {
    try {
      storage?.removeItem(NAMESPACE + key);
    } catch {
      // 读写失败时没有可做的
    }
  };
  return {
    get<T>(key: string, schema: z.ZodType<T>): T | undefined {
      let raw: string | null = null;
      try {
        raw = storage?.getItem(NAMESPACE + key) ?? null;
      } catch {
        return undefined;
      }
      if (raw === null) {
        return undefined;
      }
      try {
        const parsed = schema.safeParse(JSON.parse(raw));
        if (parsed.success) {
          return parsed.data;
        }
      } catch {
        // JSON 坏了
      }
      remove(key);
      return undefined;
    },
    set(key, value) {
      try {
        storage?.setItem(NAMESPACE + key, JSON.stringify(value));
      } catch {
        // 空间满或禁用存储：这台设备记不住，下次按没记过处理
      }
    },
    remove,
    keys(prefix) {
      const result: string[] = [];
      try {
        for (let index = 0; index < (storage?.length ?? 0); index++) {
          const full = storage?.key(index);
          if (full?.startsWith(NAMESPACE + prefix)) {
            result.push(full.slice(NAMESPACE.length));
          }
        }
      } catch {
        return [];
      }
      return result;
    }
  };
}

/** 浏览器的设备级存储 */
export const deviceStore: DeviceStore = createDeviceStore();
