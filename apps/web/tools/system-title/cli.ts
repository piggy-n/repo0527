import { loadEnv } from 'vite';
import { systemTitlePaths } from './paths.ts';
import { syncTitleOutline } from './sync.ts';

// 手动同步标题轮廓：在 apps/web 下运行 pnpm title:generate
const text = loadEnv('production', process.cwd(), 'VITE_').VITE_APP_TITLE;
if (!text) {
  console.error('[system-title] .env 中没有 VITE_APP_TITLE');
  process.exit(1);
}

const paths = systemTitlePaths(process.cwd());
const result = syncTitleOutline({ text, ...paths });
const messages = {
  generated: `已按"${text}"重新生成标题轮廓`,
  unchanged: '标题轮廓已是最新，无需生成',
  'font-missing': `找不到字体文件 ${paths.fontPath}，请按 docs/modules/system-title.md 放置`
};
console.log(`[system-title] ${messages[result]}`);
process.exit(result === 'font-missing' ? 1 : 0);
