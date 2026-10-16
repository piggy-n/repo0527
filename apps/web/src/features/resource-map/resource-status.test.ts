// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { type ResourceStatusInput, resourceStatuses } from './resource-status';

const NORMAL: ResourceStatusInput = { checked: true, configError: false, tileError: false, minzoom: 9, zoom: 9 };

const MINZOOM = { kind: 'minzoom', level: 'info', text: '放大至第 9 级显示' } as const;
const TILE_ERROR = { kind: 'tile-error', level: 'warning', text: '有瓦片加载失败' } as const;

describe('resourceStatuses', () => {
  it('勾选了、级别够、没有错误：没有状态', () => {
    expect(resourceStatuses(NORMAL)).toStrictEqual([]);
  });

  it('勾选了但当前级别低于最小显示级别：说明放大到几级；没勾选、没有限制时没有', () => {
    expect(resourceStatuses({ ...NORMAL, zoom: 8.9 })).toStrictEqual([MINZOOM]);
    expect(resourceStatuses({ ...NORMAL, zoom: 8.9, checked: false })).toStrictEqual([]);
    expect(resourceStatuses({ ...NORMAL, zoom: 3, minzoom: undefined })).toStrictEqual([]);
  });

  it('瓦片加载失败和级别不够同时出现时，瓦片加载失败在前（更严重）', () => {
    expect(resourceStatuses({ ...NORMAL, zoom: 7, tileError: true })).toStrictEqual([TILE_ERROR, MINZOOM]);
  });

  it('配置错误时只有它', () => {
    expect(resourceStatuses({ ...NORMAL, zoom: 7, tileError: true, configError: true })).toStrictEqual([
      { kind: 'config-error', level: 'error', text: '配置错误' }
    ]);
  });
});
