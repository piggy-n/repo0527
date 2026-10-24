import { booleanIntersects } from '@turf/boolean-intersects';
import type { Polygon, Position } from 'geojson';
import { geodesicArea } from '../measure/geodesic';
import type { LngLat, MapInputEvent, ScreenPoint } from '../view/view-input';
import type { MapTool, PanModifier, ToolView } from './tool-model';

export interface PolygonDrawOptions {
  kind: 'rectangle' | 'polygon';
  panModifier: PanModifier;
  change: (points: readonly LngLat[]) => void;
  complete: (geometry: Polygon) => void;
  invalid: (message: string) => void;
}

/** 绘制结果必须闭合、非退化且不自相交，限制顶点数以控制请求大小 */
export function drawnPolygon(points: readonly LngLat[]): Polygon {
  if (points.length < 3 || points.length > 120) {
    throw new Error('范围需要 3～120 个顶点');
  }
  const coordinates: Position[] = points.map(point => [...point]);
  coordinates.push([...points[0]]);
  for (let first = 0; first < points.length; first++) {
    for (let second = first + 2; second < points.length; second++) {
      if (first === 0 && second === points.length - 1) {
        continue;
      }
      if (booleanIntersects(
        { type: 'LineString', coordinates: coordinates.slice(first, first + 2) },
        { type: 'LineString', coordinates: coordinates.slice(second, second + 2) }
      )) {
        throw new Error('范围边线不能交叉，请重新绘制');
      }
    }
  }
  if (geodesicArea(points) < 0.01) {
    throw new Error('范围过小，请重新绘制');
  }
  return { type: 'Polygon', coordinates: [coordinates] };
}

/** 通用范围工具只处理地图输入，不读取业务配置或操作地图引擎 */
export class PolygonDrawTool implements MapTool {
  readonly persistent = false;
  readonly cursor = 'crosshair';
  readonly gestures = { dragPan: false, doubleClickZoom: false, boxZoom: false };
  readonly panModifier: PanModifier;
  readonly #options: PolygonDrawOptions;
  #points: LngLat[] = [];
  #start: ScreenPoint | null = null;

  constructor(options: PolygonDrawOptions) {
    this.#options = options;
    this.panModifier = options.panModifier;
  }

  deactivate(): void {
    this.#points = [];
    this.#start = null;
    this.#options.change([]);
  }

  handleInput(event: MapInputEvent, view: ToolView): boolean | void {
    if (event.type === 'key') {
      if (event.key === 'Enter' && this.#options.kind === 'polygon') {
        this.#finish(this.#points);
        return true;
      }
      if (event.key === 'Backspace' && this.#options.kind === 'polygon') {
        this.#points.pop();
        this.#options.change([...this.#points]);
        return true;
      }
      return;
    }
    if (event.type === 'leave') {
      this.#start = null;
      this.#options.change([...this.#points]);
      return;
    }
    if (this.#options.kind === 'rectangle') {
      this.#rectangle(event, view);
      return;
    }
    const hit = view.pick(event.point);
    if (hit.kind === 'miss') {
      return;
    }
    if (event.type === 'move') {
      this.#options.change([...this.#points, hit.lngLat]);
    } else if (event.type === 'click' && event.button === 0 && event.clickCount < 2) {
      const last = this.#points.at(-1);
      if (!last || last[0] !== hit.lngLat[0] || last[1] !== hit.lngLat[1]) {
        this.#points.push(hit.lngLat);
      }
      this.#options.change([...this.#points]);
    } else if (event.type === 'dblclick' || (event.type === 'up' && event.button === 2)) {
      this.#finish(this.#points);
    }
  }

  #rectangle(event: Exclude<MapInputEvent, { type: 'key' }>, view: ToolView): void {
    if (event.type === 'down' && event.button === 0) {
      this.#start = event.point;
      return;
    }
    if (!this.#start || (event.type !== 'move' && event.type !== 'up')) {
      return;
    }
    const start = this.#start;
    const end = event.point;
    const corners = [start, { x: end.x, y: start.y }, end, { x: start.x, y: end.y }];
    const hits = corners.map(point => view.pick(point));
    if (hits.some(hit => hit.kind === 'miss')) {
      if (event.type === 'up') {
        this.deactivate();
        this.#options.invalid('未能取得完整范围，请重新绘制');
      }
      return;
    }
    const points = hits.flatMap(hit => hit.kind === 'hit' ? [hit.lngLat] : []);
    this.#options.change(points);
    if (event.type === 'up' && event.button === 0) {
      this.#start = null;
      if (Math.abs(end.x - start.x) < 3 || Math.abs(end.y - start.y) < 3) {
        this.#options.invalid('范围过小，请拖动绘制范围');
        this.#options.change([]);
        return;
      }
      this.#finish(points);
    }
  }

  #finish(points: readonly LngLat[]): void {
    let geometry: Polygon;
    try {
      geometry = drawnPolygon(points);
    } catch (error) {
      this.#options.invalid(error instanceof Error ? error.message : '无法生成查询范围');
      return;
    }
    this.deactivate();
    this.#options.complete(geometry);
  }
}
