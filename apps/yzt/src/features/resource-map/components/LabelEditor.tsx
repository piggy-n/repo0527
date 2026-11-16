import {
  ElButton,
  ElColorPicker,
  ElOption,
  ElRadioButton,
  ElRadioGroup,
  ElSelect,
  ElSlider,
  ElSwitch,
  ElTooltip
} from 'element-plus';
import { computed, defineComponent, onUnmounted, type PropType, ref, type VNode, watch } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import type { ResourceLayers } from '../composables/useResourceLayers';
import type { ResourceSymbols } from '../composables/useResourceSymbols';
import { labelFieldsOf } from '../label-fields';
import {
  LABEL_FONT_NAMES,
  LABEL_FONTS,
  LABEL_HALO_WIDTHS,
  LABEL_PLACEMENTS,
  LABEL_SIZES,
  LABEL_ZOOM_RANGE,
  type LabelColorField,
  type LabelOverride,
  labelShareText,
  PLACEMENTS_OF,
  type ResourceLabel
} from '../labels';
import { COLOR_PRESETS } from '../palette';
import { colorLabel } from '../symbols';
import styles from './LabelEditor.module.scss';
import editorStyles from './SymbolEditor.module.scss';

// Element 的 predefine 要可变数组：模块里复制一份
const PREDEFINE = [...COLOR_PRESETS];
const SIZES: readonly number[] = LABEL_SIZES;
const HALO_WIDTHS: readonly number[] = LABEL_HALO_WIDTHS;

/** 显示级别的文字：最大级别拉到头时不限制 */
export function zoomRangeText(minzoom: number, maxzoom: number): string {
  return maxzoom >= LABEL_ZOOM_RANGE.max ? `${minzoom} 级起` : `${minzoom}～${maxzoom} 级`;
}

// 范围滑块报出的值：两个数
function zoomPair(value: unknown): readonly [number, number] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items: readonly unknown[] = value;
  const [from, to] = items;
  return typeof from === 'number' && typeof to === 'number' ? [from, to] : null;
}

// 编辑器的一行：名称在左（可以带说明），控件在右，同符号编辑器
function renderRow(key: string, name: VNode | string, control: VNode) {
  return (
    <div key={key} class={editorStyles.row}>
      {typeof name === 'string' ? <span class={editorStyles.label}>{name}</span> : name}
      {control}
    </div>
  );
}

// 一行档位
interface LevelsRow {
  readonly key: string;
  readonly name: string;
  readonly values: readonly (string | number)[];
  readonly current: string | number;
  readonly off: boolean;
  readonly text?: (value: string | number) => string;
  readonly pick: (value: string | number | boolean | undefined) => void;
}

// 档位：占满控件列、各项等宽（radio-group-block），字号的 6 档放得进 300 宽的浮层
function renderLevels({ key, name, values, current, off, text = String, pick }: LevelsRow) {
  return renderRow(
    key,
    name,
    <ElRadioGroup
      class="radio-group-block"
      size="small"
      modelValue={current}
      disabled={off}
      ariaLabel={`标注的${name}`}
      onUpdate:modelValue={pick}
    >
      {values.map(value => (
        <ElRadioButton key={value} value={value}>
          {text(value)}
        </ElRadioButton>
      ))}
    </ElRadioGroup>
  );
}

/**
 * 一个资源的标注编辑器（ADR 0160，样板 local/design/legend-symbols-v1 第 3 块）：最上面"显示标注"开关，
 * 下面的行同符号编辑器（56 宽的名称列、浅灰底）；关着标注时编辑器不能操作。
 * 下拉、档位、开关点下就确认；颜色拖动时预览、确认时写入（ADR 0044）；显示级别松手时写入
 */
