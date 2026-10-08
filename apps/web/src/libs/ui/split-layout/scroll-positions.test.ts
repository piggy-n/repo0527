import { describe, expect, it } from 'vitest';
import { captureScrollPositions, restoreScrollPositions } from './scroll-positions';

function createTree() {
  const root = document.createElement('div');
  root.innerHTML = '<div data-test="list"><div data-test="table"></div></div><div data-test="idle"></div>';
  const get = (name: string) => root.querySelector(`[data-test="${name}"]`) as HTMLElement;
  return { root, list: get('list'), table: get('table'), idle: get('idle') };
}

describe('滚动位置的记录与写回', () => {
  it('只记录滚动过的元素，包括根元素自身', () => {
    const { root, list, table } = createTree();
    root.scrollTop = 10;
    list.scrollTop = 150;
    table.scrollLeft = 40;

    const positions = captureScrollPositions(root);

    expect([...positions.entries()]).toEqual([
      [root, { top: 10, left: 0 }],
      [list, { top: 150, left: 0 }],
      [table, { top: 0, left: 40 }]
    ]);
  });

  it('移动后滚动位置被清零，写回后恢复', () => {
    const { root, list, table, idle } = createTree();
    list.scrollTop = 150;
    table.scrollLeft = 40;
    const positions = captureScrollPositions(root);

    // 模拟移动 DOM 后浏览器把滚动位置清零
    list.scrollTop = 0;
    table.scrollLeft = 0;
    restoreScrollPositions(positions);

    expect([list.scrollTop, table.scrollLeft, idle.scrollTop]).toEqual([150, 40, 0]);
  });
});
