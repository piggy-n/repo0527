import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORY_ID, type FileCategory, fileCategories, findCategoryPath } from './categories';

const allNodes = (nodes: FileCategory[]): FileCategory[] =>
  nodes.flatMap(node => [node, ...allNodes(node.children ?? [])]);

const labels = (id: string) => findCategoryPath(id).map(node => node.label);

describe('文件分类', () => {
  it('节点 id 不重复，叶子节点共 15 个（与旧项目一致）', () => {
    const nodes = allNodes(fileCategories);
    expect(new Set(nodes.map(node => node.id)).size).toBe(nodes.length);
    expect(nodes.filter(node => !node.children)).toHaveLength(15);
  });

  it('默认分类是叶子节点', () => {
    const node = allNodes(fileCategories).find(item => item.id === DEFAULT_CATEGORY_ID);
    expect(node?.children).toBeUndefined();
    expect(node?.label).toBe('自然资源调查类');
  });

  it('findCategoryPath 返回从根到该分类的节点，找不到时返回空数组', () => {
    expect(labels('technical-standard-local-monitor')).toEqual(['技术标准规范', '地方补充技术规定/细则', '监测类']);
    expect(findCategoryPath('technical-standard-local-monitor').map(node => node.id)).toEqual([
      'technical-standard',
      'technical-standard-local',
      'technical-standard-local-monitor'
    ]);
    expect(labels('policy-law')).toEqual(['政策法规']);
    expect(findCategoryPath('missing')).toEqual([]);
  });
});
