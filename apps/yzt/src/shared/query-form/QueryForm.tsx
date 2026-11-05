import { useMutationObserver, useResizeObserver } from '@vueuse/core';
import { ElForm, type FormInstance } from 'element-plus';
import { defineComponent, onMounted, ref, shallowRef, type SlotsType, type VNode } from 'vue';

const ALIGNED_CLASS = 'form-query--aligned';

const widthOf = (element: Element) => element.getBoundingClientRect().width;

// 在标签按文字宽度的状态下执行 read：标签统一宽度时，临时去掉类名和 Element 写在标签上的行内宽度，执行完马上恢复。
// 都在同一段同步代码里，浏览器不会画出中间状态，ResizeObserver 也看不到变化
function withNaturalLabels<T>(form: HTMLElement, read: () => T): T {
  if (!form.classList.contains(ALIGNED_CLASS)) {
    return read();
  }
  const labels = [...form.querySelectorAll<HTMLElement>('.el-form-item__label')].map(
    label => [label, label.style.width] as const
  );
  form.classList.remove(ALIGNED_CLASS);
  for (const [label] of labels) {
    label.style.width = '';
  }
  try {
    return read();
  } finally {
    form.classList.add(ALIGNED_CLASS);
    for (const [label, width] of labels) {
      label.style.width = width;
    }
  }
}

/** 列表页的查询表单：条件放得下一行时标签按文字宽度，放不下时换行、标签统一宽度并两端对齐；按钮放不下就另起一行（docs/modules/query-form.md） */
export const QueryForm = defineComponent({
  name: 'QueryForm',
  props: {
    // 最长标签的字数，换行时所有标签都取这个宽度
    labelChars: { type: Number, required: true }
  },
  slots: Object as SlotsType<{
    default: () => VNode[];
    actions: () => VNode[];
    extra?: () => VNode[];
  }>,
  setup(props, { slots }) {
    const form = ref<FormInstance>();
    // ElForm 的根元素是 <form>；组件实例的 $el 没有具体类型
    const formElement = () => form.value?.$el as HTMLFormElement | undefined;
    const fields = ref<HTMLElement>();
    const buttons = ref<HTMLElement>();
    const extra = ref<HTMLElement>();
    // 条件放不下一行：换行，标签统一宽度
    const aligned = ref(false);
    // 条件和按钮都放得下一行
    const inline = ref(false);
    // 按钮另起一行时的宽度：到最右边那个条件的右边缘为止，让 extra 与它右对齐
    const actionsWidth = ref<string>();

    const measure = () => {
      const formEl = formElement();
      const fieldsEl = fields.value;
      if (!formEl || !fieldsEl || !buttons.value) {
        return;
      }
      const gap = Number.parseFloat(getComputedStyle(fieldsEl).columnGap);
      const items = [...fieldsEl.children];
      const rects = items.map(item => item.getBoundingClientRect());
      // 判断依据是标签按文字宽度时条件排成一行的总宽；统一宽度后条件变宽了，不能直接用当前的尺寸
      const naturalFieldsWidth = withNaturalLabels(
        formEl,
        () => items.reduce((sum, item) => sum + widthOf(item), 0) + gap * (items.length - 1)
      );
      // 按钮的宽度固定，与当前排布无关
      const buttonsWidth = gap + widthOf(buttons.value) + (extra.value ? widthOf(extra.value) : 0);
      aligned.value = formEl.clientWidth < naturalFieldsWidth;
      inline.value = formEl.clientWidth >= naturalFieldsWidth + buttonsWidth;
      const left = fieldsEl.getBoundingClientRect().left;
      actionsWidth.value = `${Math.max(...rects.map(rect => rect.right)) - left}px`;
    };

    // 当前的条件元素，条件增减时重新收集。条件写在 ElForm 里，由 ElForm 的插槽渲染，增减时本组件不会更新，
    // 所以用 MutationObserver 监听条件区的子元素
    const fieldItems = shallowRef<HTMLElement[]>([]);
    const collectFieldItems = () => {
      fieldItems.value = [...(fields.value?.querySelectorAll<HTMLElement>(':scope > *') ?? [])];
    };
    onMounted(collectFieldItems);
    useMutationObserver(fields, collectFieldItems, { childList: true });

    // 表单宽度变化、条件变宽变窄（标签切换宽度、字体加载完成）、按钮区变化（按钮文案或个数）都会改变排布，
    // 而表单本身的宽高可能不变，所以分别观察；开始观察新的条件时 ResizeObserver 会回调一次，随即重新判断
    useResizeObserver(() => [formElement(), buttons.value, extra.value, ...fieldItems.value], measure);

    return () => (
      <ElForm
        ref={form}
        class={['form-query', inline.value && 'form-query--inline', aligned.value && ALIGNED_CLASS]}
        labelWidth={aligned.value ? `calc(${props.labelChars}em + 12px)` : ''}
      >
        <div ref={fields} class="form-query__fields">
          {slots.default()}
        </div>
        <div class="form-query__actions" style={{ width: inline.value ? undefined : actionsWidth.value }}>
          <div ref={buttons} class="form-query__buttons">
            {slots.actions()}
          </div>
          {slots.extra && (
            <div ref={extra} class="form-query__extra">
              {slots.extra()}
            </div>
          )}
        </div>
      </ElForm>
    );
  }
});
