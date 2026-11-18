import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { ref } from 'vue';
import { required } from '@/shared/testing/required';
import { PartTabs } from './PartTabs';

const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach(host => host.remove());
});

const frame = () => new Promise(resolve => requestAnimationFrame(resolve));

// 等平滑滚动停下：连续 6 帧 scrollLeft 不变，最多等 240 帧
async function scrollSettled(view: HTMLElement): Promise<void> {
  let last = Number.NaN;
  let still = 0;
  for (let frames = 0; still < 6 && frames < 240; frames++) {
    // oxlint-disable-next-line no-await-in-loop -- 一帧一帧地看滚动停没停
    await frame();
    still = view.scrollLeft === last ? still + 1 : 0;
    last = view.scrollLeft;
  }
}

// 点一次按钮，再等 settle
async function press(button: HTMLButtonElement, settle: () => Promise<unknown>): Promise<void> {
  await userEvent.click(button);
  await settle();
}

interface Layout {
  /** 滚动区的可视宽度 */
  readonly view: number;
  /** 界面缩放（--ui-scale） */
  readonly scale: number;
  readonly parts: readonly string[];
  /** 「综合」和各分项的宽度 */
  readonly widths: readonly number[];
}

// 分项栏两侧各有一个 24 像素的按钮和 6 像素的间距
const STEP_BUTTONS = 60;

function mountTabs({ view: viewWidth, scale, parts, widths }: Layout) {
  const host = document.createElement('div');
  host.style.cssText = `width:${viewWidth + STEP_BUTTONS}px;--ui-scale:${scale}`;
  document.body.append(host);
  hosts.push(host);
  const selected = ref<string | null>(null);
  mount(
    () => (
      <PartTabs
        parts={parts.map(name => ({ id: name, name }))}
        selected={selected.value}
        label="分项"
        onSelect={(id: string | null) => {
          selected.value = id;
        }}
      />
    ),
    { attachTo: host }
  );
  const view = required(host.querySelector<HTMLElement>('[role="tablist"]'), '分项栏');
  // 测试环境没有部署的字体，分项按真实页面的宽度写死
  const tabs = [...view.querySelectorAll<HTMLElement>('[role="tab"]')];
  widths.forEach((width, position) => {
    const tab = required(tabs[position], `第 ${position + 1} 个分项`);
    tab.style.boxSizing = 'border-box';
    tab.style.width = `${width}px`;
  });
  expect(view.clientWidth).toBe(viewWidth);
  const button = (label: string) => required(host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`), label);
  return { view, button };
}

// 选中项是否完整露出，以及两侧边缘切出的露出不到 24 像素（PartTabs 的 SLIVER）的窄条；
// 容差半个像素：getBoundingClientRect 的位置可能带小数
function layout(view: HTMLElement): { selected: string; whole: boolean; slivers: string[] } {
  const outer = view.getBoundingClientRect();
  const tabs = [...view.querySelectorAll<HTMLElement>('[role="tab"]')];
  const current = required(tabs.find(item => item.getAttribute('aria-selected') === 'true'), '选中项');
  const whole = (box: DOMRect) => box.left >= outer.left - 0.5 && box.right <= outer.right + 0.5;
  return {
    selected: current.textContent ?? '',
    whole: whole(current.getBoundingClientRect()),
    slivers: tabs
      .filter(item => {
        const box = item.getBoundingClientRect();
        const shown = Math.min(box.right, outer.right) - Math.max(box.left, outer.left);
        return !whole(box) && shown > 0.5 && shown < 24;
      })
      .map(item => item.textContent ?? '')
  };
}

const TRUNK = ['与一级公路之间距离', '与二级公路之间距离', '与高速公路之间距离'];
const HUB = ['与客运中心之间距离', '与机场之间距离', '与港口之间距离', '与火车站之间距离'];

// 可视宽和分项宽度：交通干线便捷度是 1920×1080、1366×768 真实页面的实测（取整），交通枢纽便捷度按 1920 实测的每字宽度推算
const CASES: readonly (Layout & { title: string })[] = [
  { title: '交通干线便捷度 1920×1080', view: 344, scale: 1, parts: TRUNK, widths: [60, 179, 179, 179] },
  { title: '交通干线便捷度 1366×768', view: 222, scale: 0.9, parts: TRUNK, widths: [54, 161, 161, 161] },
  { title: '交通枢纽便捷度 1920×1080', view: 344, scale: 1, parts: HUB, widths: [60, 179, 145, 145, 162] }
];

describe('PartTabs 在真实布局里', () => {
  for (const { title, ...geometry } of CASES) {
    const names = ['综合', ...geometry.parts];
    // 右箭头逐个切到最后一项，再左箭头逐个切回「综合」
    const steps = [
      ...names.slice(1).map(name => ['下一个分项', name] as const),
      ...names.slice(0, -1).toReversed().map(name => ['上一个分项', name] as const)
    ];

    it(`${title}：逐个切到最后一项再逐个切回「综合」，每一步选中项完整、两侧边缘不留窄条`, async () => {
      const { view, button } = mountTabs(geometry);
      for (const [label, name] of steps) {
        // oxlint-disable-next-line no-await-in-loop -- 每次点完等滚动停下再检查、再点下一次
        await press(button(label), () => scrollSettled(view));
        expect(layout(view)).toEqual({ selected: name, whole: true, slivers: [] });
      }
    });

    it(`${title}：连点左右箭头，停下后选中项完整、两侧边缘不留窄条`, async () => {
      const { view, button } = mountTabs(geometry);
      for (let count = 0; count < geometry.parts.length; count++) {
        // oxlint-disable-next-line no-await-in-loop -- 一次接一次地点，中间只隔一帧，上一次的平滑滚动还没停
        await press(button('下一个分项'), frame);
      }
      await scrollSettled(view);
      expect(layout(view)).toEqual({ selected: names.at(-1), whole: true, slivers: [] });
      for (let count = 1; count < geometry.parts.length; count++) {
        // oxlint-disable-next-line no-await-in-loop -- 同上
        await press(button('上一个分项'), frame);
      }
      await scrollSettled(view);
      expect(layout(view)).toEqual({ selected: names[1], whole: true, slivers: [] });
    });
  }
});
