import { ElButton, ElColorPicker, ElInput, ElOption, ElRadioButton, ElRadioGroup, ElSelect } from 'element-plus';
import { computed, defineComponent, type PropType, ref, type VNode, watch } from 'vue';
import type { ResourceSymbols } from '../composables/useResourceSymbols';
import { RESOURCE_PALETTE } from '../palette';
import type { SymbolTarget } from '../resource-symbols';
import {
  type ColorField,
  LINE_DASH_NAMES,
  LINE_DASHES,
  parseSize,
  POINT_STROKE_WIDTHS,
  SIZE_LEVELS,
  SIZE_REFERENCES,
  sizePixels,
  type SymbolOverride,
  type SymbolSize
} from '../symbols';
import styles from './SymbolEditor.module.scss';

const PREDEFINE = [...RESOURCE_PALETTE, '#FFFFFF', '#000000'];
const CUSTOM = 'custom';
const STROKE_WIDTHS: readonly number[] = POINT_STROKE_WIDTHS;

type SizeKey = 'size' | 'width';

function sizePatch(key: SizeKey, size: SymbolSize): SymbolOverride {
  return key === 'size' ? { size } : { width: size };
}

function colorPatch(field: ColorField, color: string): SymbolOverride {
  const patch: Partial<Record<ColorField, string>> = { [field]: color };
  return patch;
}

/**
 * 统一符号的编辑器（ADR 0044 第 6 节，联调用的界面，5D 再设计）：点选的档位、描边宽度、线型点下就确认；
 * 颜色拖动时预览、确认时写入，取消由取色器报回原来的颜色、拥有者清掉预览；自定义大小回车或失焦时确认，不合法时留在输入框里
 */
