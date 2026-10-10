import {
  computed,
  type ComputedRef,
  getCurrentScope,
  ref,
  type ShallowRef,
  shallowReadonly,
  shallowRef,
  watch
} from 'vue';
import {
  type Axis,
  type CoordinateFormat,
  formatCoordinate,
  looksSwapped,
  parseCoordinate,
  splitCoordinatePair
} from './coordinate-format';
import type { LocationPointOwner } from './useLocationPoint';

/** 一个输入框：显示的文字和它对应的精确数值。规范写法、切换格式只改文字，不改数值（ADR 0037） */
export interface CoordinateField {
  readonly text: string;
  /** 识别不了时为 null */
  readonly value: number | null;
}

export type CoordinateFields = Readonly<Record<Axis, CoordinateField>>;

/** 输入框下方的一行：识别结果、提示或错误 */
export interface FieldMessage {
  readonly text: string;
  readonly error: boolean;
}

/** 坐标输入的逻辑：识别、规范写法、切换格式、拆分一对坐标、提交；不渲染，由面板显示和调用 */
export interface CoordinateInput {
  readonly fields: Readonly<ShallowRef<CoordinateFields>>;
  readonly messages: ComputedRef<Readonly<Record<Axis, FieldMessage | null>>>;
  /** 输入时：文字照原样保留，数值重新识别 */
  readonly setText: (axis: Axis, text: string) => void;
  /** 离开输入框：经度框里是一对坐标时分到两个框，识别得了的换成规范写法 */
  readonly blur: (axis: Axis) => void;
  readonly changeFormat: (format: CoordinateFormat) => void;
  /** 回车或"定位"：和离开输入框一样拆分、规范，两个都识别得了时按精确数值定位 */
  readonly submit: () => void;
}

function fieldOf(text: string, axis: Axis): CoordinateField {
  const result = parseCoordinate(text, axis);
  return { text, value: result.ok ? result.value : null };
}

const EMPTY: CoordinateFields = { lng: { text: '', value: null }, lat: { text: '', value: null } };

/** 在面板的 setup 中调用；位置点变化时（定位、拾取、拖动）输入框跟着显示它 */
export function useCoordinateInput(location: LocationPointOwner): CoordinateInput {
  if (!getCurrentScope()) {
    throw new Error('useCoordinateInput 只能在组件的 setup 或 effectScope 中调用');
  }
  const fields = shallowRef<CoordinateFields>(EMPTY);
  // 点过"定位"之后，空白的输入框也提示
  const submitted = ref(false);
  const show = (value: number) => formatCoordinate(value, location.state.value.format);

  watch(
    () => location.state.value.point?.lngLat,
    lngLat => {
      if (lngLat) {
        fields.value = {
          lng: { text: show(lngLat[0]), value: lngLat[0] },
          lat: { text: show(lngLat[1]), value: lngLat[1] }
        };
      }
    },
    { immediate: true }
  );

  const update = (axis: Axis, field: CoordinateField) => {
    fields.value = { ...fields.value, [axis]: field };
  };

  // 识别得了的换成规范写法，数值保持输入时的精确值；识别不了的保留原文
  const normalize = (axis: Axis) => {
    const { value } = fields.value[axis];
    if (value !== null) {
      update(axis, { text: show(value), value });
    }
  };

  const splitPair = () => {
    const pair = splitCoordinatePair(fields.value.lng.text);
    if (pair) {
      fields.value = { lng: fieldOf(pair[0], 'lng'), lat: fieldOf(pair[1], 'lat') };
      normalize('lat');
    }
  };

  const messageOf = (axis: Axis): FieldMessage | null => {
    const { lng, lat } = fields.value;
    const { text } = fields.value[axis];
    if (axis === 'lng' && splitCoordinatePair(text)) {
      return { text: '识别为一对坐标，回车或离开输入框后分到两个框', error: false };
    }
    if (axis === 'lat' && looksSwapped(lng.text, lat.text)) {
      return { text: '纬度超出范围，经纬度可能填反了', error: true };
    }
    const result = parseCoordinate(text, axis);
    if (!result.ok) {
      return text.trim() || submitted.value ? { text: result.message, error: true } : null;
    }
    // 已经是规范写法时不再显示识别结果
    const formatted = show(result.value);
    return formatted === text ? null : { text: `= ${formatted}`, error: false };
  };

  return {
    fields: shallowReadonly(fields),
    messages: computed(() => ({ lng: messageOf('lng'), lat: messageOf('lat') })),
    setText: (axis, text) => update(axis, fieldOf(text, axis)),
    blur: axis => {
      if (axis === 'lng') {
        splitPair();
      }
      normalize(axis);
    },
    changeFormat: format => {
      location.setFormat(format);
      normalize('lng');
      normalize('lat');
    },
    submit: () => {
      submitted.value = true;
      splitPair();
      normalize('lng');
      normalize('lat');
      const { lng, lat } = fields.value;
      if (lng.value !== null && lat.value !== null) {
        submitted.value = false;
        location.locate([lng.value, lat.value]);
      }
    }
  };
}
