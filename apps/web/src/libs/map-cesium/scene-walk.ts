import {
  chooseSpawn,
  type ClickResolution,
  headingToYaw,
  type NavPoint,
  planMove,
  type Point3,
  resolveClick,
  type SpawnContext,
  unstuckSpot,
  type VisibilityTest,
  walkAxes,
  Walker,
  WALK_KEYS,
  type WalkNotice,
  type WalkPhase,
  type WalkPlayer,
  type WalkPose
} from '@yzt/map-core';
import {
  Cartesian2,
  Cartesian3,
  Math as CesiumMath,
  type CesiumWidget,
  EasingFunction,
  Ellipsoid,
  Matrix4,
  SceneTransforms
} from 'cesium';
import { keepInputsOff, releaseCamera, type RoamSaved, takeOverCamera } from './scene-roam-camera';
import type { SceneWalkStart } from './scene-like';
import { WalkMarker } from './scene-walk-marker';

// 室内要比二维对齐时（约 37°）宽得多的竖直视场角；滚轮改视场角（相机不动，贴着墙缩放也不穿模），每像素滚动量约 0.12%
const WALK_FOVY = CesiumMath.toRadians(60);
const MIN_FOVY = CesiumMath.toRadians(20);
const MAX_FOVY = CesiumMath.toRadians(75);
const ZOOM_SENSITIVITY = 0.0012;
const FOV_EASE = 12;
// 方向键转向（每秒），右键拖动转向（默认视场角下每像素）
const TURN_SPEED = CesiumMath.toRadians(90);
const LOOK_SENSITIVITY = CesiumMath.toRadians(0.2);
const START_PITCH = CesiumMath.toRadians(-6);
const ENTER_FLIGHT = 2;
// 一帧最多按这么多秒推进：页面停用、卡顿回来不跳一大段
const MAX_FRAME = 0.1;
// 左键按下到松开挪动不超过 5 像素才算点击；快速点一下时手常常还在移动（追着走连点，实测按住 80～120 毫秒、
// 漂移 6～18 像素），按住不超过 300 毫秒的放宽到 30 像素
const CLICK_TOLERANCE = 5;
const QUICK_CLICK = 300;
const QUICK_CLICK_TOLERANCE = 30;
// 悬停光标要做深度拾取（读 GPU），指针或视角变了才重新判断，最多这么久一次（毫秒）
const HOVER_INTERVAL = 80;
// 闪切：先黑下来，挪过去，再亮起来，看不到穿墙的过程（毫秒）
const BLINK_OUT = 160;
const BLINK_IN = 260;
// 滚轮按行、按页滚动时换成像素
const WHEEL_LINE = 33;
const WHEEL_PAGE = 600;

export interface SceneWalkEvents {
  readonly phase: (phase: WalkPhase) => void;
  readonly notice: (notice: WalkNotice) => void;
  /** 人的位置、朝向、视场角或落点变了 */
  readonly player: (player: WalkPlayer) => void;
  /** 换竖直视场角（弧度）；null 换回场景默认的 */
  readonly setFovy: (fovy: number | null) => void;
}

interface Walking {
  readonly walker: Walker;
  readonly toWorld: Matrix4;
  readonly toLocal: Matrix4;
  readonly spawn: WalkPose;
  phase: 'entering' | 'walking';
}

// 左键按下：落点在按下时就定下来（按住的这一小会儿人还在走、相机跟着动），刚闪切过去、新画面还没画出来时等松开再定
interface Press {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly time: number;
  readonly position: Cartesian2;
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
  readonly position: Cartesian2;
  // 指针动过；revision 是上次判断时相机的修订号
  dirty: boolean;
  revision: number;
}

interface Blink {
  action: () => void;
  readonly timer: ReturnType<typeof setTimeout>;
  // 已经挪过去：之后到新画面画出来之前（不到一帧，画面全黑）不接受点击，那时深度拾取读到的还是旧画面
  placed: boolean;
}

