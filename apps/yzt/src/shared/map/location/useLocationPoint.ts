import type { LngLat, MapInputEvent, MapTool, ScreenPoint, ToolView } from '@yzt/map-core';
import type { MapContext } from '@yzt/map-vue';
import { LatestController } from '@yzt/utils';
import { getCurrentScope, onScopeDispose, type ShallowRef, shallowReadonly, shallowRef, watch } from 'vue';
import { findRegion, type Region } from '../region/region-catalog';
import { type RegionBoundaryLoader, sharedRegionBoundaryLoader } from '../region/region-geometry';
import type { CoordinateFormat } from './coordinate-format';

/** 拾取工具登记到会话里的 ID，面板的"拾取"按钮用同样的 ID */
export const LOCATION_PICK_TOOL = 'location-pick';

// 定位时至少放大到的级别和动画时长（ADR 0037 第 3 条）
const LOCATE_MIN_ZOOM = 14;
const LOCATE_DURATION = 1000;

/** 位置点从哪里来：输入后定位、地图拾取、拖动 */
export type LocationSource = 'input' | 'pick' | 'drag';

export interface LocationPoint {
  readonly lngLat: LngLat;
  readonly source: LocationSource;
}

export interface LocationState {
  /** 同一时间最多一个位置点 */
  readonly point: LocationPoint | null;
  /** 位置信息是否打开 */
  readonly infoOpen: boolean;
  /** 面板输入框的格式，本次进入页面内记住 */
  readonly format: CoordinateFormat;
}

/** 位置点所在的区县：没有位置点、判断中、结果（null 是不在江苏省内）、失败 */
export type LocationRegion =
  | { readonly kind: 'none' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly region: Region | null }
  | { readonly kind: 'failed'; readonly error: unknown };

/** 坐标定位与位置点的拥有者（ADR 0037）：页面登记拾取工具，面板、图钉和位置信息通过 props 拿到它 */
export interface LocationPointOwner {
  readonly state: Readonly<ShallowRef<LocationState>>;
  readonly region: Readonly<ShallowRef<LocationRegion>>;
  /** 拾取时鼠标在画布上的位置，只用来放提示 */
  readonly pickPointer: Readonly<ShallowRef<ScreenPoint | null>>;
  /** 交给 registerTools */
  readonly tools: Readonly<Record<typeof LOCATION_PICK_TOOL, MapTool>>;
  /** 输入坐标后定位：放下位置点，飞过去，缩放小于 14 级时放大到 14 级；是一次相机操作，视图还没就绪时就绪后再飞（ADR 0038） */
  readonly locate: (lngLat: LngLat) => void;
  /** 放下或移动位置点，不移动地图（拖动、拖动取消时回到原位） */
  readonly place: (lngLat: LngLat, source: LocationSource) => void;
  /** 删除位置点，连同位置信息 */
  readonly remove: () => void;
  readonly setInfoOpen: (open: boolean) => void;
  readonly setFormat: (format: CoordinateFormat) => void;
}

export interface LocationPointOptions {
  /** 判断所在区县；默认用整个应用共用的加载器（和区划定位共用县界），测试时注入 */
  readonly regions?: Pick<RegionBoundaryLoader, 'districtCodeAt'>;
}

const INITIAL: LocationState = Object.freeze({ point: null, infoOpen: false, format: 'dms' });

/** 创建位置点的拥有者，在 provideMap 所在组件的 setup 中调用；作用域销毁时丢弃进行中的区县判断 */
export function useLocationPoint(
  map: Pick<MapContext, 'useCamera' | 'releaseTool' | 'runCameraOperation'>,
  options: LocationPointOptions = {}
): LocationPointOwner {
  if (!getCurrentScope()) {
    throw new Error('useLocationPoint 只能在组件的 setup 或 effectScope 中调用');
  }
  const regions = options.regions ?? sharedRegionBoundaryLoader();
  const camera = map.useCamera();
  const state = shallowRef<LocationState>(INITIAL);
  const region = shallowRef<LocationRegion>({ kind: 'none' });
  const pickPointer = shallowRef<ScreenPoint | null>(null);

  // 值没变时不替换状态，免得重新渲染（ADR 0031）
  const update = (patch: Partial<LocationState>) => {
    const current = state.value;
    const next = { ...current, ...patch };
    if (next.point !== current.point || next.infoOpen !== current.infoOpen || next.format !== current.format) {
      state.value = next;
    }
  };

  const place = (lngLat: LngLat, source: LocationSource) => update({ point: { lngLat, source } });

  const locate = (lngLat: LngLat) => {
    place(lngLat, 'input');
    // 之前没完成的定位作废；视图还没就绪时等到就绪再飞，级别按那时的相机算
    map.runCameraOperation(control => {
      const zoom = Math.max(camera.value.zoom, LOCATE_MIN_ZOOM);
      control.flyTo({ center: lngLat, zoom }, { duration: LOCATE_DURATION });
    });
  };

  // 单击一次就放下位置点、打开位置信息并退出（ADR 0037 第 4 条）；Esc 不处理，由工具模型退回常驻模式
  const handlePick = (event: MapInputEvent, view: ToolView): boolean => {
    switch (event.type) {
      case 'move':
        pickPointer.value = event.point;
        return true;
      case 'leave':
        pickPointer.value = null;
        return true;
      case 'click': {
        if (event.button !== 0 || event.clickCount > 1) {
          return false;
        }
        const result = view.pick(event.point);
        if (result.kind === 'hit') {
          update({ point: { lngLat: result.lngLat, source: 'pick' }, infoOpen: true });
          map.releaseTool(LOCATION_PICK_TOOL);
        }
        return true;
      }
      case 'down':
      case 'up':
      case 'dblclick':
      case 'key':
        break;
    }
    return false;
  };

  const pickTool: MapTool = {
    persistent: false,
    cursor: 'crosshair',
    deactivate: () => (pickPointer.value = null),
    handleInput: handlePick
  };

  // 位置点变化时重新判断所在区县；拖动时每次移动都判断，只采用最后一次的结果
  const lookups = new LatestController();
  watch(
    () => state.value.point?.lngLat,
    async lngLat => {
      const signal = lookups.next();
      if (!lngLat) {
        region.value = { kind: 'none' };
        return;
      }
      region.value = { kind: 'loading' };
      try {
        const code = await regions.districtCodeAt(lngLat);
        if (!signal.aborted) {
          region.value = { kind: 'ready', region: code === null ? null : (findRegion(code) ?? null) };
        }
      } catch (error) {
        if (!signal.aborted) {
          region.value = { kind: 'failed', error };
        }
      }
    }
  );
  onScopeDispose(() => lookups[Symbol.dispose]());

  return {
    state: shallowReadonly(state),
    region: shallowReadonly(region),
    pickPointer: shallowReadonly(pickPointer),
    tools: { [LOCATION_PICK_TOOL]: pickTool },
    locate,
    place,
    remove: () => update({ point: null, infoOpen: false }),
    setInfoOpen: open => update({ infoOpen: open }),
    setFormat: format => update({ format })
  };
}
