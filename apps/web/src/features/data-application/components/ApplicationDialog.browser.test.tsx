import 'element-plus/dist/index.css';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { computed, nextTick, reactive, ref } from 'vue';
import type { Application } from '../api';
import type { ApplicationReviewOwner } from '../composables/useApplicationReview';
import { ApplicationDialog } from './ApplicationDialog';

// 真实的布局（ADR 0040）：弹窗的宽度、描述列表两列对齐、长内容在自己的位置换行、窄屏一列

// 与页面一致的令牌，feature 测试不反向导入 app
const TOKENS = {
  '--space-xs': '4px',
  '--space-sm': '8px',
  '--space-md': '12px',
  '--space-lg': '16px',
  '--color-text-primary': '#333333',
  '--color-text-secondary': '#8a94a6'
};

const application: Application = {
  id: 'apply-1',
  name: '南京市主城区学校点位（含新建校区与九年一贯制学校的补充调查成果，名称很长需要换行）',
  applicant: '王立',
  department: '江苏省基础地理信息中心',
  layerCode: 'csxhjctb_xxp_2022',
  region: '江苏省南京市玄武区',
  appliedAt: '2026-10-27 16:05:12',
  startTime: '2026-10-27 08:00:00',
  endTime: '2026-12-31 23:59:59',
  formats: ['excel', 'word', 'echarts', 'shp', 'gdb'],
  purpose: '用于教育设施服务半径分析',
  status: 'pending',
  reason: undefined,
  prepare: undefined
};

// 组件只读拥有者的状态和方法，这里给一个固定的
function owner(): ApplicationReviewOwner {
  return {
    application: computed(() => application),
    state: computed(() => 'ready' as const),
    mode: computed(() => 'audit' as const),
    form: reactive({ approved: true, reason: '' }),
    pending: ref(false),
    submit: () => Promise.resolve(null),
    retry: () => undefined
  };
}

const mounted: VueWrapper[] = [];

beforeAll(() => {
  Object.entries(TOKENS).forEach(([name, value]) => document.documentElement.style.setProperty(name, value));
});

afterEach(async () => {
  mounted.splice(0).forEach(wrapper => wrapper.unmount());
  document.body.innerHTML = '';
  await page.viewport(1280, 800);
});

async function open() {
  mounted.push(mount(ApplicationDialog, { props: { owner: owner() }, attachTo: document.body }));
  await nextTick();
  await expect.poll(() => document.querySelector('.el-dialog .el-descriptions')).not.toBeNull();
  const dialog = document.querySelector<HTMLElement>('.el-dialog');
  if (!dialog) {
    throw new Error('弹窗没有渲染');
  }
  return dialog;
}

// "申请信息"里每一项的标签和值的位置
function items(dialog: HTMLElement) {
  const first = dialog.querySelector('.el-descriptions');
  return [...(first?.querySelectorAll('.el-descriptions__cell') ?? [])].map(cell => {
    const label = cell.querySelector('.el-descriptions__label')?.getBoundingClientRect();
    const content = cell.querySelector('.el-descriptions__content')?.getBoundingClientRect();
    return {
      label: cell.querySelector('.el-descriptions__label')?.textContent ?? '',
      contentLeft: Math.round(content?.left ?? 0),
      contentTop: Math.round(content?.top ?? 0),
      contentHeight: Math.round(content?.height ?? 0),
      labelHeight: Math.round(label?.height ?? 0)
    };
  });
}

describe('ApplicationDialog 的布局', () => {
  it('宽屏：640 宽，两列的值各自上下对齐；长名称在值的位置换行，不绕到标签下面', async () => {
    const dialog = await open();
    expect(Math.round(dialog.getBoundingClientRect().width)).toBe(640);

    const cells = items(dialog);
    const byLabel = Object.fromEntries(cells.map(cell => [cell.label, cell]));
    // 左列：申请人、主题图层、开始时间、导出格式；右列：申请处室、行政区划、结束时间、申请时间
    const left = ['数据名称', '申请人', '主题图层', '开始时间', '导出格式', '申请用途'].map(name => byLabel[name]?.contentLeft);
    const right = ['申请处室', '行政区划', '结束时间', '申请时间'].map(name => byLabel[name]?.contentLeft);
    expect(new Set(left).size).toBe(1);
    expect(new Set(right).size).toBe(1);
    expect(right[0]).toBeGreaterThan(left[0] ?? 0);

    const name = byLabel['数据名称'];
    expect(name?.contentHeight).toBeGreaterThan(name?.labelHeight ?? 0);
    expect(name?.contentLeft).toBe(left[0]);
    expect(dialog.querySelectorAll('.el-dialog__footer button')).toHaveLength(2);
  });

  it('窄屏：宽度是视口减 32，每行一项，值仍然对齐', async () => {
    await page.viewport(390, 844);
    const dialog = await open();
    expect(Math.round(dialog.getBoundingClientRect().width)).toBe(390 - 32);

    const cells = items(dialog);
    expect(new Set(cells.map(cell => cell.contentLeft)).size).toBe(1);
    const tops = cells.map(cell => cell.contentTop);
    expect(tops).toEqual(tops.toSorted((a, b) => a - b));
    expect(new Set(tops).size).toBe(cells.length);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  });
});
