import { Aim, Position } from '@element-plus/icons-vue';
import { ElButton, ElInput, ElRadioButton, ElRadioGroup } from 'element-plus';
import { useMap } from '@yzt/map-vue';
import { computed, defineComponent, onBeforeUnmount, type PropType, watch } from 'vue';
import type { Axis, CoordinateFormat } from './coordinate-format';
import { useCoordinateInput } from './useCoordinateInput';
import { LOCATION_PICK_TOOL, type LocationPointOwner } from './useLocationPoint';
import styles from './CoordinateLocatePanel.module.scss';

const FORMATS: readonly { readonly value: CoordinateFormat; readonly label: string }[] = [
  { value: 'dms', label: '度分秒' },
  { value: 'decimal', label: '小数' }
];

const PLACEHOLDERS: Readonly<Record<CoordinateFormat, Readonly<Record<Axis, string>>>> = {
  dms: { lng: '如 118°46′40″ 或 1184640', lat: '如 32°03′23″ 或 320323' },
  decimal: { lng: '如 118.777800', lat: '如 32.056500' }
};

/**
 * 坐标定位的内容（联调用的界面，5D 再设计；ADR 0037 第 6 条）：度分秒、小数输入，拾取，定位。
 * 输入的逻辑在 useCoordinateInput，这里只显示和调用；放在功能面板的 Tab 里，标题、关闭和登记由外壳负责，
 * 隐藏和关闭时都取消拾取（ADR 0053 第 4 节）
 */
export const CoordinateLocatePanel = defineComponent({
  name: 'CoordinateLocatePanel',
  props: {
    location: { type: Object as PropType<LocationPointOwner>, required: true },
    /** 正在显示；切到别的 Tab、让给另一边时为 false */
    active: { type: Boolean, default: true }
  },
  setup(props) {
    const map = useMap();

    const input = useCoordinateInput(props.location);
    const format = computed(() => props.location.state.value.format);
    const picking = computed(() => map.activeTool.value === LOCATION_PICK_TOOL);

    const changeFormat = (value: string | number | boolean | undefined) => {
      const next = FORMATS.find(option => option.value === value)?.value;
      if (next) {
        input.changeFormat(next);
      }
    };

    const togglePick = () =>
      picking.value ? map.releaseTool(LOCATION_PICK_TOOL) : map.activateTool(LOCATION_PICK_TOOL);

    // 隐藏、关闭时取消拾取（ADR 0037 第 4 条、ADR 0053 第 4 节）；拾取不是当前工具时什么也不做
    watch(
      () => props.active,
      active => {
        if (!active) {
          map.releaseTool(LOCATION_PICK_TOOL);
        }
      }
    );
    onBeforeUnmount(() => map.releaseTool(LOCATION_PICK_TOOL));

    const renderField = (axis: Axis, label: string) => {
      const line = input.messages.value[axis];
      return (
        <div class={styles.field}>
          <span class={styles.label}>{label}</span>
          <ElInput
            modelValue={input.fields.value[axis].text}
            placeholder={PLACEHOLDERS[format.value][axis]}
            clearable
            aria-label={label}
            onUpdate:modelValue={(value: string) => input.setText(axis, value)}
            onBlur={() => input.blur(axis)}
            onKeydown={(event: KeyboardEvent | Event) => {
              if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.isComposing) {
                input.submit();
              }
            }}
          />
          <div class={[styles.message, line?.error && styles.error]}>{line?.text}</div>
        </div>
      );
    };

    return () => (
      <div class={styles.panel} data-coordinate-locate-panel>
        <ElRadioGroup size="small" modelValue={format.value} onUpdate:modelValue={changeFormat}>
          {FORMATS.map(option => (
            <ElRadioButton key={option.value} value={option.value}>
              {option.label}
            </ElRadioButton>
          ))}
        </ElRadioGroup>
        {renderField('lng', '经度')}
        {renderField('lat', '纬度')}
        <div class={styles.actions}>
          <ElButton
            type={picking.value ? 'primary' : 'default'}
            icon={Aim}
            aria-pressed={picking.value}
            onClick={togglePick}>
            拾取
          </ElButton>
          <ElButton type="primary" icon={Position} onClick={input.submit}>
            定位
          </ElButton>
        </div>
      </div>
    );
  }
});
