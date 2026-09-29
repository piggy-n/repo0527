import { resolve } from 'node:path';

/** 图标目录与注册表的位置，appRoot 是 apps/web 目录；Vite 插件和检查测试共用 */
export function iconsPaths(appRoot: string) {
  return {
    dir: resolve(appRoot, 'src/assets/icons'),
    registryPath: resolve(appRoot, 'src/shared/icons/icons.json')
  };
}
