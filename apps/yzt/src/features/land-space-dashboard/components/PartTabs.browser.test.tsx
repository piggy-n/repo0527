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

// 等平滑滚动停下：连续 6 帧 scrollLeft 不变，最多等 240 帧；一帧一帧递归地等
async function scrollSettled(view: HTMLElement, last = Number.NaN, still = 0, frames = 0): Promise<void> {
  if (still >= 6 || frames >= 240) {
    return;
  }
  await frame();
  await scrollSettled(view, view.scrollLeft, view.scrollLeft === last ? still + 1 : 0, frames + 1);
}

// 依次点按钮：每点一次等 settle，再做这一步的检查；递归逐个等，前一次点完才点下一次
async function clickSteps(
  button: HTMLButtonElement,
  checks: readonly (() => void)[],
  settle: () => Promise<unknown>
): Promise<void> {
  const [check, ...rest] = checks;
  if (!check) {
    return;
  }
  await userEvent.click(button);
  await settle();
  check();
  await clickSteps(button, rest, settle);
}

function mountTabs(width: number, names: readonly string[]) {
  const host = document.createElement('div');
  host.style.width = `${width}px`;
  document.body.append(host);
  hosts.push(host);
  const parts = names.map(name => ({ id: name, name }));
  const selected = ref<string | null>(null);
  mount(
    () => (
      <PartTabs
        parts={parts}
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
  const tab = (name: string) =>
    required([...view.querySelectorAll<HTMLElement>('[role="tab"]')].find(item => item.textContent === name), name);
  const button = (label: string) => required(host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`), label);
  return { view, tab, button };
}

// 选中项是否完整露出，以及左边缘切到一半的分项（容差半个像素：scrollLeft 是整数、按钮宽度可能带小数）
function layout(view: HTMLElement): { selected: string; whole: boolean; cutAtLeft: string[] } {
  const outer = view.getBoundingClientRect();
  const tabs = [...view.querySelectorAll<HTMLElement>('[role="tab"]')];
  const current = required(tabs.find(item => item.getAttribute('aria-selected') === 'true'), '选中项');
  const rect = current.getBoundingClientRect();
  return {
    selected: current.textContent ?? '',
    whole: rect.left >= outer.left - 0.5 && rect.right <= outer.right + 0.5,
    cutAtLeft: tabs
      .filter(item => {
        const box = item.getBoundingClientRect();
        return box.left < outer.left - 0.5 && box.right > outer.left + 0.5;
      })
      .map(item => item.textContent ?? '')
  };
}

// 连点时每一步不检查
const skip = () => undefined;

// 宽度按真实卡片里分项栏的可视宽度取：用户举的例子、交通干线便捷度在 1920、1366 下
const CASES = [
  ['用户举的例子', 240, ['aa', 'bbbbbbbbbbbbbbbb', 'cccccccccccccc']],
  ['交通干线便捷度 1920', 344, ['与一级公路之间距离', '与二级公路之间距离', '与高速公路之间距离']],
  ['交通干线便捷度 1366', 222, ['与一级公路之间距离', '与二级公路之间距离', '与高速公路之间距离']]
] as const;

describe('PartTabs 在真实布局里', () => {
  for (const [title, width, names] of CASES) {
    it(`${title}：右箭头切到最后一项，再逐个左箭头切回「综合」，每一步选中项完整、左边缘不切到半个分项`, async () => {
      const { view, button } = mountTabs(width, names);
      const settle = () => scrollSettled(view);
      await clickSteps(button('下一个分项'), names.map(() => () => expect(layout(view).whole).toBe(true)), settle);
      const backward = [...names.slice(0, -1).toReversed(), '综合'];
      await clickSteps(
        button('上一个分项'),
        backward.map(name => () => expect(layout(view)).toEqual({ selected: name, whole: true, cutAtLeft: [] })),
        settle
      );
    });

    it(`${title}：连点左右箭头，停下后选中项完整、左边缘不切到半个分项`, async () => {
      const { view, button } = mountTabs(width, names);
      await clickSteps(button('下一个分项'), names.map(() => skip), frame);
      await scrollSettled(view);
      expect(layout(view).whole).toBe(true);
      await clickSteps(button('上一个分项'), names.slice(1).map(() => skip), frame);
      await scrollSettled(view);
      expect(layout(view)).toEqual({ selected: names[0], whole: true, cutAtLeft: [] });
    });
  }
});
