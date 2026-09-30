import { loadEnv } from 'vite';
import { describe, expect, it } from 'vitest';
import { titleOutlineConfig } from './paths.ts';
import { readOutlineSpec } from './sync.ts';

// CI 中没有字体文件，无法重新生成，靠这条测试发现"改了文字或字间距但没有重新生成轮廓"
describe('文字轮廓', () => {
  const title = loadEnv('production', process.cwd(), 'VITE_').VITE_APP_TITLE ?? '';
  const { outlines } = titleOutlineConfig(process.cwd(), title);

  it.each(outlines)('"$text"的轮廓与配置一致', ({ text, letterSpacing = 0, outputPath }) => {
    expect(
      readOutlineSpec(outputPath),
      '文字轮廓已过期：请在本机放好字体后，在 apps/web 下运行 pnpm title:generate，见 docs/modules/system-title.md'
    ).toEqual({ text, letterSpacing });
  });
});