// 监听回调按事件的种类收窄
const isKey = (event: Event): event is KeyboardEvent => event instanceof KeyboardEvent;
const isPointer = (event: Event): event is PointerEvent => event instanceof PointerEvent;
const isWheel = (event: Event): event is WheelEvent => event instanceof WheelEvent;
const any = (_event: Event): _event is Event => true;

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

// 在容器上按捕获阶段拦下，不让它们传到画布：Cesium 的相机控制即使关掉了也照样记录拖动和滚轮，
// 交还相机的那一刻会当惯性补放出来（旧项目实测拖一下退出后相机漂 4.8 米），场景转给工具的鼠标事件也一并挡掉
function swallow(event: Event): void {
  event.stopPropagation();
  if (event.cancelable) {
    event.preventDefault();
  }
}

/**
 * 第一人称步行的相机与键鼠（ADR 0086 第 3、4 节）：选出生点、飞进站内，之后每帧按 Walker 设相机。
 * W/A/S/D、方向键行走转向；左键点地面移动（落点光环、寻路、穿闸机或闪切），右键拖动转向，滚轮改视场角；
 * 结束时还原视场角和相机控制，可以飞回开始前的位置
 */
export class SceneWalk implements Disposable {
  readonly #widget: CesiumWidget;
  readonly #events: SceneWalkEvents;
  readonly #stack = new DisposableStack();
  #saved: RoamSaved | null = null;
  #walking: Walking | null = null;
  // 行走期间的监听、光环和黑幕，结束时一起撤掉
  #input: DisposableStack | null = null;
  #marker: WalkMarker | null = null;
  #overlay: HTMLDivElement | null = null;
  #speed = 1;
  readonly #keys = new Set<string>();
  #fovy = WALK_FOVY;
  #zoomFovy = WALK_FOVY;
  #last: number | null = null;
  // 上次设给相机的位置和朝向；相机每变一次 revision 加 1，悬停光标据此判断要不要重新判断
  #applied: readonly number[] | null = null;
  #revision = 0;
  #press: Press | null = null;
  #look: Look | null = null;
  #hover: Hover | null = null;
  #hoverAt = 0;
  #hoverTimer: ReturnType<typeof setTimeout> | undefined;
  #blink: Blink | null = null;
  #rendering = true;
  // 完整地图打开时暂停：不响应键鼠（ADR 0087）
  #paused = false;
  // 上次报告的人
  #reported: WalkPlayer | null = null;

  constructor(widget: CesiumWidget, events: SceneWalkEvents) {
    this.#widget = widget;
    this.#events = events;
    this.#stack.defer(widget.scene.preRender.addEventListener(() => this.#tick()));
    this.#stack.defer(() => this.#teardown());
  }

  /** 接管着相机：在步行，或者步行开始时附近找不到能站的地方 */
  get active(): boolean {
    return this.#saved !== null;
  }

