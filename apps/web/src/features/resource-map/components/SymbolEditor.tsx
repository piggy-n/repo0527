import { ElButton, ElColorPicker, ElInput, ElOption, ElRadioButton, ElRadioGroup, ElSelect } from 'element-plus';
import { computed, defineComponent, onUnmounted, type PropType, ref, type VNode, watch } from 'vue';
import type { ResourceSymbols } from '../composables/useResourceSymbols';
import { type LegendSwatch, swatchOf } from '../legend';
import { COLOR_PRESETS } from '../palette';
import type { SymbolTarget } from '../resource-symbols';
import {
  type ColorField,
  colorLabel,
  FILL_STYLE_NAMES,
  FILL_STYLES,
  isFillPattern,
  type LineDash,
  LINE_DASH_NAMES,
  LINE_DASHES,
  parseSize,
  POINT_STROKE_WIDTHS,
  SIZE_LEVELS,
  SIZE_REFERENCES,
  sizePixels,
  type ResourceSymbol,
  type SymbolOverride,
  type SymbolSize
} from '../symbols';
import { LegendSwatchIcon } from './LegendSwatchIcon';
import styles from './SymbolEditor.module.scss';

// Element 的 predefine 要可变数组：模块里复制一份
const PREDEFINE = [...COLOR_PRESETS];
const CUSTOM = 'custom';
const STROKE_WIDTHS: readonly number[] = POINT_STROKE_WIDTHS;

type SizeKey = 'size' | 'width' | 'outlineWidth';

function sizePatch(key: SizeKey, size: SymbolSize): SymbolOverride {
  if (key === 'size') {
    return { size };
  }
  return key === 'width' ? { width: size } : { outlineWidth: size };
}

type DashKey = 'dash' | 'outlineDash';

function dashPatch(key: DashKey, dash: LineDash): SymbolOverride {
  return key === 'dash' ? { dash } : { outlineDash: dash };
}

function colorPatch(field: ColorField, color: string): SymbolOverride {
  const patch: Partial<Record<ColorField, string>> = { [field]: color };
  return patch;
}

