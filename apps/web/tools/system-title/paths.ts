import { resolve } from 'node:path';
import type { OutlineSpec } from './sync.ts';

export interface OutlineConfig {
  fontPath: string;
  outlines: OutlineSpec[];
}

/** 要生成的文字轮廓；appRoot 是 apps/web 目录，title 是 VITE_APP_TITLE。Vite 插件、命令行和检查测试共用 */
export function titleOutlineConfig(appRoot: string, title: string): OutlineConfig {
  const outputDir = resolve(appRoot, 'src/shared/system-title');
  return {
    fontPath: resolve(appRoot, 'public/fonts/YouSheBiaoTiHei-2.ttf'),
    outlines: [
      { text: title, outputPath: resolve(outputDir, 'system-title-outline.json') },
      // 登录页的装饰文字；旧页面是 16px 字号、2px 字间距，即 0.125em
      { text: 'WELCOME!', letterSpacing: 0.125, outputPath: resolve(outputDir, 'welcome-outline.json') }
    ]
  };
}
