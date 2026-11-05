// 测量脚本和三种页面（方案 C、独立 Three 场景、Cesium）之间的接口；LCC2 页面在 lcc2/src/map-page.ts 里实现同样的形状

/** 俯瞰相机：和 MapLibre 的相机参数相同 */
export interface BenchView {
  readonly center: readonly [number, number];
  readonly zoom: number;
  readonly bearing: number;
  readonly pitch: number;
}

/** 第一人称相机：height 是椭球高（米），heading 从正北顺时针，pitch 向上为正（度） */
export interface BenchEye {
  readonly lng: number;
  readonly lat: number;
  readonly height: number;
  readonly heading: number;
  readonly pitch: number;
}

export type BenchCamera = BenchView | BenchEye;

export const isEye = (camera: BenchCamera): camera is BenchEye => 'height' in camera;

export interface BenchApi {
  readonly engine: string;
  /** 写进报告的固定配置 */
  readonly config: Readonly<Record<string, unknown>>;
  readonly gl: WebGL2RenderingContext;
  /** 开始加载模型的时刻（performance.now） */
  readonly loadStartedAt: number;
  readonly errors: string[];
  /** 模型的下载、解析队列都空了 */
  isStable(): boolean;
  basemapIdle(): boolean;
  /** 等待期间让引擎继续更新 */
  tick(): void;
  /** 打开后每帧都重画，静止时的帧时间才是完整一帧的成本 */
  setContinuous(on: boolean): void;
  setCamera(camera: BenchCamera): void;
  setModelVisible(visible: boolean): void;
  renders(): number;
  stats(): Readonly<Record<string, number | string | null>>;
}

export function publish(api: BenchApi): void {
  Object.assign(window, { bench: api, benchReady: true });
}

export function numberParam(params: URLSearchParams, name: string, fallback: number): number {
  const value = params.get(name);
  return value === null ? fallback : Number(value);
}

export function parseEye(text: string | null): BenchEye | null {
  if (!text) {
    return null;
  }
  const [lng, lat, height, heading, pitch] = text.split(',').map(Number);
  return { lng, lat, height, heading, pitch };
}

export function parseCenter(text: string | null, fallback: readonly [number, number]): readonly [number, number] {
  if (!text) {
    return fallback;
  }
  const [lng, lat] = text.split(',').map(Number);
  return [lng, lat];
}

/** 手动检查第一人称手感：WASD 走、左键拖动转头。只挪相机，不做碰撞 */
export function bindWalkKeys(target: HTMLElement, start: BenchEye, apply: (eye: BenchEye) => void): void {
  let eye = start;
  const keys = new Set<string>();
  window.addEventListener('keydown', event => keys.add(event.code));
  window.addEventListener('keyup', event => keys.delete(event.code));
  target.addEventListener('pointermove', event => {
    if (event.buttons === 1) {
      eye = {
        ...eye,
        heading: eye.heading + event.movementX * 0.2,
        pitch: Math.max(-80, Math.min(80, eye.pitch - event.movementY * 0.2))
      };
      apply(eye);
    }
  });
  let last = performance.now();
  const step = (now: number) => {
    requestAnimationFrame(step);
    const seconds = Math.min(0.1, (now - last) / 1000);
    last = now;
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    if (forward === 0 && strafe === 0) {
      return;
    }
    const rad = (eye.heading * Math.PI) / 180;
    const north = (Math.cos(rad) * forward - Math.sin(rad) * strafe) * 2.5 * seconds;
    const east = (Math.sin(rad) * forward + Math.cos(rad) * strafe) * 2.5 * seconds;
    eye = {
      ...eye,
      lat: eye.lat + north / 110950,
      lng: eye.lng + east / (111320 * Math.cos((eye.lat * Math.PI) / 180))
    };
    apply(eye);
  };
  requestAnimationFrame(step);
}
