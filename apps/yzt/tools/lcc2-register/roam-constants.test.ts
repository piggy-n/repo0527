// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { EYE_HEIGHT, HEAD_CLEARANCE } from './roam.ts';

// 工具由 Node 直接运行，导入不了 @mx/map-core，眼高和头顶的余量各写了一份；测试经 Vite 解析，能读到包里的值。
// 不写静态导入：工具的类型检查（tsconfig.node.json）没有 DOM，静态导入会把 map-core 的源码带进来报错
describe('配准工具和 map-core 共用的漫游常量', () => {
  it('眼高、视点离顶板的余量和 map-core 相等：不相等时工具生成的路线眼高和步行的视点对不上', async () => {
    const core = await vi.importActual<Record<'EYE_HEIGHT' | 'HEAD_CLEARANCE', unknown>>('@mx/map-core');

    // 包里改了名字、不再导出时读到 undefined，同样不相等
    expect({ EYE_HEIGHT, HEAD_CLEARANCE }).toStrictEqual({
      EYE_HEIGHT: core.EYE_HEIGHT,
      HEAD_CLEARANCE: core.HEAD_CLEARANCE
    });
  });
});
