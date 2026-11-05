// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { builtInMinZooms, resourceMinZoomsSchema } from './min-zooms';

describe('构建时带上的层级', () => {
  it('单张瓦片 6 MB 的实测结果（ADR 0132）和第一次请求很慢的三个资源（ADR 0136）', () => {
    expect(builtInMinZooms()).toStrictEqual({
      bgdc_cjdcq: 8,
      bgdc_cjdcqjx: 8,
      bgdc_lmfw: 8,
      bgdc_yjjbnttb: 8,
      csxhjctb_lctl: 9,
      csxhjctb_lrdl: 9,
      csxhjctb_lvll: 8,
      szy_hl_fs: 8,
      szy_hl_ks: 8
    });
  });

  it('符合部署文件的格式', () => {
    expect(resourceMinZoomsSchema.safeParse(builtInMinZooms()).success).toBe(true);
  });

  it('关闭开关时不限制（ADR 0132）', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_RESOURCE_MIN_ZOOM_ENABLED', 'false');
    const disabled = await import('./min-zooms');

    expect(disabled.builtInMinZooms()).toStrictEqual({});
  });
});

describe('部署文件的格式', () => {
  it('资源到级别；空表表示都不限制', () => {
    expect(resourceMinZoomsSchema.parse({ csxhjctb_lrdl: 12 })).toStrictEqual({ csxhjctb_lrdl: 12 });
    expect(resourceMinZoomsSchema.parse({})).toStrictEqual({});
  });

  it.each([
    ['数组', [8]],
    ['字符串', '8'],
    ['级别不是数字', { a: '8' }],
    ['级别不是整数', { a: 8.5 }],
    ['级别是负数', { a: -1 }],
    ['级别超过数据源的最大级别，资源就画不出来了', { a: 16 }]
  ])('%s：不接受', (_, value) => {
    expect(resourceMinZoomsSchema.safeParse(value).success).toBe(false);
  });
});