/**
 * 符号的编辑器（ADR 0044 第 6 节，设计稿 5D.5）：浅灰底的一块，名称在左、控件在右，颜色旁写出色值；线型、填充方式的选项带示意。
 * 点选的档位、描边宽度、线型点下就确认；
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

    // 取色器随编辑器销毁或换了目标时不会再报回确认的颜色：丢弃这个目标没确认的预览，别的编辑器的新预览不动。
    // 上层每次渲染可能给出新的目标对象，按资源和取值比较；卸载时等取色器先卸载完再丢弃
    watch(
      () => props.target,
      (target, previous) => {
        if (target.code !== previous.code || target.item !== previous.item) {
          props.symbols.clearPreview(previous);
        }
      }
    );
    onUnmounted(() => props.symbols.clearPreview(props.target));

    // 点的半径、线的线宽、面的描边宽度
    const sizeField = computed(() => {
      const value = symbol.value;
      if (value?.geometry === 'circle') {
        return { kind: 'circle', key: 'size', label: '大小', size: value.size } as const;
      }
      if (value?.geometry === 'line') {
        return { kind: 'line', key: 'width', label: '线宽', size: value.width } as const;
      }
      if (value?.geometry === 'fill') {
        return { kind: 'outline', key: 'outlineWidth', label: '描边宽度', size: value.outlineWidth } as const;
      }
      return null;
    });

    // 自定义大小的输入框是界面状态：进入自定义时取当前大小的像素；大小变化（选档、恢复默认、别处恢复的偏好）时跟着更新
    const customizing = ref(false);
    const draft = ref('');
    const invalid = ref(false);
    const resetDraft = () => {
      const field = sizeField.value;
      draft.value = field ? String(sizePixels(field.kind, field.size)) : '';
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
      const size = parseSize(field.kind, draft.value);
      invalid.value = size === null;
      if (size === null) {
        return;
      }
      draft.value = String(size);
      // 和当前大小的像素相同时不提交：档位换成同样像素的自定义值只会多一条覆盖
      if (size !== sizePixels(field.kind, field.size)) {
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
      const { min, max } = SIZE_REFERENCES[field.kind];
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
        <div class={styles.control}>
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
          <span class={styles.hex}>{colorLabel(value)}</span>
        </div>
      </div>
    );

    // 线型的示意：按当前的颜色和粗细画一段线（面的描边为 0 时按 1 像素画，免得看不见）
    const dashSwatch = (dash: LineDash): LegendSwatch | null => {
      const preview = symbol.value && swatchOf(symbol.value);
      if (preview?.geometry === 'line') {
        return { ...preview, dash: LINE_DASHES[dash].dasharray };
      }
      if (preview?.geometry === 'fill') {
        const width = Math.max(preview.outlineWidth, 1);
        return { geometry: 'line', color: preview.outline, width, dash: LINE_DASHES[dash].dasharray };
      }
      return null;
    };

    const renderDashSwatch = (dash: LineDash) => {
      const swatch = dashSwatch(dash);
      return swatch && <LegendSwatchIcon swatch={swatch} />;
    };

    const renderDash = (label: string, key: DashKey, value: LineDash) => (
      <div key={key} class={styles.row}>
        <span class={styles.label}>{label}</span>
        <ElSelect
          class={styles.select}
          size="small"
          modelValue={value}
          onUpdate:modelValue={(name: unknown) => {
            const dash = LINE_DASH_NAMES.find(item => item === name);
            if (dash) {
              set(dashPatch(key, dash));
            }
          }}>
          {{
            prefix: () => renderDashSwatch(value),
            default: () =>
              LINE_DASH_NAMES.map(dash => (
                <ElOption key={dash} value={dash} label={LINE_DASHES[dash].label}>
                  <span class={styles.option} data-dash={dash}>
                    {renderDashSwatch(dash)}
                    {LINE_DASHES[dash].label}
                  </span>
                </ElOption>
              ))
          }}
        </ElSelect>
      </div>
    );

    // 填充方式：选项带预览，按当前的颜色画出这种填充方式的样子
    const renderFillStyle = (value: Extract<ResourceSymbol, { geometry: 'fill' }>) => (
      <div key="fillStyle" class={styles.row}>
        <span class={styles.label}>填充方式</span>
        <ElSelect
          class={styles.select}
          size="small"
          modelValue={value.fillStyle}
          onUpdate:modelValue={(name: unknown) => {
            const fillStyle = FILL_STYLE_NAMES.find(item => item === name);
            if (fillStyle) {
              set({ fillStyle });
            }
          }}>
          {{
            prefix: () => <LegendSwatchIcon swatch={swatchOf(value)} />,
            default: () =>
              FILL_STYLE_NAMES.map(fillStyle => (
                <ElOption key={fillStyle} value={fillStyle} label={FILL_STYLES[fillStyle]}>
                  <span class={styles.option} data-fill-style={fillStyle}>
                    <LegendSwatchIcon swatch={swatchOf({ ...value, fillStyle })} />
                    {FILL_STYLES[fillStyle]}
                  </span>
                </ElOption>
              ))
          }}
        </ElSelect>
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
          renderDash('线型', 'dash', value.dash)
        ];
      }
      if (value?.geometry === 'fill') {
        // 无填充时填充色用不上（保留着，换回来时还是原来的颜色）；有花纹时才有纹理颜色
        return [
          renderFillStyle(value),
          ...(value.fillStyle === 'none' ? [] : [renderColor('填充色', 'fillColor', value.fillColor)]),
          ...(isFillPattern(value.fillStyle) ? [renderColor('纹理颜色', 'patternColor', value.patternColor)] : []),
          renderColor('描边色', 'outlineColor', value.outlineColor),
          ...renderSize(),
          renderDash('描边线型', 'outlineDash', value.outlineDash)
        ];
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
