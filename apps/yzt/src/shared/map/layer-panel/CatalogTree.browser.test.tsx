import 'element-plus/dist/index.css';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { computed, defineComponent, nextTick, ref } from 'vue';
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
        label="资源"
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

  it('点在行尾的复选框上就是点在行上（用户 2026-11-24）：切换一次、框跟着勾上，焦点在行上；框接了指针时焦点会进 input，浏览器还会再点一次 input 把它翻回去', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    host.style.width = '320px';
    const added = ref<ReadonlySet<string>>(new Set());
    const events: string[][] = [];
    const nodes = computed((): CatalogNode[] => [
      { kind: 'branch', key: 'land', label: '国土变更', children: [{ ...leaf('a'), added: added.value.has('a') }] }
    ]);
    mount(
      defineComponent(() => () => (
        <CatalogTree
          nodes={nodes.value}
          expanded={new Set(['land'])}
          selection={EMPTY_CATALOG_SELECTION}
          label="资源"
          onAdd={(keys: readonly string[]) => {
            events.push(['add', ...keys]);
            added.value = new Set([...added.value, ...keys]);
          }}
          onRemove={(keys: readonly string[]) => events.push(['remove', ...keys])}
        />
      )),
      { attachTo: host }
    );
    try {
      const row = required(host.querySelector<HTMLElement>('[data-catalog-node="a"]'), '项 a');
      const box = required(row.querySelector('.el-checkbox__inner'), 'a 的复选框').getBoundingClientRect();
      const rect = row.getBoundingClientRect();
      await userEvent.click(row, {
        position: { x: box.left + box.width / 2 - rect.left, y: box.top + box.height / 2 - rect.top }
      });
      await nextTick();
      expect(events).toStrictEqual([['add', 'a']]);
      expect(required(row.querySelector('input'), 'a 的复选框').checked).toBe(true);
      // 焦点在行上，上下键、空格照常
      expect(document.activeElement).toBe(row);
    } finally {
      host.remove();
    }
  });
});
