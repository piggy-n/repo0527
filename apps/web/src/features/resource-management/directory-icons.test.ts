// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resourceDirectoryIcon } from './directory-icons';

describe('资源目录图标', () => {
  it('实际目录的 4 个分组和 15 个类别全部有图标', () => {
    const names = ['基础库', '公共库', '主题库', '三区三线', '土地资源', '地质/矿产资源', '海洋资源',
      '水资源', '森林资源', '草原资源', '湿地资源', '荒漠', '国家公园', '气象', '水利', '生态',
      '生态保护区', '耕地保护区', '联合审批'];
    expect(names.map(name => resourceDirectoryIcon({ id: name, name }))).not.toContain('resource-default');
  });

  it('重命名后保留后端已知图标；未知文件安全回退', () => {
    expect(resourceDirectoryIcon({ id: 'a', name: '新名称', icon: '地质_矿产资源@1x.png' })).toBe('resource-geology');
    expect(resourceDirectoryIcon({ id: 'a', name: '新名称', iconSelected: '气象1@1x.png' })).toBe('resource-weather');
    expect(resourceDirectoryIcon({ id: 'a', name: '自定义', icon: 'https://invalid/icon.svg' })).toBe('resource-default');
  });
});
