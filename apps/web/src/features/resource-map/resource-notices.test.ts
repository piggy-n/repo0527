// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { type ResourceNoticeInput, resourceNotices } from './resource-notices';

const NORMAL: ResourceNoticeInput = { checked: true, configError: false, tileError: false, minzoom: 9, zoom: 9 };

describe('resourceNotices', () => {
  it('勾选了、级别够、没有错误：没有提示', () => {
    expect(resourceNotices(NORMAL)).toStrictEqual([]);
  });

  it('勾选了但当前级别低于最小显示级别：提示放大到几级；没勾选、没有限制时不提示', () => {
    expect(resourceNotices({ ...NORMAL, zoom: 8.9 })).toStrictEqual(['放大至第 9 级显示']);
    expect(resourceNotices({ ...NORMAL, zoom: 8.9, checked: false })).toStrictEqual([]);
    expect(resourceNotices({ ...NORMAL, zoom: 3, minzoom: undefined })).toStrictEqual([]);
  });

  it('瓦片加载失败可以和级别提示同时出现；配置错误时只提示配置错误', () => {
    expect(resourceNotices({ ...NORMAL, zoom: 7, tileError: true })).toStrictEqual([
      '放大至第 9 级显示',
      '部分瓦片加载失败'
    ]);
    expect(resourceNotices({ ...NORMAL, zoom: 7, tileError: true, configError: true })).toStrictEqual([
      '配置错误，不显示'
    ]);
  });
});
