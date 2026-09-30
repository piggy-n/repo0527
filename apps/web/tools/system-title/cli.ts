import { loadEnv } from 'vite';
import { titleOutlineConfig } from './paths.ts';
import { syncTitleOutline } from './sync.ts';

// 手动同步文字轮廓：在 apps/web 下运行 pnpm title:generate
const title = loadEnv('production', process.cwd(), 'VITE_').VITE_APP_TITLE;
if (!title) {
  console.error('[system-title] .env 中没有 VITE_APP_TITLE');
  process.exit(1);
}

const { fontPath, outlines } = titleOutlineConfig(process.cwd(), title);
let fontMissing = false;
for (const spec of outlines) {
  const result = syncTitleOutline({ ...spec, fontPath });
  const messages = {
    generated: `已按"${spec.text}"重新生成轮廓`,
    unchanged: `"${spec.text}"的轮廓已是最新，无需生成`,
    'font-missing': `找不到字体文件 ${fontPath}，请按 docs/modules/system-title.md 放置`
  };
  console.log(`[system-title] ${messages[result]}`);
  fontMissing ||= result === 'font-missing';
}
process.exit(fontMissing ? 1 : 0);
