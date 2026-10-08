import { flushPromises, mount } from '@vue/test-utils';
import { ElButton, ElFormItem, ElInput } from 'element-plus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryForm } from './QueryForm';

// jsdom 没有布局，也没有 ResizeObserver：替身按被观察的元素记下回调，用例设定尺寸后手动触发。
// Element 的组件也会观察自己的元素，所以要按元素区分
const resizeCallbacks = new Map<Element, () => void>();

class ResizeObserverStub {
  readonly #callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }

  observe(target: Element) {
    resizeCallbacks.set(target, () => this.#callback([{ target } as ResizeObserverEntry], this));
  }

  unobserve() {}

  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resizeCallbacks.clear();
});

function mountForm() {
  return mount(() => (
    <QueryForm labelChars={6}>
      {{
        default: () => [
          <ElFormItem label="文档名称">
            <ElInput />
          </ElFormItem>,
          <ElFormItem label="年份">
            <ElInput />
          </ElFormItem>,
          <ElFormItem label="业务类型标签">
            <ElInput />
          </ElFormItem>
        ],
        actions: () => [<ElButton>查询</ElButton>, <ElButton>重置</ElButton>],
        extra: () => <ElButton>上传文档</ElButton>
      }}
    </QueryForm>
  ));
}

type Wrapper = ReturnType<typeof mountForm>;

const fieldsOf = (wrapper: Wrapper) => wrapper.find<HTMLElement>('.form-query__fields');
const actionsOf = (wrapper: Wrapper) => wrapper.find('.form-query__actions');

// 条件区左边缘在 100，条件之间的间距 16。标签按文字宽度时三个条件宽 248、220、276，排成一行要 776；
// 统一宽度后每个都宽 276，表单宽 775 时每行两个
const naturalRects = [
  { x: 100, width: 248 },
  { x: 364, width: 220 },
  { x: 600, width: 276 }
];
const alignedRects = [
  { x: 100, width: 276 },
  { x: 392, width: 276 },
  { x: 100, width: 276 }
];

// 设定表单宽度和各部分的尺寸（查询、重置共宽 172，extra 宽 120；条件的位置随标签是否统一宽度变化），
// 然后触发一次表单的 ResizeObserver
async function layout(wrapper: Wrapper, width: number) {
  // VueUse 在挂载后的更新中才开始观察
  await flushPromises();
  const form = wrapper.find('form').element;
  Object.defineProperty(form, 'clientWidth', { configurable: true, value: width });
  const fields = fieldsOf(wrapper).element;
  fields.style.columnGap = '16px';
  fields.getBoundingClientRect = () => DOMRect.fromRect({ x: 100 });
  for (const [index, item] of [...fields.children].entries()) {
    item.getBoundingClientRect = () => {
      const rects = form.classList.contains('form-query--aligned') ? alignedRects : naturalRects;
      return DOMRect.fromRect(rects[index]);
    };
  }
  wrapper.find('.form-query__buttons').element.getBoundingClientRect = () => DOMRect.fromRect({ width: 172 });
  wrapper.find('.form-query__extra').element.getBoundingClientRect = () => DOMRect.fromRect({ width: 120 });
  const notify = resizeCallbacks.get(form);
  expect(notify).toBeDefined();
  notify?.();
  await flushPromises();
}

// 条件的尺寸变化（如标签切换宽度后），触发第一个条件上的 ResizeObserver
async function resizeFields(wrapper: Wrapper) {
  const notify = resizeCallbacks.get(fieldsOf(wrapper).findAll('.el-form-item')[0]?.element ?? document.body);
  expect(notify).toBeDefined();
  notify?.();
  await flushPromises();
}

const modifiers = (wrapper: Wrapper) =>
  wrapper
    .find('form')
    .classes()
    .filter(name => name.startsWith('form-query--'));
const labelWidths = (wrapper: Wrapper) =>
  wrapper.findAll<HTMLElement>('.el-form-item__label').map(label => label.element.style.width);

describe('QueryForm', () => {
  it('按钮在条件区外：查询、重置在前，extra 在后', () => {
    const wrapper = mountForm();

    expect(fieldsOf(wrapper).findAll('button')).toHaveLength(0);
    expect(actionsOf(wrapper).findAll('button').map(button => button.text())).toEqual(['查询', '重置', '上传文档']);
    expect(actionsOf(wrapper).find('.form-query__extra').text()).toBe('上传文档');
  });

  it('条件和按钮都放得下一行：排成一行，标签按文字宽度，按钮行不限宽度', async () => {
    const wrapper = mountForm();

    // 776 + 16 + 172 + 120 = 1084
    await layout(wrapper, 1084);

    expect(modifiers(wrapper)).toEqual(['form-query--inline']);
    expect(labelWidths(wrapper)).toEqual(['', '', '']);
    expect(actionsOf(wrapper).attributes('style')).toBeUndefined();
  });

  it('条件放得下、按钮放不下：标签按文字宽度，按钮另起一行，宽度到最后一个条件的右边缘', async () => {
    const wrapper = mountForm();

    await layout(wrapper, 1083);

    expect(modifiers(wrapper)).toEqual([]);
    expect(labelWidths(wrapper)).toEqual(['', '', '']);
    expect(actionsOf(wrapper).attributes('style')).toBe('width: 776px;');
  });

  it('条件放不下：换行，标签统一宽度；条件因此变宽后按新的位置算按钮行宽度', async () => {
    const wrapper = mountForm();

    await layout(wrapper, 775);
    expect(modifiers(wrapper)).toEqual(['form-query--aligned']);
    expect(labelWidths(wrapper)).toEqual(Array(3).fill('calc(6em + 12px)'));

    // 表单的宽高可能不变，要靠条件上的 ResizeObserver 触发
    await resizeFields(wrapper);
    // 每行两个：第一行的第二个最靠右
    expect(actionsOf(wrapper).attributes('style')).toBe('width: 568px;');
  });

  it('统一宽度后沿用标签按文字宽度时量到的值：表单宽度够时恢复', async () => {
    const wrapper = mountForm();
    await layout(wrapper, 775);

    // 统一宽度后条件变宽（排成一行要 860）；如果此时重新量，800 会一直被当成放不下
    await layout(wrapper, 800);

    expect(modifiers(wrapper)).toEqual([]);
    expect(labelWidths(wrapper)).toEqual(['', '', '']);
  });
});
