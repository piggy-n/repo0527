import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { MxTitle } from './MxTitle';

// 真实的布局（ADR 0040）：收缩的先后由浏览器的 flex 排版决定，jsdom 里元素的尺寸都是 0

// 用到的令牌由 app 的样式给出，这里直接写出
const TOKENS = {
  '--space-sm': '8px',
  '--font-size-lg': '16px',
  '--font-size-base': '14px',
  '--font-size-xs': '12px',
  '--font-weight-semibold': '600',
  '--font-weight-regular': '400'
};
// 竖杠、标题、说明、extra 之间的间距（--space-sm）
const GAP = 8;
const TITLE = '数据申请提交';
const DESCRIPTION = '南京市 2025 年度国土变更调查成果';

const HEADING = 'h2';
const MARK = '[class*="_mark_"]';
const DESC = '[class*="_description_"]';
const EXTRA = '[class*="_extra_"]';

// 和面板头部、弹窗标题一样放在横向 flex 容器里；宽度为 null 时按内容撑开，量各部分的自然宽度
function setup({ description, extra = false }: { description?: string; extra?: boolean }) {
  const width = ref<number | null>(null);
  const host = document.body.appendChild(document.createElement('div'));
  const wrapper = mount(
    defineComponent(() => () => (
      <div
        data-container
        style={{ display: 'flex', width: width.value === null ? 'max-content' : `${width.value}px`, ...TOKENS }}
      >
        <MxTitle level="panel" description={description}>
          {{ default: () => TITLE, extra: extra ? () => [<button type="button">全部关闭</button>] : undefined }}
        </MxTitle>
      </div>
    )),
    { attachTo: host }
  );
  return {
    container: () => wrapper.get('[data-container]').element.getBoundingClientRect(),
    rect: (selector: string) => wrapper.get(selector).element.getBoundingClientRect(),
    async resize(value: number) {
      width.value = value;
      await nextTick();
    },
    [Symbol.dispose]() {
      wrapper.unmount();
      host.remove();
    }
  };
}

describe('MxTitle 的收缩顺序（真实布局）', () => {
  it('空间足够时说明完整显示，extra 靠右', async () => {
    using env = setup({ description: DESCRIPTION, extra: true });
    const description = env.rect(DESC).width;

    await env.resize(env.container().width + 100);

    expect(env.rect(DESC).width).toBeCloseTo(description, 2);
    expect(env.rect(EXTRA).right).toBeCloseTo(env.container().right, 1);
  });

  it('和说明一起放不下时先省略说明，标题保持完整，extra 不受影响', async () => {
    using env = setup({ description: DESCRIPTION, extra: true });
    const title = env.rect(HEADING).width;
    const description = env.rect(DESC).width;
    const extra = env.rect(EXTRA).width;

    await env.resize(env.container().width - description / 2);

    // 标题少零点几像素也会出现省略号，所以按亚像素比较
    expect(env.rect(HEADING).width).toBeCloseTo(title, 2);
    expect(env.rect(DESC).width).toBeGreaterThan(0);
    expect(env.rect(DESC).width).toBeLessThan(description);
    expect(env.rect(EXTRA).width).toBeCloseTo(extra, 2);
    expect(env.rect(EXTRA).right).toBeCloseTo(env.container().right, 1);
  });

  it('只有标题自己放不下时才省略标题，说明缩到 0 后不再占用间距', async () => {
    using env = setup({ description: DESCRIPTION, extra: true });
    const mark = env.rect(MARK).width;
    const title = env.rect(HEADING).width;
    const extra = env.rect(EXTRA).width;

    // 竖杠与 extra 之间正好放下标题
    await env.resize(mark + GAP + title + GAP + extra);
    expect(env.rect(DESC).width).toBe(0);
    expect(env.rect(HEADING).width).toBeCloseTo(title, 2);

    // 只放得下标题的一半：标题占满竖杠与 extra 之间的空间再省略
    await env.resize(mark + GAP + title / 2 + GAP + extra);
    expect(env.rect(DESC).width).toBe(0);
    expect(env.rect(HEADING).width).toBeLessThan(title);
    expect(env.rect(HEADING).right).toBeCloseTo(env.rect(EXTRA).left - GAP, 1);
    expect(env.rect(EXTRA).width).toBeCloseTo(extra, 2);
  });

  it('没有说明和 extra 时，标题过长照常省略并占满竖杠右侧', async () => {
    using env = setup({});
    const mark = env.rect(MARK).width;
    const title = env.rect(HEADING).width;

    await env.resize(mark + GAP + title / 2);

    expect(env.rect(HEADING).width).toBeLessThan(title);
    expect(env.rect(HEADING).right).toBeCloseTo(env.container().right, 1);
  });
});
