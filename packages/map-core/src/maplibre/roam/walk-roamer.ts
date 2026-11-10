import type { NavPoint } from '../../scene/nav/nav-grid';
import { invertRigid, type Mat4, type Point3, transformPoint } from '../../scene/nav/nav-frame';
import { startPitch, WalkRig } from '../../scene/nav/third-person';
import {
  chooseSpawn,
  type ClickResolution,
  headingToYaw,
  planMove,
  resolveClick,
  type SpawnContext,
  unstuckSpot,
  type VisibilityTest,
  walkAxes,
  Walker,
  WALK_KEYS,
  type WalkPose,
  type WalkView
} from '../../scene/nav/walker';
import type { WalkNotice, WalkPhase, WalkPlayer, WalkRoam } from '../../scene/scene-content-model';
import type { ScreenPoint } from '../../view/view-input';
import { Blackout } from '../../view/blackout';
import { anglesOf, type RoamEye } from './roam-camera';
import type { RoamHost } from './roam-host';

// 从 map-cesium 的 scene-walk 移植（ADR 0086、0087、0090）；Cesium 一侧只修缺陷（ADR 0147 第 6 节），手感只在这里调

// 室内要比二维（约 37°）宽得多的竖直视场角；第一人称滚轮改视场角（相机不动，贴着墙缩放也不穿模），每像素滚动量约 0.12%
const WALK_FOVY = (60 * Math.PI) / 180;
const MIN_FOVY = (20 * Math.PI) / 180;
const MAX_FOVY = (75 * Math.PI) / 180;
const ZOOM_SENSITIVITY = 0.0012;
const FOV_EASE = 12;
// 方向键转向（每秒），右键拖动转向（默认视场角下每像素）
const TURN_SPEED = Math.PI / 2;
const LOOK_SENSITIVITY = (0.2 * Math.PI) / 180;
// 一帧最多按这么多秒推进：页面停用、卡顿回来不跳一大段
const MAX_FRAME = 0.1;
// 左键按下到松开挪动不超过 5 像素才算点击；按住不超过 300 毫秒的放宽到 30 像素（追着走连点时手还在移动）
const CLICK_TOLERANCE = 5;
const QUICK_CLICK = 300;
const QUICK_CLICK_TOLERANCE = 30;
// 悬停光标要拾取，指针或视角变了才重新判断，最多这么久一次（毫秒）
const HOVER_INTERVAL = 80;
// 滚轮按行、按页滚动时换成像素
const WHEEL_LINE = 33;
const WHEEL_PAGE = 600;

export interface WalkRoamerEvents {
  readonly phase: (phase: WalkPhase) => void;
  readonly notice: (notice: WalkNotice) => void;
  /** 人的位置、朝向、视场角或落点变了 */
  readonly player: (player: WalkPlayer) => void;
}

/** 选出生点时的相机：真实的视点；画布中心对着的地面点（地心坐标），在模型里时为 null */
export interface WalkStartContext {
  readonly eye: RoamEye;
  readonly ground: Point3 | null;
}

interface Walking {
  readonly walker: Walker;
  readonly rig: WalkRig;
  readonly toWorld: Mat4;
  readonly toLocal: Mat4;
  readonly spawn: WalkPose;
  phase: 'entering' | 'walking';
}

// 左键按下：落点在按下时就定下来，刚闪切过去、新画面还没画出来时等松开再定
interface Press {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly time: number;
  readonly position: ScreenPoint;
  readonly resolution: ClickResolution | null;
  moved: number;
}

// 右键拖动转向，中键拖动缩放
interface Look {
  readonly id: number;
  readonly zoom: boolean;
  x: number;
  y: number;
}

interface Hover {
  readonly position: ScreenPoint;
  // 指针动过；revision 是上次判断时相机的修订号
  dirty: boolean;
  revision: number;
}

interface Blink {
  action: () => void;
  // 已经挪过去：新画面画出来之前不接受点击，那时拾取用的还是旧画面的相机
  placed: boolean;
}

