import { useResizeObserver } from '@vueuse/core';
import { ElForm, type FormInstance } from 'element-plus';
import { defineComponent, ref, type SlotsType, type VNode } from 'vue';

const widthOf = (element: Element) => element.getBoundingClientRect().width;

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
    // 标签按文字宽度时，条件排成一行要多宽：在标签按文字宽度时量出，统一宽度后条件变宽了，沿用这个值
    let naturalFieldsWidth = 0;

    const measure = () => {
      const formWidth = formElement()?.clientWidth;
      if (formWidth === undefined || !fields.value || !buttons.value) {
        return;
      }
      const gap = Number.parseFloat(getComputedStyle(fields.value).columnGap);
      const items = [...fields.value.children].map(item => item.getBoundingClientRect());
      if (!aligned.value) {
        naturalFieldsWidth = items.reduce((sum, rect) => sum + rect.width, 0) + gap * (items.length - 1);
      }
      // 按钮的宽度固定，与当前排布无关
      const buttonsWidth = gap + widthOf(buttons.value) + (extra.value ? widthOf(extra.value) : 0);
      aligned.value = formWidth < naturalFieldsWidth;
      inline.value = formWidth >= naturalFieldsWidth + buttonsWidth;
      const left = fields.value.getBoundingClientRect().left;
      actionsWidth.value = `${Math.max(...items.map(rect => rect.right)) - left}px`;
    };

    // 除了表单，还要观察每个条件：标签切换宽度、字体加载完成都会让条件变宽变窄，而表单的宽高可能不变
    useResizeObserver(
      () => [formElement(), ...(fields.value?.querySelectorAll<HTMLElement>(':scope > *') ?? [])],
      measure
    );

    return () => (
      <ElForm
        ref={form}
        class={['form-query', inline.value && 'form-query--inline', aligned.value && 'form-query--aligned']}
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
