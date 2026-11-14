import 'element-plus/dist/index.css';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { required } from '../../testing/required';
import { EMPTY_CATALOG_SELECTION } from './catalog-selection';
import type { CatalogLeaf, CatalogNode } from './catalog-tree';
import { CatalogTree } from './CatalogTree';

// 真实的布局（ADR 0040）：引导线是伪元素，位置要量，jsdom 里没有布局

const leaf = (key: string): CatalogLeaf => ({ kind: 'leaf', key, label: key, icon: 'geometry-polygon', added: false });

// 三层：基础库 → 国土变更 → 两项；三维模型 → 苏州市 → 一项
const NODES: CatalogNode[] = [
  {
    kind: 'branch',
    key: 'base',
    label: '基础库',
    children: [{ kind: 'branch', key: 'land', label: '国土变更', children: [leaf('a'), leaf('b')] }]
  },
  {
    kind: 'branch',
    key: 'models',
    label: '三维模型',
    children: [{ kind: 'branch', key: 'suzhou', label: '苏州市', children: [leaf('m')] }]
  }
];

function mountTree() {
  const host = document.body.appendChild(document.createElement('div'));
  host.style.width = '320px';
  mount(
    defineComponent(() => () => (
      <CatalogTree
        nodes={NODES}
        expanded={new Set(['base', 'land', 'models', 'suzhou'])}
        selection={EMPTY_CATALOG_SELECTION}
        label="资源目录"
      />
    )),
    { attachTo: host }
  );
  return host;
}

describe('CatalogTree（浏览器）', () => {
  it('每一层下面的引导线对着这一层分类箭头的中线：第二层的线不和第一层的叠在一起', () => {
    const host = mountTree();
    try {
      const lines = ['base', 'land', 'models', 'suzhou'].map(key => {
        const row = required(host.querySelector<HTMLElement>(`[data-catalog-node="${key}"]`), `分类 ${key}`);
        const arrow = required(row.querySelector('button'), `${key} 的箭头`).getBoundingClientRect();
        const list = required(row.nextElementSibling, `${key} 下面的列表`);
        const style = getComputedStyle(list, '::before');
        const line = list.getBoundingClientRect().left + Number.parseFloat(style.left) + Number.parseFloat(style.width) / 2;
        return { key, offset: Math.abs(line - (arrow.left + arrow.width / 2)), line };
      });
      // 离箭头中线超过 1 像素的分类
      expect(lines.filter(({ offset }) => offset > 1).map(({ key, offset }) => `${key} ${offset}`)).toStrictEqual([]);
      // 第二层比第一层往右一个缩进
      const [first, second] = lines.map(({ line }) => line);
      expect(required(second, '第二层的线') - required(first, '第一层的线')).toBeCloseTo(18, 0);
    } finally {
      host.remove();
    }
  });
});