const isKey = (event: Event): event is KeyboardEvent => event instanceof KeyboardEvent;
const isPointer = (event: Event): event is PointerEvent => event instanceof PointerEvent;
const isWheel = (event: Event): event is WheelEvent => event instanceof WheelEvent;
const any = (_event: Event): _event is Event => true;

// 能打字的输入框：单选、复选、按钮这类不算，点完操作条上的按钮不用先点一下地图就能接着走
const TEXT_INPUTS = new Set([
  'text',
  'search',
  'url',
  'tel',
  'email',
  'password',
  'number',
  'date',
  'datetime-local',
  'month',
  'time',
  'week'
]);

function isEditable(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) {
    return TEXT_INPUTS.has(target.type);
  }
  return target instanceof HTMLElement && (target.isContentEditable || ['TEXTAREA', 'SELECT'].includes(target.tagName));
}

// 在容器上按捕获阶段拦下，不传到画布：MapLibre 的手势、交给工具的鼠标事件一并挡掉
function swallow(event: Event): void {
  event.stopPropagation();
  if (event.cancelable) {
    event.preventDefault();
  }
}

// 局部系的方向换到地心坐标（只用旋转部分）
function direction(toWorld: Mat4, [x, y, z]: Point3): Point3 {
  const out: Point3 = [
    toWorld[0] * x + toWorld[4] * y + toWorld[8] * z,
    toWorld[1] * x + toWorld[5] * y + toWorld[9] * z,
    toWorld[2] * x + toWorld[6] * y + toWorld[10] * z
  ];
  const length = Math.hypot(...out);
  return [out[0] / length, out[1] / length, out[2] / length];
}