  /**
   * 开始步行：接管相机（inherited 是路线换手过来时它记下的），选出生点，飞到出生点的视点高度；
   * 之前的步行一并结束。找不到出生点时报告 failed，相机停在原处，等结束时还原
   */
  start({ navigation, spawn, speed }: SceneWalkStart, inherited: RoamSaved | null = null): void {
    this.#teardown();
    this.#saved = takeOverCamera(this.#widget, this.#saved ?? inherited);
    this.#speed = speed;
    const { grid, frame } = navigation;
    const toWorld = Matrix4.fromArray(Array.from(frame.toWorld));
    const toLocal = Matrix4.inverseTransformation(toWorld, new Matrix4());
    const preferred = spawn
      ? { point: frame.toLocal(spawn.lng, spawn.lat, spawn.height), yaw: headingToYaw(spawn.heading, frame.north) }
      : null;
    const pose = chooseSpawn(grid, this.#spawnContext(toLocal, frame.north, frame.ground, preferred));
    if (!pose) {
      this.#events.phase('failed');
      return;
    }
    const walker = new Walker(grid, pose);
    walker.look(pose.yaw, START_PITCH);
    const walking: Walking = { walker, toWorld, toLocal, spawn: pose, phase: 'entering' };
    this.#walking = walking;
    this.#fovy = WALK_FOVY;
    this.#zoomFovy = WALK_FOVY;
    this.#events.setFovy(WALK_FOVY);
    this.#events.phase('entering');
    const land = () => {
      if (this.#walking === walking && walking.phase === 'entering') {
        this.#beginWalking(walking);
      }
    };
    const { position, direction, up } = this.#pose(walking);
    this.#widget.camera.flyTo({
      destination: position,
      orientation: { direction, up },
      duration: ENTER_FLIGHT,
      easingFunction: EasingFunction.QUADRATIC_IN_OUT,
      complete: land,
      cancel: land
    });
  }

  setSpeed(speed: number): void {
    this.#speed = speed;
  }

  /** 回到这次的出生点（闪切过去，看不到中间穿过的墙） */
  respawn(): void {
    const walking = this.#walking;
    if (walking?.phase === 'walking') {
      const { walker, spawn } = walking;
      this.#blinkTo(() => {
        walker.placeAt(spawn);
        walker.look(spawn.yaw, START_PITCH);
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
      this.#keys.clear();
      this.#press = null;
      this.#look = null;
      this.#hover = null;
      this.#setCursor('');
    }
  }

  /** 页面停用时停止渲染：按着的键收不到松开，一并忘掉 */
  setActive(active: boolean): void {
    this.#rendering = active;
    if (!active) {
      this.#keys.clear();
      this.#press = null;
      this.#look = null;
      this.#hover = null;
    }
  }

  /** 结束步行，恢复视场角和相机控制；back 为 true 时飞回开始前的位置 */
  stop(back: boolean): void {
    const saved = this.handOff();
    if (saved) {
      this.#events.setFovy(null);
      releaseCamera(this.#widget, saved, back);
    }
  }

  /** 交给路线漫游：停下步行，不还原相机，给出开始步行前记下的相机；没在接管时为 null */
  handOff(): RoamSaved | null {
    this.#teardown();
    const saved = this.#saved;
    this.#saved = null;
    return saved;
  }

  [Symbol.dispose](): void {
    this.#stack.dispose();
  }

  #spawnContext(
    toLocal: Matrix4,
    north: number,
    groundHeight: number,
    preferred: SpawnContext['preferred']
  ): SpawnContext {
    const { camera, canvas } = this.#widget;
    const center = new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
    const ground = camera.pickEllipsoid(center, Ellipsoid.WGS84);
    return {
      eye: localPoint(toLocal, camera.positionWC),
      eyeHeight: camera.positionCartographic.height,
      ground: ground ? localPoint(toLocal, ground) : null,
      yaw: headingToYaw(CesiumMath.toDegrees(camera.heading), north),
      preferred,
      groundHeight
    };
  }

  #beginWalking(walking: Walking): void {
    walking.phase = 'walking';
    this.#applied = null;
    this.#last = null;
    this.#marker = new WalkMarker(this.#widget.scene);
    this.#attachInput();
    this.#events.phase('walking');
    this.#widget.scene.requestRender();
  }

  // 视点和朝向在局部系里算，换到地心坐标：方向和上方向都按局部系的轴转过去，局部系不朝北时也对
  #pose({ walker, toWorld }: Walking): { position: Cartesian3; direction: Cartesian3; up: Cartesian3 } {
    const { x, y } = walker.position;
    const { yaw, pitch } = walker;
    const [sy, cy, sp, cp] = [Math.sin(yaw), Math.cos(yaw), Math.sin(pitch), Math.cos(pitch)];
    const axis = (vx: number, vy: number, vz: number) =>
      Cartesian3.normalize(
        Matrix4.multiplyByPointAsVector(toWorld, new Cartesian3(vx, vy, vz), new Cartesian3()),
        new Cartesian3()
      );
    return {
      position: Matrix4.multiplyByPoint(toWorld, new Cartesian3(x, y, walker.eye), new Cartesian3()),
      direction: axis(sy * cp, cy * cp, sp),
      up: axis(-sy * sp, -cy * sp, cp)
    };
  }

  #tick(): void {
    const walking = this.#walking;
    if (walking?.phase !== 'walking') {
      return;
    }
    keepInputsOff(this.#widget);
    const now = performance.now();
    const dt = this.#last === null ? 0 : Math.min((now - this.#last) / 1000, MAX_FRAME);
    this.#last = now;
    const { walker } = walking;
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
      this.#marker?.hide();
    }
    const settling = walker.settleEye(dt);
    const zooming = this.#easeFov(dt);
    // 要在本帧挪相机之前：深度拾取读的是上一帧的深度，得配上一帧的相机
    this.#updateHover(now);
    this.#applyCamera(walking);
    this.#reportPlayer(walking);
    const marked = this.#marker?.update(now) ?? false;
    if (this.#keys.size > 0 || moving || settling || zooming || marked) {
      this.#widget.scene.requestRender();
    } else {
      // 停下来以后，下一次动起来从 0 开始算时间
      this.#last = null;
    }
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
    this.#events.setFovy(this.#fovy);
    this.#revision++;
    return true;
  }

  // 人的位置、朝向、视场角、落点变了才报告；水平视场角按画布的宽高比由竖直的换算
  #reportPlayer({ walker }: Walking): void {
    const { x, y, floor } = walker.position;
    const destination = walker.destination;
    const { canvas } = this.#widget;
    const aspect = canvas.clientHeight > 0 ? canvas.clientWidth / canvas.clientHeight : 1;
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
    const { walker } = walking;
    const { x, y } = walker.position;
    const state = [x, y, walker.eye, walker.yaw, walker.pitch];
    if (this.#applied?.every((value, index) => Math.abs(value - (state[index] ?? 0)) < 1e-5)) {
      return;
    }
    this.#applied = state;
    this.#revision++;
    const { position, direction, up } = this.#pose(walking);
    this.#widget.camera.setView({ destination: position, orientation: { direction, up } });
  }

  // 行走期间的键盘（窗口上，不用先点画布）和鼠标（容器上、捕获阶段）
  #attachInput(): void {
    const input = new DisposableStack();
    this.#input = input;
    const { container } = this.#widget;
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
    // 中键按下时浏览器的自动滚动、双击、右键菜单
    for (const type of ['mousedown', 'dblclick', 'contextmenu']) {
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
    this.#widget.scene.requestRender();
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
      this.#widget.container.setPointerCapture(event.pointerId);
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
    this.#widget.scene.requestRender();
  }

  // 鼠标各键共用一个 pointerId：按住一个键再按另一个不会有新的 pointerdown，松开要等所有键都松开，各种状态一起结束
  #onPointerUp(event: PointerEvent): void {
    swallow(event);
    const look = this.#look;
    if (look && event.pointerId === look.id) {
      this.#widget.container.releasePointerCapture(event.pointerId);
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
    if (event.target === this.#widget.canvas && !this.#look) {
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

  #zoomBy(pixels: number): void {
    this.#zoomFovy = CesiumMath.clamp(this.#zoomFovy * Math.exp(pixels * ZOOM_SENSITIVITY), MIN_FOVY, MAX_FOVY);
    this.#widget.scene.requestRender();
  }

  #canvasPoint(event: MouseEvent): Cartesian2 {
    const box = this.#widget.canvas.getBoundingClientRect();
    return new Cartesian2(event.clientX - box.left, event.clientY - box.top);
  }

  // 点击处的地面以深度拾取的点为准：它就是用户看到并点中的表面；深度只记录不透明物体，隔着玻璃点到的是后面的地面
  #resolve(position: Cartesian2): ClickResolution {
    const walking = this.#walking;
    if (walking?.phase !== 'walking') {
      return { kind: 'refuse', reason: 'not-standable' };
    }
    const { scene } = this.#widget;
    const world = scene.pickPositionSupported ? scene.pickPosition(position) : undefined;
    return resolveClick(walking.walker, world ? localPoint(walking.toLocal, world) : null, this.#visible);
  }

  // 从当前视点看过去，局部系里的 point 前面有没有不透明的东西挡着：投影到屏幕上读那个像素的深度；不在画面里算挡着
  readonly #visible: VisibilityTest = (point: Point3, tolerance: number) => {
    const walking = this.#walking;
    if (!walking) {
      return false;
    }
    const { scene, camera, canvas } = this.#widget;
    const world = Matrix4.multiplyByPoint(walking.toWorld, new Cartesian3(...point), new Cartesian3());
    const screen = SceneTransforms.worldToWindowCoordinates(scene, world);
    if (!screen || screen.x < 0 || screen.y < 0 || screen.x > canvas.clientWidth || screen.y > canvas.clientHeight) {
      return false;
    }
    const hit = scene.pickPositionSupported ? scene.pickPosition(screen) : undefined;
    if (!hit) {
      return true;
    }
    return (
      Cartesian3.distance(camera.positionWC, hit) >= Cartesian3.distance(camera.positionWC, world) - tolerance
    );
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
    this.#marker?.show(
      Matrix4.multiplyByTranslation(toWorld, new Cartesian3(target.x, target.y, target.floor), new Matrix4())
    );
    const plan = planMove(walker, target, reachable, this.#visible);
    if (plan.kind === 'teleport') {
      this.#blinkTo(() => walker.placeAt(plan.spot));
    } else {
      // 正在变黑、还没挪过去的闪切作废：以最后一次点击为准
      this.#cancelBlink();
      walker.startRoute(plan.points, plan.kind === 'through');
    }
    this.#widget.scene.requestRender();
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
    this.#widget.canvas.style.cursor = cursor;
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
    const overlay = this.#ensureOverlay();
    this.#walking?.walker.cancelRoute();
    overlay.style.transition = `opacity ${BLINK_OUT}ms ease-in`;
    overlay.style.opacity = '1';
    const blink: Blink = { action, placed: false, timer: setTimeout(() => this.#placeBlink(blink), BLINK_OUT) };
    this.#blink = blink;
  }

  // 挪过去以后新画面画出一帧就恢复响应，不用等画面完全亮起来
  #placeBlink(blink: Blink): void {
    const walking = this.#walking;
    if (this.#blink !== blink || !walking) {
      return;
    }
    blink.placed = true;
    blink.action();
    this.#applied = null;
    this.#applyCamera(walking);
    const overlay = this.#ensureOverlay();
    overlay.style.transition = `opacity ${BLINK_IN}ms ease-out`;
    overlay.style.opacity = '0';
    const { scene } = this.#widget;
    const remove = scene.postRender.addEventListener(() => {
      remove();
      if (this.#blink === blink) {
        this.#blink = null;
      }
    });
    scene.requestRender();
  }

  #cancelBlink(): void {
    const blink = this.#blink;
    if (!blink || blink.placed) {
      return;
    }
    clearTimeout(blink.timer);
    this.#blink = null;
    const overlay = this.#ensureOverlay();
    overlay.style.transition = `opacity ${BLINK_IN}ms ease-out`;
    overlay.style.opacity = '0';
  }

  #ensureOverlay(): HTMLDivElement {
    if (!this.#overlay) {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;z-index:1';
      this.#widget.container.append(overlay);
      this.#overlay = overlay;
    }
    return this.#overlay;
  }

  // 撤掉这次步行的监听、光环、黑幕和按键，相机不动
  #teardown(): void {
    this.#input?.dispose();
    this.#input = null;
    if (this.#blink) {
      clearTimeout(this.#blink.timer);
      this.#blink = null;
    }
    clearTimeout(this.#hoverTimer);
    this.#hoverTimer = undefined;
    this.#overlay?.remove();
    this.#overlay = null;
    this.#marker?.[Symbol.dispose]();
    this.#marker = null;
    this.#walking = null;
    this.#reported = null;
    this.#paused = false;
    this.#keys.clear();
    this.#press = null;
    this.#look = null;
    this.#hover = null;
    this.#setCursor('');
  }
}

function localPoint(toLocal: Matrix4, world: Cartesian3): Point3 {
  const { x, y, z } = Matrix4.multiplyByPoint(toLocal, world, new Cartesian3());
  return [x, y, z];
}
