import { inject, onScopeDispose, provide, type InjectionKey } from 'vue';

/** 导出图片里留给一个叠加元素的宽高（CSS 像素） */
export interface ExportRoom {
  readonly width: number;
  readonly height: number;
}

/** 叠加元素在导出图片里占的宽高（CSS 像素）和画法 */
export interface PlacedExportPart {
  readonly width: number;
  readonly height: number;
  /** context 已按 CSS 像素缩放，(x, y) 是左上角 */
  draw(context: CanvasRenderingContext2D, x: number, y: number): void;
}

/** 点下载时冻结的叠加元素：字体就绪后按留给它的宽高排版，放不下时为 null */
export interface ExportPart {
  layout(context: CanvasRenderingContext2D, room: ExportRoom): PlacedExportPart | null;
}

/** 点下载时同步调用、取当时的值；要加载的图片在返回的 Promise 里等 */
export type ExportPartCapture = () => ExportPart | null | Promise<ExportPart | null>;

type RegisterExportPart = (capture: ExportPartCapture) => () => void;

const EXPORT_PART: InjectionKey<RegisterExportPart> = Symbol('dashboard-map-export-part');

/** 地图角上的位置收集放在里面的叠加元素，导出时按登记的顺序画 */
export function provideExportParts(parts: Set<ExportPartCapture>): void {
  provide(EXPORT_PART, capture => {
    parts.add(capture);
    return () => {
      parts.delete(capture);
    };
  });
}

/** 点下载时取一个角上登记的画法，按登记的顺序；要加载的等加载完，没有画法的（返回 null）去掉 */
export async function captureExportParts(parts: ReadonlySet<ExportPartCapture>): Promise<ExportPart[]> {
  const captured = await Promise.all([...parts].map(capture => Promise.resolve(capture())));
  return captured.filter(part => part !== null);
}

/** 叠加元素登记自己在导出图片里的画法，卸载时撤销；不在地图的角上时什么也不做 */
export function useExportPart(capture: ExportPartCapture): void {
  const register = inject(EXPORT_PART, null);
  if (register) {
    onScopeDispose(register(capture));
  }
}
