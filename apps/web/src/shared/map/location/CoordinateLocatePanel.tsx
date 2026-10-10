import { Aim, Close, Position } from '@element-plus/icons-vue';
import { ElButton, ElInput, ElRadioButton, ElRadioGroup } from 'element-plus';
import { useMap, useMapOverlay } from '@yzt/map-vue';
import { computed, defineComponent, onBeforeUnmount, type PropType, ref, watch } from 'vue';
import {
  type Axis,
  type CoordinateFormat,
  formatCoordinate,
  looksSwapped,
  parseCoordinate,
  splitCoordinatePair
} from './coordinate-format';
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

/** 输入框下方的一行：识别结果或错误 */
interface FieldMessage {
  readonly text: string;
  readonly error: boolean;
}

/**
 * 坐标定位的面板（联调用的界面，5D 再设计；ADR 0037 第 6 条）：度分秒、小数输入，拾取，定位。
 * 输入时下方显示识别结果，离开输入框或回车时规范成标准写法；会挡住定位，登记为贴右边的悬浮元素；关闭时取消拾取
 */
export const CoordinateLocatePanel = defineComponent({
  name: 'CoordinateLocatePanel',
  props: {
    location: { type: Object as PropType<LocationPointOwner>, required: true }
  },
  emits: {
    close: () => true
  },
  setup(props, { emit }) {
    const map = useMap();
    const element = ref<HTMLElement>();
    useMapOverlay(element, 'right');

    const text = ref<Record<Axis, string>>({ lng: '', lat: '' });
    // 点过"定位"之后，空白的输入框也提示
    const submitted = ref(false);
    const format = computed(() => props.location.state.value.format);
    const picking = computed(() => map.activeTool.value === LOCATION_PICK_TOOL);

    const show = (value: number) => formatCoordinate(value, format.value);

    // 位置点变化时（定位、拾取、拖动）输入框跟着显示它
    watch(
      () => props.location.state.value.point?.lngLat,
      lngLat => {
        if (lngLat) {
          text.value = { lng: show(lngLat[0]), lat: show(lngLat[1]) };
        }
      },
      { immediate: true }
    );

    const message = (axis: Axis): FieldMessage | null => {
      const input = text.value[axis];
      if (axis === 'lat' && looksSwapped(text.value.lng, input)) {
        return { text: '纬度超出范围，经纬度可能填反了', error: true };
      }
      const result = parseCoordinate(input, axis);
      if (!result.ok) {
        return input.trim() || submitted.value ? { text: result.message, error: true } : null;
      }
      const formatted = show(result.value);
      return formatted === input ? null : { text: `= ${formatted}`, error: false };
    };

    // 识别得了就换成标准写法，识别不了的保留原文
    const normalize = (axis: Axis) => {
      const result = parseCoordinate(text.value[axis], axis);
      if (result.ok) {
        text.value = { ...text.value, [axis]: show(result.value) };
      }
    };

    const onBlur = (axis: Axis) => {
      const pair = axis === 'lng' ? splitCoordinatePair(text.value.lng) : null;
      if (pair) {
        text.value = { lng: pair[0], lat: pair[1] };
        normalize('lat');
      }
      normalize(axis);
    };

    // 按输入的原值定位，规范写法只用于显示（度分秒的秒只保留两位小数）
    const locate = () => {
      submitted.value = true;
      const lng = parseCoordinate(text.value.lng, 'lng');
      const lat = parseCoordinate(text.value.lat, 'lat');
      normalize('lng');
      normalize('lat');
      if (lng.ok && lat.ok) {
        submitted.value = false;
        props.location.locate([lng.value, lat.value]);
      }
    };

    const changeFormat = (value: string | number | boolean | undefined) => {
      const next = FORMATS.find(option => option.value === value)?.value;
      if (!next) {
        return;
      }
      props.location.setFormat(next);
      normalize('lng');
      normalize('lat');
    };

    const togglePick = () =>
      picking.value ? map.releaseTool(LOCATION_PICK_TOOL) : map.activateTool(LOCATION_PICK_TOOL);

    // 关闭面板时取消拾取（ADR 0037 第 4 条）
    onBeforeUnmount(() => map.releaseTool(LOCATION_PICK_TOOL));

    const renderField = (axis: Axis, label: string) => {
      const line = message(axis);
      return (
        <div class={styles.field}>
          <span class={styles.label}>{label}</span>
          <ElInput
            modelValue={text.value[axis]}
            placeholder={PLACEHOLDERS[format.value][axis]}
            clearable
            aria-label={label}
            onUpdate:modelValue={(value: string) => (text.value = { ...text.value, [axis]: value })}
            onBlur={() => onBlur(axis)}
            onKeydown={(event: KeyboardEvent | Event) => {
              if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.isComposing) {
                locate();
              }
            }}
          />
          <div class={[styles.message, line?.error && styles.error]}>{line?.text}</div>
        </div>
      );
    };

    return () => (
      <div ref={element} class={styles.panel} data-coordinate-locate-panel>
        <div class={styles.header}>
          <span class={styles.title}>坐标定位</span>
          <ElButton link icon={Close} aria-label="关闭坐标定位" onClick={() => emit('close')} />
        </div>
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
          <ElButton type="primary" icon={Position} onClick={locate}>
            定位
          </ElButton>
        </div>
      </div>
    );
  }
});