const distance = (a: Point3, b: Point3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * 步行的相机与键鼠（ADR 0086 第 3、4 节）：选出生点，落地后每帧按 Walker 和 WalkRig 设相机。
 * W/A/S/D、方向键行走转向；左键点地面移动（落点光环、寻路、穿闸机或闪切），右键拖动转向；
 * 滚轮、中键拖动在第一人称改视场角，在第三人称调相机远近（人物模型还没有，ADR 0090 的入口没开放）。
 * 进出、抬高由 MapLibreRoam 负责
 */
export class WalkRoamer implements Disposable {
  readonly #host: RoamHost;
  readonly #events: WalkRoamerEvents;
  readonly #blackout: Blackout;
  #walking: Walking | null = null;
  // 行走期间的监听，结束时撤掉
  #input: DisposableStack | null = null;
  #speed = 1;
  readonly #keys = new Set<string>();
  #fovy = WALK_FOVY;
  #zoomFovy = WALK_FOVY;
  #last: number | null = null;
  // 上次设给相机的位置、朝向和视场角；相机每变一次 revision 加 1，悬停光标据此判断要不要重新判断
  #applied: readonly number[] | null = null;
  #revision = 0;
  #eye: RoamEye | null = null;
  #press: Press | null = null;
  #look: Look | null = null;
  #hover: Hover | null = null;
  #hoverAt = 0;
  #hoverTimer: ReturnType<typeof setTimeout> | undefined;
  #blink: Blink | null = null;
  #rendering = true;
  // 完整地图打开时暂停：不响应键鼠（ADR 0087）
  #paused = false;
  #reported: WalkPlayer | null = null;

  constructor(host: RoamHost, events: WalkRoamerEvents) {
    this.#host = host;
    this.#events = events;
    this.#blackout = new Blackout(host.container);
  }

  /** 选好了出生点（进站中或行走中） */
  get active(): boolean {
    return this.#walking !== null;
  }

  /** 最后设给相机的视点；还没落地时为 null */
  get eye(): RoamEye | null {
    return this.#eye;
  }

  /** 出生点的视点：落地之前用来算要不要闪切 */
  get spawnEye(): RoamEye | null {
    const walking = this.#walking;
    return walking ? this.#pose(walking) : null;
  }

  /**
   * 选出生点（ADR 0086 第 3 节）：之前的一并结束。找到时报告 entering，返回 true，相机等 land 再动；
   * 找不到时报告 failed
   */
  prepare({ navigation, spawn, speed, view }: WalkRoam, context: WalkStartContext): boolean {
    this.#teardown();
    this.#speed = speed;
    const { grid, frame } = navigation;
    const toWorld = Float64Array.from(frame.toWorld);
    const toLocal = invertRigid(toWorld);
    const preferred = spawn
      ? { point: frame.toLocal(spawn.lng, spawn.lat, spawn.height), yaw: headingToYaw(spawn.heading, frame.north) }
      : null;
    const pose = chooseSpawn(grid, this.#spawnContext(context, toLocal, frame.north, frame.ground, preferred));
    if (!pose) {
      this.#events.phase('failed');
      return false;
    }
    const walker = new Walker(grid, pose);
    walker.look(pose.yaw, startPitch(view));
    const rig = new WalkRig(walker, view);
    this.#walking = { walker, rig, toWorld, toLocal, spawn: pose, phase: 'entering' };
    this.#fovy = WALK_FOVY;
    this.#zoomFovy = WALK_FOVY;
    this.#events.phase('entering');
    return true;
  }

  /** 落到出生点：设相机、接管键鼠，报告 walking */
  land(): void {
    const walking = this.#walking;
    if (walking?.phase !== 'entering') {
      return;
    }
    walking.phase = 'walking';
    this.#applied = null;
    this.#last = null;
    this.#applyCamera(walking);
    this.#attachInput();
    this.#events.phase('walking');
    this.#reportPlayer(walking);
    this.#host.requestFrame();
  }

  setSpeed(speed: number): void {
    this.#speed = speed;
  }

  /** 换人称：相机沿弹簧臂滑出、收回；第三人称滚轮调远近，视场角回到默认 */
  setView(view: WalkView): void {
    const walking = this.#walking;
    if (!walking || walking.rig.view === view) {
      return;
    }
    walking.rig.setView(view);
    if (view === 'third') {
      this.#zoomFovy = WALK_FOVY;
    }
    this.#host.requestFrame();
  }

  /** 回到这次的出生点（闪切过去，看不到中间穿过的墙） */
  respawn(): void {
    const walking = this.#walking;
    if (walking?.phase === 'walking') {
      const { walker, rig, spawn } = walking;
      this.#blinkTo(() => {
        walker.placeAt(spawn);
        walker.look(spawn.yaw, startPitch(rig.view));
        rig.faceView();
      });
    }
  }

  /** 脱困：挪到附近开阔的地面；本来就开阔、附近没有时只给提示 */
  unstuck(): void {
    const walking = this.#walking;
    if (walking?.phase !== 'walking') {
      return;
    }
    const result = unstuckSpot(walking.walker);
    if (result.kind === 'move') {
      this.#blinkTo(() => walking.walker.placeAt(result.spot));
    } else {
      this.#events.notice(result.kind === 'open' ? 'open' : 'no-open-ground');
    }
  }

  /** 闪切到 spot（完整地图上双击的位置） */
  teleport(spot: NavPoint): void {
    const walking = this.#walking;
    if (walking?.phase === 'walking') {
      this.#blinkTo(() => walking.walker.placeAt(spot));
    }
  }

  /** 完整地图打开时暂停：忘掉按着的键、拖动和悬停，不再响应键鼠；点击移动的路径照常走完 */
  setPaused(paused: boolean): void {
    this.#paused = paused;
    if (paused) {
      this.#forgetInput();
      this.#setCursor('');
    }
  }

  /** 页面停用时停下：按着的键收不到松开，一并忘掉 */
  setActive(active: boolean): void {
    this.#rendering = active;
    if (!active) {
      this.#forgetInput();
    }
  }

  /** 结束：撤掉监听、光环和黑幕，相机不动 */
  stop(): void {
    this.#teardown();
  }

  [Symbol.dispose](): void {
    this.#teardown();
    this.#blackout[Symbol.dispose]();
  }

  /** 每帧：按键和点击移动推进 Walker，设相机，报告人的位置 */
  tick(now: number): void {
    const walking = this.#walking;
    if (walking?.phase !== 'walking') {
      return;
    }
    const dt = this.#last === null ? 0 : Math.min((now - this.#last) / 1000, MAX_FRAME);
    this.#last = now;
    const { walker, rig } = walking;
    const from = walker.position;
    const { forward, strafe, turn } = walkAxes(this.#keys);
    walker.turn(turn * TURN_SPEED * dt, 0);
    let moving = false;
    if (walker.destination) {
      const step = walker.follow(this.#speed * dt);
      moving = step === 'moving';
      if (step === 'blocked') {
        this.#events.notice('blocked');
      }
    } else {
      walker.walk(forward, strafe, this.#speed * dt);
    }
    if (!walker.destination) {
      this.#host.setMarker(null);
    }
    const settling = walker.settleEye(dt);
    rig.step(from, dt);
    const zooming = this.#easeFov(dt);
    // 要在本帧挪相机之前：拾取按的是上一帧画出来的相机
    this.#updateHover(now);
    this.#applyCamera(walking);
    this.#reportPlayer(walking);
    if (this.#keys.size > 0 || moving || settling || zooming || rig.settling) {
      this.#host.requestFrame();
    } else {
      this.#last = null;
    }
  }

  #spawnContext(
    { eye, ground }: WalkStartContext,
    toLocal: Mat4,
    north: number,
    groundHeight: number,
    preferred: SpawnContext['preferred']
  ): SpawnContext {
    const { height, heading } = anglesOf(eye);
    return {
      eye: transformPoint(toLocal, eye.position),
      eyeHeight: height,
      ground: ground ? transformPoint(toLocal, ground) : null,
      yaw: headingToYaw(heading, north),
      preferred,
      groundHeight
    };
  }

  // 相机的位置和朝向在局部系里算，换到地心坐标：方向按局部系的轴转过去，局部系不朝北时也对
  #pose({ walker, rig, toWorld }: Walking): RoamEye {
    const { yaw, pitch } = walker;
    const [sy, cy, sp, cp] = [Math.sin(yaw), Math.cos(yaw), Math.sin(pitch), Math.cos(pitch)];
    return { position: transformPoint(toWorld, rig.eye), direction: direction(toWorld, [sy * cp, cy * cp, sp]) };
  }

  // 视场角平滑趋向滚轮调到的值；返回是否还在变
  #easeFov(dt: number): boolean {
    if (this.#fovy === this.#zoomFovy) {
      return false;
    }
    this.#fovy += (this.#zoomFovy - this.#fovy) * Math.min(1, dt * FOV_EASE);
    if (Math.abs(this.#zoomFovy - this.#fovy) < 1e-4) {
      this.#fovy = this.#zoomFovy;
    }
    return true;
  }

  // 人的位置、朝向、视场角、落点变了才报告；水平视场角按画布的宽高比由竖直的换算
  #reportPlayer({ walker }: Walking): void {
    const { x, y, floor } = walker.position;
    const destination = walker.destination;
    const { clientWidth, clientHeight } = this.#host.canvas;
    const aspect = clientHeight > 0 ? clientWidth / clientHeight : 1;
    const player: WalkPlayer = {
      x,
      y,
      floor,
      yaw: walker.yaw,
      hfov: 2 * Math.atan(Math.tan(this.#fovy / 2) * aspect),
      target: destination ? { x: destination.x, y: destination.y } : null
    };
    const last = this.#reported;
    const same =
      last !== null &&
      [last.x - x, last.y - y, last.floor - floor, last.yaw - player.yaw, last.hfov - player.hfov].every(
        difference => Math.abs(difference) < 1e-4
      ) &&
      last.target?.x === player.target?.x &&
      last.target?.y === player.target?.y;
    if (!same) {
      this.#reported = player;
      this.#events.player(player);
    }
  }

  // 没动就不改相机，免得每帧都触发相机变化
  #applyCamera(walking: Walking): void {
    const { walker, rig } = walking;
    const state = [...rig.eye, walker.yaw, walker.pitch, this.#fovy];
    if (this.#applied?.every((value, index) => Math.abs(value - (state[index] ?? 0)) < 1e-5)) {
      return;
    }
    this.#applied = state;
    this.#revision++;
    const eye = this.#pose(walking);
    this.#eye = eye;
    this.#host.setEye(eye, this.#fovy);
  }

  // 行走期间的键盘（窗口上，不用先点画布）和鼠标（容器上、捕获阶段）
  #attachInput(): void {
    const input = new DisposableStack();
    this.#input = input;
    const { container } = this.#host;
    const on = <E extends Event>(
      target: EventTarget,
      type: string,
      listener: (event: E) => void,
      guard: (event: Event) => event is E,
      options?: AddEventListenerOptions
    ) => {
      const handle = (event: Event) => {
        if (guard(event)) {
          listener(event);
        }
      };
      target.addEventListener(type, handle, options);
      input.defer(() => target.removeEventListener(type, handle, options));
    };
    const capture = { capture: true, passive: false };
    on(window, 'keydown', event => this.#onKeyDown(event), isKey);
    on(window, 'keyup', event => this.#keys.delete(event.code), isKey);
    // 切走窗口时松开的键收不到 keyup，避免一直走
    on(window, 'blur', () => this.#keys.clear(), any);
    on(container, 'pointerdown', event => this.#onPointerDown(event), isPointer, capture);
    on(container, 'pointermove', event => this.#onPointerMove(event), isPointer, capture);
    on(container, 'pointerup', event => this.#onPointerUp(event), isPointer, capture);
    on(container, 'pointercancel', event => this.#onPointerUp(event), isPointer, capture);
    on(container, 'pointerleave', event => this.#onPointerLeave(event), isPointer, capture);
    on(container, 'wheel', event => this.#onWheel(event), isWheel, capture);
    // MapLibre 在 mousedown 上也有手势；中键的自动滚动、双击、右键菜单
    for (const type of ['mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu']) {
      on(container, type, swallow, any, capture);
    }
    this.#setCursor('');
  }

  // 键盘只管行走（W/A/S/D、方向键）；回出生点、脱困、调速、退出都在操作条上
  #onKeyDown(event: KeyboardEvent): void {
    if (
      !this.#rendering ||
      this.#paused ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      isEditable(event.target) ||
      !WALK_KEYS.has(event.code)
    ) {
      return;
    }
    // 方向键不要滚动页面；自己动手就打断点击移动
    event.preventDefault();
    this.#keys.add(event.code);
    this.#walking?.walker.cancelRoute();
    this.#host.requestFrame();
  }

  #onPointerDown(event: PointerEvent): void {
    swallow(event);
    if (this.#paused) {
      return;
    }
    if (event.button === 0) {
      const position = this.#canvasPoint(event);
      this.#press = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        time: performance.now(),
        position,
        resolution: this.#blink?.placed ? null : this.#resolve(position),
        moved: 0
      };
    } else if (event.button === 1 || event.button === 2) {
      // 右键"抓住画面拖"：往右拖画面跟着往右走，视线往左转，和光标的抓手一致
      this.#look = { id: event.pointerId, zoom: event.button === 1, x: event.clientX, y: event.clientY };
      // 拖出画布也能继续
      this.#host.container.setPointerCapture(event.pointerId);
      this.#hover = null;
      this.#setCursor(event.button === 1 ? 'ns-resize' : 'grabbing');
    }
  }

  #onPointerMove(event: PointerEvent): void {
    swallow(event);
    const press = this.#press;
    if (press && event.pointerId === press.id) {
      press.moved = Math.max(press.moved, Math.hypot(event.clientX - press.x, event.clientY - press.y));
    }
    const look = this.#look;
    if (this.#paused) {
      return;
    }
    if (!look) {
      this.#hover = { position: this.#canvasPoint(event), dirty: true, revision: -1 };
      this.#updateHover(performance.now());
      return;
    }
    const walking = this.#walking;
    if (event.pointerId !== look.id || this.#blink || !walking) {
      return;
    }
    if (look.zoom) {
      // 往下拖拉远，往上拖拉近
      this.#zoomBy((event.clientY - look.y) * 3);
    } else {
      // 放大后视野窄，转向跟着变慢，瞄得准
      const sensitivity = LOOK_SENSITIVITY * (this.#fovy / WALK_FOVY);
      walking.walker.turn(-(event.clientX - look.x) * sensitivity, (event.clientY - look.y) * sensitivity);
    }
    look.x = event.clientX;
    look.y = event.clientY;
    this.#host.requestFrame();
  }

  // 鼠标各键共用一个 pointerId：按住一个键再按另一个不会有新的 pointerdown，松开要等所有键都松开，各种状态一起结束
  #onPointerUp(event: PointerEvent): void {
    swallow(event);
    const look = this.#look;
    if (look && event.pointerId === look.id) {
      this.#host.container.releasePointerCapture(event.pointerId);
      this.#look = null;
      this.#setCursor('');
      this.#hover = { position: this.#canvasPoint(event), dirty: true, revision: -1 };
    }
    const press = this.#press;
    this.#press = null;
    if (!press || event.pointerId !== press.id || event.type !== 'pointerup' || event.button !== 0) {
      return;
    }
    const moved = Math.max(press.moved, Math.hypot(event.clientX - press.x, event.clientY - press.y));
    const quick = performance.now() - press.time <= QUICK_CLICK;
    if (moved > (quick ? QUICK_CLICK_TOLERANCE : CLICK_TOLERANCE) || this.#blink?.placed) {
      return;
    }
    this.#moveTo(press.resolution ?? this.#resolve(press.position));
  }

  #onPointerLeave(event: PointerEvent): void {
    if (event.target === this.#host.canvas && !this.#look) {
      this.#hover = null;
      this.#setCursor('');
    }
  }

  #onWheel(event: WheelEvent): void {
    swallow(event);
    if (this.#blink || this.#paused) {
      return;
    }
    const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE : 1;
    this.#zoomBy(event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? WHEEL_PAGE : scale));
  }

  // 第一人称改视场角，第三人称调相机远近
  #zoomBy(pixels: number): void {
    const rig = this.#walking?.rig;
    if (rig?.view === 'third') {
      rig.zoom(pixels);
    } else {
      this.#zoomFovy = Math.max(MIN_FOVY, Math.min(MAX_FOVY, this.#zoomFovy * Math.exp(pixels * ZOOM_SENSITIVITY)));
    }
    this.#host.requestFrame();
  }

  #canvasPoint(event: MouseEvent): ScreenPoint {
    const box = this.#host.canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  // 点击处的地面以拾取到的表面为准：它就是用户看到并点中的；半透明的跳过，隔着玻璃点到的是后面的地面
  #resolve(position: ScreenPoint): ClickResolution {
    const walking = this.#walking;
    if (walking?.phase !== 'walking') {
      return { kind: 'refuse', reason: 'not-standable' };
    }
    return resolveClick(walking.walker, this.#pickSurface(walking, position), this.#visible);
  }

  // 拾取到的表面（局部系）；什么都没打到为 null
  #pickSurface(walking: Walking, position: ScreenPoint): Point3 | null {
    const world = this.#host.pick(position);
    return world ? transformPoint(walking.toLocal, world) : null;
  }

  // 从当前视点看过去，局部系里的 point 前面有没有不透明的东西挡着：投影到屏幕上再拾取那个点；不在画面里算挡着
  readonly #visible: VisibilityTest = (point: Point3, tolerance: number) => {
    const walking = this.#walking;
    const eye = this.#eye;
    if (!walking || !eye) {
      return false;
    }
    const screen = this.#host.project(transformPoint(walking.toWorld, point));
    const { clientWidth, clientHeight } = this.#host.canvas;
    if (!screen || screen.x < 0 || screen.y < 0 || screen.x > clientWidth || screen.y > clientHeight) {
      return false;
    }
    const surface = this.#pickSurface(walking, screen);
    if (!surface) {
      return true;
    }
    const from = transformPoint(walking.toLocal, eye.position);
    return distance(from, surface) >= distance(from, point) - tolerance;
  };

  // 点中能去的地面：落点亮起光环，走过去、穿过闸机，或者闪切；去不了的给提示
  #moveTo(resolution: ClickResolution): void {
    const walking = this.#walking;
    if (walking?.phase !== 'walking') {
      return;
    }
    if (resolution.kind === 'refuse') {
      this.#events.notice(resolution.reason);
      return;
    }
    const { target, reachable } = resolution;
    const { walker, toWorld } = walking;
    this.#host.setMarker(transformPoint(toWorld, [target.x, target.y, target.floor]));
    const plan = planMove(walker, target, reachable, this.#visible, walking.rig.view);
    if (plan.kind === 'teleport') {
      this.#blinkTo(() => walker.placeAt(plan.spot));
    } else {
      // 正在变黑、还没挪过去的闪切作废：以最后一次点击为准
      this.#cancelBlink();
      walker.startRoute(plan.points, plan.kind === 'through');
    }
    this.#host.requestFrame();
  }

  // 悬停光标：指着能去的地面是默认光标，指着墙、柜顶这类去不了的地方是禁用光标；在节流里的等到期再判断
  #updateHover(now: number): void {
    const hover = this.#hover;
    if (!hover || this.#walking?.phase !== 'walking' || this.#blink || this.#look) {
      return;
    }
    if (!hover.dirty && hover.revision === this.#revision) {
      return;
    }
    const wait = HOVER_INTERVAL - (now - this.#hoverAt);
    if (wait > 0) {
      if (this.#hoverTimer === undefined) {
        this.#hoverTimer = setTimeout(() => {
          this.#hoverTimer = undefined;
          this.#updateHover(performance.now());
        }, wait);
      }
      return;
    }
    this.#hoverAt = now;
    hover.dirty = false;
    hover.revision = this.#revision;
    this.#setCursor(this.#resolve(hover.position).kind === 'go' ? '' : 'not-allowed');
  }

  #setCursor(cursor: string): void {
    this.#host.canvas.style.cursor = cursor;
  }

  // 闪切以最后一次操作为准：变黑的过程中又要去别处，就改去新的地方
  #blinkTo(action: () => void): void {
    const current = this.#blink;
    if (current) {
      if (!current.placed) {
        current.action = action;
      }
      return;
    }
    this.#walking?.walker.cancelRoute();
    const blink: Blink = { action, placed: false };
    this.#blink = blink;
    this.#blackout.darken(() => this.#placeBlink(blink));
  }

  // 挪过去以后下一帧（新画面画出来）就恢复响应，不用等画面完全亮起来
  #placeBlink(blink: Blink): void {
    const walking = this.#walking;
    if (this.#blink !== blink || !walking) {
      return;
    }
    blink.placed = true;
    blink.action();
    this.#applied = null;
    this.#applyCamera(walking);
    this.#reportPlayer(walking);
    this.#blackout.lighten();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (this.#blink === blink) {
          this.#blink = null;
        }
      })
    );
    this.#host.requestFrame();
  }

  #cancelBlink(): void {
    const blink = this.#blink;
    if (!blink || blink.placed) {
      return;
    }
    this.#blink = null;
    this.#blackout.lighten();
  }

  #forgetInput(): void {
    this.#keys.clear();
    this.#press = null;
    this.#look = null;
    this.#hover = null;
  }

  // 撤掉这次步行的监听、光环、黑幕和按键，相机不动
  #teardown(): void {
    this.#input?.dispose();
    this.#input = null;
    this.#blink = null;
    this.#blackout.clear();
    clearTimeout(this.#hoverTimer);
    this.#hoverTimer = undefined;
    if (this.#walking) {
      this.#host.setMarker(null);
    }
    this.#walking = null;
    this.#eye = null;
    this.#reported = null;
    this.#paused = false;
    this.#forgetInput();
    this.#setCursor('');
  }
}
