// @vitest-environment node
import { describeReport, isUpToDate, syncIcons } from '@yzt/icons/tools';
import { describe, expect, it } from 'vitest';
import { iconsPaths } from './paths.ts';

describe('项目图标', () => {
  // 测试模式下不启用自动处理的插件；这里只检查，不改动文件
  it('全部已规范化，注册表与文件一致', () => {
    const report = syncIcons(iconsPaths(process.cwd()), { write: false });

    expect(
      isUpToDate(report),
      `图标尚未处理，请在 apps/web 下运行 pnpm icons（见 docs/modules/icons.md）：\n${describeReport(report).join('\n')}`
    ).toBe(true);
  });
});
