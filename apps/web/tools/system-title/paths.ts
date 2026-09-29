import { resolve } from 'node:path';

/** 字体与输出文件的位置，appRoot 是 apps/web 目录；Vite 插件和命令行共用 */
export function systemTitlePaths(appRoot: string) {
  return {
    fontPath: resolve(appRoot, '../../local-assets/fonts/YouSheBiaoTiHei-2.ttf'),
    outputPath: resolve(appRoot, 'src/shared/system-title/system-title-outline.json')
  };
}