export const SymbolEditor = defineComponent({
  name: 'SymbolEditor',
  props: {
    symbols: { type: Object as PropType<ResourceSymbols>, required: true },
    /** 资源的统一样式，或者分类样式里的一个取值 */
    target: { type: Object as PropType<SymbolTarget>, required: true },
    name: { type: String, required: true }
  },
  setup(props) {
    const symbol = computed(() => props.symbols.symbolOf(props.target));
    const set = (patch: SymbolOverride) => props.symbols.setSymbol(props.target, patch);

    // 点的半径、线的线宽；面没有大小
    const sizeField = computed(() => {
      const value = symbol.value;
      if (value?.geometry === 'circle') {
        return { geometry: 'circle', key: 'size', label: '大小', size: value.size } as const;
      }
      if (value?.geometry === 'line') {
        return { geometry: 'line', key: 'width', label: '线宽', size: value.width } as const;
      }
      return null;
    });

    // 自定义大小的输入框是界面状态：进入自定义时取当前大小的像素；大小变化（选档、恢复默认、别处恢复的偏好）时跟着更新
    const customizing = ref(false);
    const draft = ref('');
    const invalid = ref(false);
    const resetDraft = () => {
      const field = sizeField.value;
      draft.value = field ? String(sizePixels(field.geometry, field.size)) : '';
      invalid.value = false;
    };
    watch(
      () => sizeField.value?.size,
      size => {
        customizing.value = typeof size === 'number';
        resetDraft();
      },
      { immediate: true }
    );

    const selectSize = (value: string | number | boolean | undefined) => {
      const field = sizeField.value;
      if (!field) {
        return;
      }
      if (value === CUSTOM) {
        customizing.value = true;
        resetDraft();
        return;
      }
      const level = SIZE_LEVELS.find(item => item === value);
      if (level) {
        customizing.value = false;
        set(sizePatch(field.key, level));
      }
    };

    // 只由自定义的输入框调用
    const commitSize = () => {
      const field = sizeField.value;
      if (!field) {
        return;
      }
      const size = parseSize(field.geometry, draft.value);
      invalid.value = size === null;
      if (size === null) {
        return;
      }
      draft.value = String(size);
      // 和当前大小的像素相同时不提交：档位换成同样像素的自定义值只会多一条覆盖
      if (size !== sizePixels(field.geometry, field.size)) {
        set(sizePatch(field.key, size));
      }
    };

    const commitOnEnter = (event: KeyboardEvent | Event) => {
      if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.isComposing) {
        commitSize();
      }
    };

    const renderSize = (): VNode[] => {
      const field = sizeField.value;
      if (!field) {
        return [];
      }
      const { min, max } = SIZE_REFERENCES[field.geometry];
      const rows = [
        <div key="size" class={styles.row}>
          <span class={styles.label}>{field.label}</span>
          <ElRadioGroup
            size="small"
            modelValue={customizing.value ? CUSTOM : field.size}
            onUpdate:modelValue={selectSize}>
            {SIZE_LEVELS.map(level => (
              <ElRadioButton key={level} value={level}>
                {level}
              </ElRadioButton>
            ))}
            <ElRadioButton value={CUSTOM}>自定义</ElRadioButton>
          </ElRadioGroup>
        </div>
      ];
      if (customizing.value) {
        rows.push(
          <div key="custom" class={styles.row}>
            <span class={styles.label} />
            <div class={styles.custom}>
              <ElInput
                class={styles.number}
                size="small"
                modelValue={draft.value}
                ariaLabel={`自定义${field.label}，${min}～${max} 像素`}
                onUpdate:modelValue={value => {
                  draft.value = value;
                }}
                onKeydown={commitOnEnter}
                onBlur={commitSize}
              />
              <span class={[styles.hint, invalid.value && styles.invalid]}>{`px，${min}～${max}`}</span>
            </div>
          </div>
        );
      }
      return rows;
    };

    const renderColor = (label: string, field: ColorField, value: string) => (
      <div key={field} class={styles.row}>
        <span class={styles.label}>{label}</span>
        <ElColorPicker
          size="small"
          modelValue={value}
          showAlpha
          predefine={PREDEFINE}
          clearable={false}
          ariaLabel={`${props.name}的${label}`}
          onActiveChange={(color: string | null) => {
            if (color) {
              props.symbols.previewColor(props.target, field, color);
            }
          }}
          onChange={(color: string | null) => {
            if (color) {
              set(colorPatch(field, color));
            }
          }}
        />
      </div>
    );

    const renderFields = (): VNode[] => {
      const value = symbol.value;
      if (value?.geometry === 'circle') {
        return [
          ...renderSize(),
          renderColor('填充色', 'fillColor', value.fillColor),
          renderColor('描边色', 'strokeColor', value.strokeColor),
          <div key="strokeWidth" class={styles.row}>
            <span class={styles.label}>描边宽度</span>
            <ElRadioGroup
              size="small"
              modelValue={value.strokeWidth}
              onUpdate:modelValue={width => {
                const strokeWidth = STROKE_WIDTHS.find(item => item === width);
                if (strokeWidth !== undefined) {
                  set({ strokeWidth });
                }
              }}>
              {STROKE_WIDTHS.map(width => (
                <ElRadioButton key={width} value={width}>
                  {width}
                </ElRadioButton>
              ))}
            </ElRadioGroup>
          </div>
        ];
      }
      if (value?.geometry === 'line') {
        return [
          renderColor('颜色', 'color', value.color),
          ...renderSize(),
          <div key="dash" class={styles.row}>
            <span class={styles.label}>线型</span>
            <ElSelect
              class={styles.select}
              size="small"
              modelValue={value.dash}
              onUpdate:modelValue={(name: unknown) => {
                const dash = LINE_DASH_NAMES.find(item => item === name);
                if (dash) {
                  set({ dash });
                }
              }}>
              {LINE_DASH_NAMES.map(dash => (
                <ElOption key={dash} value={dash} label={LINE_DASHES[dash].label} />
              ))}
            </ElSelect>
          </div>
        ];
      }
      if (value?.geometry === 'fill') {
        return [renderColor('填充色', 'fillColor', value.fillColor), renderColor('描边色', 'outlineColor', value.outlineColor)];
      }
      return [];
    };

    return () =>
      symbol.value && (
        <div class={styles.editor} data-symbol-editor={props.target.item ?? props.target.code}>
          {renderFields()}
          <div class={styles.footer}>
            <ElButton
              link
              type="primary"
              size="small"
              disabled={!props.symbols.hasOverride(props.target)}
              onClick={() => props.symbols.resetSymbol(props.target)}>
              恢复默认
            </ElButton>
          </div>
        </div>
      );
  }
});