export const LabelEditor = defineComponent({
  name: 'LabelEditor',
  props: {
    layers: { type: Object as PropType<ResourceLayers>, required: true },
    symbols: { type: Object as PropType<ResourceSymbols>, required: true },
    code: { type: String, required: true }
  },
  setup(props) {
    const resource = computed(() => props.layers.state.value.catalog?.resources.get(props.code));
    const labeled = computed(() => props.layers.state.value.displays.get(props.code)?.labeled ?? false);
    const label = computed(() => props.symbols.labelOf(props.code));
    const set = (patch: LabelOverride) => props.symbols.setLabel(props.code, patch);

    // 取色器随编辑器销毁或换了资源时不会再报回确认的颜色：丢弃这个资源没确认的预览（同符号编辑器）
    watch(
      () => props.code,
      (code, previous) => {
        if (code !== previous) {
          props.symbols.clearLabelPreview(previous);
        }
      }
    );
    onUnmounted(() => props.symbols.clearLabelPreview(props.code));

    // 拖动级别滑块时的范围：松手才写入，拖动中显示它；确认的值变了（恢复默认、别处恢复的偏好）时放下
    const draftZoom = ref<readonly [number, number] | null>(null);
    watch(
      () => [label.value?.minzoom, label.value?.maxzoom],
      () => (draftZoom.value = null)
    );
    const renderField = (value: ResourceLabel, off: boolean) =>
      renderRow(
        'field',
        '字段',
        <ElSelect
          class={editorStyles.select}
          size="small"
          modelValue={value.field}
          disabled={off}
          ariaLabel="标注的字段"
          onUpdate:modelValue={(field: unknown) => {
            const option = labelFieldsOf(props.code).find(item => item.field === field);
            if (option) {
              set({ field: option.field });
            }
          }}
        >
          {labelFieldsOf(props.code).map(option => (
            <ElOption key={option.field} value={option.field} label={`${option.name}（${option.field}）`}>
              <span class={styles.fieldOption} data-label-field={option.field}>
                <span class={styles.fieldName}>{`${option.name}（${option.field}）`}</span>
                <span class={styles.share}>{labelShareText(option)}</span>
              </span>
            </ElOption>
          ))}
        </ElSelect>
      );

    const renderFont = (value: ResourceLabel, off: boolean) =>
      renderRow(
        'font',
        '字体',
        <ElSelect
          class={editorStyles.select}
          size="small"
          modelValue={value.font}
          disabled={off}
          ariaLabel="标注的字体"
          onUpdate:modelValue={(name: unknown) => {
            const font = LABEL_FONT_NAMES.find(item => item === name);
            if (font) {
              set({ font });
            }
          }}
        >
          {LABEL_FONT_NAMES.map(font => (
            <ElOption key={font} value={font} label={LABEL_FONTS[font].name}>
              <span class={font === 'semibold' ? styles.semibold : undefined}>{LABEL_FONTS[font].name}</span>
            </ElOption>
          ))}
        </ElSelect>
      );

    const renderColor = (name: string, field: LabelColorField, value: string, off: boolean) =>
      renderRow(
        field,
        name,
        <div class={editorStyles.control}>
          <ElColorPicker
            size="small"
            modelValue={value}
            predefine={PREDEFINE}
            clearable={false}
            disabled={off}
            ariaLabel={`标注的${name}`}
            onActiveChange={(color: string | null) => {
              if (color) {
                props.symbols.previewLabelColor(props.code, field, color);
              }
            }}
            onChange={(color: string | null) => {
              if (color) {
                const patch: Partial<Record<LabelColorField, string>> = { [field]: color };
                set(patch);
              }
            }}
          />
          <span class={editorStyles.hex}>{colorLabel(value)}</span>
        </div>
      );

    const renderZoom = (value: ResourceLabel, off: boolean) => {
      const [from, to] = draftZoom.value ?? [value.minzoom, value.maxzoom];
      return renderRow(
        'zoom',
        '显示级别',
        <div class={styles.zoom}>
          <ElSlider
            class={styles.slider}
            size="small"
            range
            min={LABEL_ZOOM_RANGE.min}
            max={LABEL_ZOOM_RANGE.max}
            step={1}
            showTooltip={false}
            disabled={off}
            rangeStartLabel="标注的最小显示级别"
            rangeEndLabel="标注的最大显示级别"
            modelValue={[from, to]}
            onUpdate:modelValue={(next: unknown) => (draftZoom.value = zoomPair(next))}
            onChange={(next: unknown) => {
              const pair = zoomPair(next);
              if (pair && (pair[0] !== value.minzoom || pair[1] !== value.maxzoom)) {
                set({ minzoom: pair[0], maxzoom: pair[1] });
              }
            }}
          />
          <span class={styles.zoomText}>{zoomRangeText(from, to)}</span>
        </div>
      );
    };

    // 压盖：说明放进名称后面的问号，悬停才显示（用户 2026-11-16）
    const renderOverlap = (value: ResourceLabel, off: boolean) =>
      renderRow(
        'overlap',
        <span class={[editorStyles.label, styles.overlapName]}>
          压盖
          <ElTooltip content="文字之间允许重叠" placement="top">
            <span class={styles.help} tabindex={0} aria-label="压盖：文字之间允许重叠">
              <SvgIcon name="help" size={14} />
            </span>
          </ElTooltip>
        </span>,
        <div class={editorStyles.control}>
          <ElSwitch
            size="small"
            modelValue={value.overlap}
            disabled={off}
            ariaLabel="标注的压盖"
            onUpdate:modelValue={overlap => set({ overlap: overlap === true })}
          />
        </div>
      );

    return () => {
      const current = resource.value;
      const value = label.value;
      if (!current || !value) {
        return <div class={styles.none}>这个资源没有可标注的字段</div>;
      }
      const off = !labeled.value;
      const placements = PLACEMENTS_OF[current.geometry];
      return (
        <div class={styles.labelEditor} data-label-editor={props.code}>
          <div class={styles.switchRow}>
            <span>显示标注</span>
            <ElSwitch
              size="small"
              modelValue={labeled.value}
              ariaLabel={`显示${current.name}的标注`}
              onUpdate:modelValue={on => props.layers.setLabeled(props.code, on === true)}
            />
          </div>
          <div class={editorStyles.editor}>
            {renderField(value, off)}
            {renderFont(value, off)}
            {renderLevels({
              key: 'size',
              name: '字号',
              values: SIZES,
              current: value.size,
              off,
              pick: size => {
                const next = LABEL_SIZES.find(item => item === size);
                if (next !== undefined) {
                  set({ size: next });
                }
              }
            })}
            {renderColor('颜色', 'color', value.color, off)}
            {renderColor('描边色', 'haloColor', value.haloColor, off)}
            {renderLevels({
              key: 'haloWidth',
              name: '描边宽度',
              values: HALO_WIDTHS,
              current: value.haloWidth,
              off,
              pick: width => {
                const next = LABEL_HALO_WIDTHS.find(item => item === width);
                if (next !== undefined) {
                  set({ haloWidth: next });
                }
              }
            })}
            {renderLevels({
              key: 'placement',
              name: '放置',
              values: placements,
              current: value.placement,
              off,
              text: placement => LABEL_PLACEMENTS[placements.find(item => item === placement) ?? value.placement],
              pick: placement => {
                const next = placements.find(item => item === placement);
                if (next) {
                  set({ placement: next });
                }
              }
            })}
            {renderZoom(value, off)}
            {renderOverlap(value, off)}
            <div class={editorStyles.footer}>
              <ElButton
                link
                type="primary"
                size="small"
                disabled={off || !props.symbols.hasLabelOverride(props.code)}
                onClick={() => props.symbols.resetLabel(props.code)}
              >
                恢复默认标注
              </ElButton>
            </div>
          </div>
        </div>
      );
    };
  }
});
