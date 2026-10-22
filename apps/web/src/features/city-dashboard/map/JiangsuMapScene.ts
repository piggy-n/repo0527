import type { MapRegion, MapValues, SceneCallbacks, SweepUniforms } from './types';
import type { RegionMaterials } from './map-materials';
import {
  AmbientLight,
  BufferGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  LineBasicMaterial,
  Line,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  ShapeGeometry,
  Material,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three';
import { gsap } from 'gsap';
import { polygonHull } from 'd3-polygon';
import { createRegionMaterials, MAP_DEPTH, updateRegionMaterials } from './map-materials';
import { createBoundaryGlow } from './boundary-glow';
import { MAP_ENTRANCE } from './config';
import { playVisibleTimeline } from '../animation/timeline-clock';

// Three.js 生命周期只存在于独立地图容器中
interface RegionObject {
  group: Group;
  mesh: Mesh;
  base: Mesh<ShapeGeometry, MeshBasicMaterial>;
  materials: RegionMaterials;
  lines: Line<BufferGeometry, LineBasicMaterial>[];
  glows: NonNullable<ReturnType<typeof createBoundaryGlow>>[];
}

/** 场景拥有引擎、动画、监听和纹理；外部只传快照及窄回调 */
export class JiangsuMapScene implements Disposable {
  private readonly resources = new DisposableStack();
  private readonly container: HTMLElement;
  private readonly regions: readonly MapRegion[];
  private readonly callbacks: SceneCallbacks;
  private disposed = false;
  private dirty = true;
  private interactive = false;
  private readonly objects = new Map<string, RegionObject>();
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly view = { yaw: -0.42, pitch: 0.86, distance: 1.18 };
  private readonly sweepUniforms: SweepUniforms = { uSweepPosition: { value: -200 }, uSweepStrength: { value: 0 } };
  private readonly outlineProgress = { value: 0 };
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(38, 1, 0.1, 2000);
  private readonly renderer: WebGLRenderer;
  private readonly mapGroup = new Group();
  private cameraFitPoints: Vector3[] = [];
  private width = 0;
  private height = 0;
  private frame: number | undefined;
  private timeline?: gsap.core.Timeline;
  private entranceClock?: Disposable;
  private ambientTimeline?: gsap.core.Timeline;
  private resolveEntrance: (() => void) | null = null;
  private reducedMotion = false;
  private ambientTimer: ReturnType<typeof setTimeout> | undefined;
  private cameraKey = '';
  private labelKey = '';
  private hoverCode: string | null = null;
  private suppressClickUntil = 0;
  private drag: { id: number; x: number; y: number; yaw: number; pitch: number; moved: boolean } | null = null;

  constructor(container: HTMLElement, regions: readonly MapRegion[], callbacks: SceneCallbacks) {
    this.container = container;
    this.regions = regions;
    this.callbacks = callbacks;
    // 各城市共用一条扫光，不增加覆盖地图的矩形图层
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.resources.defer(() => {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer.domElement.remove();
    });
    this.resources.defer(() => this.releaseObjects());
    try {
      this.initializeScene();
      this.buildRegions();
      this.prepareCameraFitPoints();
      this.mapGroup.scale.z = 0.02;
      this.resize();
      this.bindEvents();
      this.invalidate();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  /** 创建场景灯光与地图根节点，城市几何由独立步骤装配 */
  private initializeScene(): void {
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.container.appendChild(this.renderer.domElement);
    this.scene.add(new AmbientLight('#E6F5FF', 1.7));
    const sunlight = new DirectionalLight('#FFFFFF', 2.0);
    sunlight.position.set(-80, 200, 140);
    this.scene.add(sunlight);
    const rimLight = new DirectionalLight('#55E0FF', 0.7);
    rimLight.position.set(180, 80, -120);
    this.scene.add(rimLight);
    this.mapGroup.rotation.x = -Math.PI / 2;
    this.scene.add(this.mapGroup);
  }

  /** 取完整省域凸包的顶底面顶点，供相机拟合使用 */
  private prepareCameraFitPoints(): void {
    this.mapGroup.updateMatrixWorld();
    // 用真实轮廓的凸包拟合镜头，避免空白包围盒四角挤小斜向省域
    const shapes = this.regions.flatMap(region => region.shapes);
    const boundaryPoints = shapes.flatMap(shape => shape.getPoints().map(point => [point.x, point.y] as [number, number]));
    const hull = polygonHull(boundaryPoints) || boundaryPoints;
    this.cameraFitPoints = hull.flatMap(([x, y]) => [0, MAP_DEPTH].map(z => {
      return new Vector3(x, y, z).applyMatrix4(this.mapGroup.matrixWorld);
    }));
  }

  /** 监听登记与移除成对维护，统一交给资源栈释放 */
  private bindEvents(): void {
    const { container } = this;
    const observer = new ResizeObserver(() => this.resize());
    observer.observe(container);
    this.resources.defer(() => observer.disconnect());
    const handlePointer = (event: PointerEvent) => this.movePointer(event);
    const handlePointerDown = (event: PointerEvent) => this.beginDrag(event);
    const handlePointerUp = (event: PointerEvent) => this.endDrag(event);
    const handleLeave = () => {
      if (!this.drag) {
        this.hoverRegion(null);
      }
    };
    const handleClick = (event: MouseEvent) => {
      // 拖拽结束产生的合成 click 不得切换城市
      if (performance.now() < this.suppressClickUntil) {
        return;
      }
      const code = this.pickRegion(event, false);
      if (code && this.interactive) {
        this.callbacks.onCityClick(code);
      }
    };
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      this.callbacks.onFailure(new Error('地图图形上下文不可用'));
    };
    const handleVisibility = () => this.updateVisibility();
    container.addEventListener('pointermove', handlePointer);
    this.resources.defer(() => container.removeEventListener('pointermove', handlePointer));
    container.addEventListener('pointerdown', handlePointerDown);
    this.resources.defer(() => container.removeEventListener('pointerdown', handlePointerDown));
    container.addEventListener('pointerup', handlePointerUp);
    this.resources.defer(() => container.removeEventListener('pointerup', handlePointerUp));
    container.addEventListener('pointercancel', handlePointerUp);
    this.resources.defer(() => container.removeEventListener('pointercancel', handlePointerUp));
    container.addEventListener('lostpointercapture', handlePointerUp);
    this.resources.defer(() => container.removeEventListener('lostpointercapture', handlePointerUp));
    container.addEventListener('pointerleave', handleLeave);
    this.resources.defer(() => container.removeEventListener('pointerleave', handleLeave));
    container.addEventListener('click', handleClick);
    this.resources.defer(() => container.removeEventListener('click', handleClick));
    this.renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    this.resources.defer(() => this.renderer.domElement.removeEventListener('webglcontextlost', handleContextLost));
    document.addEventListener('visibilitychange', handleVisibility);
    this.resources.defer(() => document.removeEventListener('visibilitychange', handleVisibility));
  }

  /** 页面隐藏时暂停独立动画与渲染，恢复时重新量取容器 */
  private updateVisibility(): void {
    if (this.frame !== undefined) {
      cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
    this.ambientTimeline?.paused(document.hidden);
    clearTimeout(this.ambientTimer);
    if (document.hidden) {
      this.finishDrag();
    }
    const targets = [
      this.view,
      ...[...this.objects.values()].flatMap(object =>
        [object.materials.top.color, object.group.position, object.materials.hover])
    ];
    // 时间线统一暂停其子动画；重复暂停子项会改变恢复后的相对起点
    gsap.getTweensOf(targets).forEach(tween => {
      if (tween.parent === gsap.globalTimeline) {
        tween.paused(document.hidden);
      }
    });
    if (!document.hidden && !this.disposed) {
      this.resize();
      this.invalidate();
      if (!this.reducedMotion && this.interactive && !this.ambientTimeline?.isActive()) {
        this.scheduleAmbientSweep();
      }
    }
  }

  private buildRegions(): void {
    this.regions.forEach(region => {
      const group = new Group();
      this.mapGroup.add(group);
      const geometry = new ExtrudeGeometry(
        region.shapes,
        { depth: MAP_DEPTH, steps: 1, bevelEnabled: false, curveSegments: 1 }
      );
      const materials = createRegionMaterials(null, this.sweepUniforms, true);
      const mesh = new Mesh(geometry, [materials.top, materials.side]);
      mesh.userData.cityCode = region.code;
      group.add(mesh);
      const base = new Mesh(
        new ShapeGeometry(region.shapes),
        new MeshBasicMaterial({ color: '#146ADE', transparent: true, opacity: 0, depthWrite: false })
      );
      base.position.set(0.6, -0.6, -2);
      base.scale.set(1.008, 1.008, 1);
      group.add(base);
      const lines: RegionObject['lines'] = [];
      const glows: RegionObject['glows'] = [];
      region.shapes.forEach(shape => {
        // 每个边界环独立闭合，保留孔洞和离散小面
        [shape, ...shape.holes].forEach(ring => {
          const points = ring.getPoints().map(point => new Vector3(point.x, point.y, MAP_DEPTH + 0.15));
          // 使用连续折线描边，部分绘制时不把终点强行接回起点
          const outline = new BufferGeometry().setFromPoints([...points, points[0]]);
          outline.setDrawRange(0, 0);
          const line = new Line(
            outline,
            new LineBasicMaterial({ color: MAP_ENTRANCE.boundaryColor, transparent: true, opacity: 0 })
          );
          line.renderOrder = 2;
          group.add(line);
          lines.push(line);
        });
      });
      const glow = createBoundaryGlow(region.shapes, materials, this.outlineProgress);
      if (glow) {
        group.add(glow);
        glows.push(glow);
      }
      this.objects.set(region.code, { group, mesh, base, materials, lines, glows });
    });
  }

  // 相机按容器宽高比拟合完整地图，非标准分辨率不会横向拉伸
  private updateCamera(): void {
    const key = `${this.width}:${this.height}:${this.view.yaw}:${this.view.pitch}:${this.view.distance}`;
    if (key === this.cameraKey) {
      return;
    }
    this.cameraKey = key;
    this.camera.clearViewOffset();
    const direction = new Vector3(
      Math.sin(this.view.yaw) * Math.cos(this.view.pitch),
      Math.sin(this.view.pitch),
      Math.cos(this.view.yaw) * Math.cos(this.view.pitch)
    );
    const right = new Vector3().crossVectors(new Vector3(0, 1, 0), direction).normalize();
    const up = new Vector3().crossVectors(direction, right).normalize();
    const tangent = Math.tan(this.camera.fov * Math.PI / 360);
    let distance = 0;
    this.cameraFitPoints.forEach(point => {
      const depth = point.dot(direction);
      distance = Math.max(
        distance,
        depth + Math.abs(point.dot(up)) / tangent,
        depth + Math.abs(point.dot(right)) / (tangent * this.camera.aspect)
      );
    });
    distance *= 1.055 * this.view.distance;
    let projected: Vector3[] = [];
    // 根据投影跨度继续收紧镜头，去掉不规则省域相对原点产生的空白
    for (let pass = 0; pass < 4; pass += 1) {
      this.camera.position.copy(direction.clone().multiplyScalar(distance));
      this.camera.lookAt(0, 0, 0);
      this.camera.updateMatrixWorld();
      projected = this.cameraFitPoints.map(point => point.clone().project(this.camera));
      const spanX = Math.max(...projected.map(point => point.x)) - Math.min(...projected.map(point => point.x));
      const spanY = Math.max(...projected.map(point => point.y)) - Math.min(...projected.map(point => point.y));
      distance *= Math.max(spanX, spanY) / (1.87 / this.view.distance);
    }
    // 屏幕投影中心对齐容器中轴，修正透视导致的省域视觉偏右
    const centerX = (
      Math.min(...projected.map(point => point.x)) + Math.max(...projected.map(point => point.x))
    ) / 2;
    const centerY = (
      Math.min(...projected.map(point => point.y)) + Math.max(...projected.map(point => point.y))
    ) / 2;
    this.camera.setViewOffset(
      this.width,
      this.height,
      centerX * this.width / 2,
      -centerY * this.height / 2,
      this.width,
      this.height
    );
  }

  resize(): void {
    if (this.disposed) {
      return;
    }
    const { width, height } = this.container.getBoundingClientRect();
    if (!width || !height) {
      return;
    }
    this.width = width;
    this.height = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.invalidate();
  }

  updateValues(values: MapValues, duration = 0) {
    this.objects.forEach((object, code) => {
      updateRegionMaterials(object.materials, values[code], duration, () => {
        this.invalidate();
      });
      const selected = Number.isFinite(values[code]);
      object.base.material.color.set(selected ? '#146ADE' : '#C8D4E0');
      object.lines.forEach(line => line.material.color.set(selected ? '#73E3FF' : '#BCCBD8'));
    });
    this.invalidate();
  }

  // 地图时间线完成后再允许面板入场，卸载时也能结束等待
  playEntrance(reducedMotion = false): Promise<void> {
    this.reducedMotion = reducedMotion;
    this.entranceClock?.[Symbol.dispose]();
    this.timeline?.kill();
    this.resolveEntrance?.();
    return new Promise<void>(resolve => {
      this.resolveEntrance = resolve;
      const duration = reducedMotion ? 0 : 1;
      this.timeline = gsap.timeline({
        paused: true,
        onUpdate: () => {
          this.objects.forEach(object => object.lines.forEach(line => {
            line.geometry.setDrawRange(
              0,
              Math.ceil(line.geometry.attributes.position.count * this.outlineProgress.value)
            );
          }));
          this.invalidate();
        },
        onComplete: () => {
          this.interactive = true;
          if (!this.reducedMotion) {
            this.scheduleAmbientSweep();
          }
          this.resolveEntrance = null;
          resolve();
        }
      });
      // 顶面及轮廓先出现，让镜头推进有参照物，再建立地图厚度
      const timeline = this.timeline;
      this.timeline.to(
        this.view,
        { yaw: 0.05, pitch: 0.76, distance: 1, duration: 2.15 * duration, ease: 'power2.inOut' },
        0
      );
      this.timeline.to(
        this.outlineProgress,
        { value: 1, duration: 1.1 * duration, ease: 'power1.inOut' },
        0.05 * duration
      );
      this.timeline.to(this.mapGroup.scale, { z: 1, duration: 1.15 * duration, ease: 'power3.out' }, 0.85 * duration);
      this.objects.forEach(object => {
        timeline.to(
          object.materials.top,
          { opacity: 1, duration: 0.65 * duration, ease: 'power2.out' },
          0.12 * duration
        );
        timeline.to(object.materials.side.uniforms.uOpacity, { value: 1, duration: 0.9 * duration }, 0.85 * duration);
        timeline.to(object.base.material, { opacity: 0.3, duration: 0.9 * duration }, 0.85 * duration);
        object.lines.forEach(line => {
          timeline.to(line.material, { opacity: 0.95, duration: 0.4 * duration }, 0.05 * duration);
        });
        object.glows.forEach(glow => {
          timeline.to(glow.material.uniforms.uOpacity, { value: 0.32, duration: 0.75 * duration }, 0.2 * duration);
        });
      });
      this.timeline.to(
        this.sweepUniforms.uSweepStrength,
        { value: reducedMotion ? 0 : 0.3, duration: 0.2 * duration },
        1.05 * duration
      );
      this.timeline.to(
        this.sweepUniforms.uSweepPosition,
        { value: 200, duration: 1.5 * duration, ease: 'power1.inOut' },
        1.05 * duration
      );
      this.timeline.to(this.sweepUniforms.uSweepStrength, { value: 0, duration: 0.38 * duration }, 2.25 * duration);
      this.entranceClock = playVisibleTimeline(this.timeline);
    });
  }

  /** 动画偏好在入场中变化时也立即生效，不留下半透明或半展开终态 */
  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
    if (value) {
      clearTimeout(this.ambientTimer);
      this.ambientTimeline?.kill();
      this.ambientTimeline = undefined;
      this.entranceClock?.[Symbol.dispose]();
      this.timeline?.totalProgress(1);
      this.sweepUniforms.uSweepStrength.value = 0;
      this.invalidate();
    } else if (this.interactive) {
      this.scheduleAmbientSweep();
    }
  }

  // 用一次性定时器等待下一次扫光，间隔内不让重复时间线持续唤醒 RAF
  private scheduleAmbientSweep(delay = 7000): void {
    clearTimeout(this.ambientTimer);
    if (this.disposed || this.reducedMotion || document.hidden) {
      return;
    }
    this.ambientTimer = setTimeout(() => this.startAmbientSweep(), delay);
  }

  private startAmbientSweep(): void {
    this.ambientTimeline?.kill();
    this.ambientTimeline = gsap.timeline({
      paused: document.hidden,
      onComplete: () => {
        this.scheduleAmbientSweep(10000);
      }
    });
    this.ambientTimeline.set(this.sweepUniforms.uSweepPosition, { value: -200 }, 0);
    this.ambientTimeline.to(this.sweepUniforms.uSweepStrength, { value: 0.16, duration: 0.5 }, 0);
    this.ambientTimeline.to(
      this.sweepUniforms.uSweepPosition,
      {
        value: 200,
        duration: 3.4,
        ease: 'sine.inOut',
        onUpdate: () => {
          this.invalidate();
        }
      },
      0
    );
    this.ambientTimeline.to(this.sweepUniforms.uSweepStrength, { value: 0, duration: 0.6 }, 2.8);
  }

  private pickRegion(event: MouseEvent, hover = true) {
    if (!this.interactive || this.disposed) {
      return null;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      (event.clientX - rect.left) / rect.width * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(Array.from(this.objects.values()).map(object => object.mesh), false)[0];
    const code: string | null = typeof hit?.object.userData.cityCode === 'string' ? hit.object.userData.cityCode : null;
    if (hover) {
      this.hoverRegion(code);
    }
    return code;
  }

  // 轻点保留城市选择，移动超过阈值才进入旋转，镜头由现有拟合逻辑统一控制
  private beginDrag(event: PointerEvent) {
    if (!this.interactive || event.button !== 0 || this.drag) {
      return;
    }
    gsap.killTweensOf(this.view);
    this.drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: this.view.yaw,
      pitch: this.view.pitch,
      moved: false
    };
    this.container.setPointerCapture(event.pointerId);
  }

  private movePointer(event: PointerEvent) {
    if (!this.drag || this.drag.id !== event.pointerId) {
      const code = this.pickRegion(event);
      this.callbacks.onCityPointer(code);
      return;
    }
    const dx = event.clientX - this.drag.x;
    const dy = event.clientY - this.drag.y;
    if (!this.drag.moved && Math.hypot(dx, dy) < 5) {
      return;
    }
    this.drag.moved = true;
    this.hoverRegion(null);
    this.container.style.cursor = 'grabbing';
    // 限制侧向与俯仰范围，保持标签可读且不翻转地图
    gsap.to(this.view, {
      yaw: Math.max(-1.15, Math.min(1.15, this.drag.yaw - dx * 0.004)),
      pitch: Math.max(0.42, Math.min(1.2, this.drag.pitch + dy * 0.003)),
      duration: 0.22,
      ease: 'power2.out',
      overwrite: true,
      onUpdate: () => {
        this.invalidate();
      }
    });
  }

  private endDrag(event: PointerEvent) {
    if (!this.drag || this.drag.id !== event.pointerId) {
      return;
    }
    this.finishDrag();
  }

  private finishDrag(): void {
    if (!this.drag) {
      return;
    }
    const pointerId = this.drag.id;
    if (this.drag.moved) {
      this.suppressClickUntil = performance.now() + 250;
    }
    this.drag = null;
    if (this.container.hasPointerCapture(pointerId)) {
      this.container.releasePointerCapture(pointerId);
    }
    this.container.style.cursor = 'grab';
  }

  hoverRegion(code: string | null) {
    if (!this.interactive || this.disposed || this.hoverCode === code) {
      return;
    }
    const previousCode = this.hoverCode;
    this.hoverCode = code;
    this.callbacks.onHover?.(code);
    this.container.style.cursor = code ? 'pointer' : 'grab';
    [previousCode, code].filter((value): value is string => value !== null).forEach(cityCode => {
      const object = this.objects.get(cityCode);
      if (!object) {
        return;
      }
      const active = cityCode === code;
      const duration = this.reducedMotion || document.hidden ? 0 : 0.35;
      gsap.to(
        object.group.position,
        {
          z: active ? 3.4 : 0,
          duration,
          ease: 'power2.out',
          overwrite: true,
          onUpdate: () => {
            this.invalidate();
          }
        }
      );
      gsap.to(object.materials.hover, {
        value: active ? 1 : 0,
        duration,
        overwrite: true,
        onUpdate: () => {
          this.invalidate();
        }
      });
    });
  }

  private tick(): void {
    this.frame = undefined;
    if (this.disposed || document.hidden) {
      return;
    }
    if (this.dirty && this.width && this.height) {
      this.render();
    }
  }

  // 画面与标签同步更新，导出不依赖下一帧的异步投影
  private render(): void {
    this.updateCamera();
    this.scene.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
    const cityOffsets = [...this.objects.values()].map(object => object.group.position.z).join(':');
    const key = `${this.cameraKey}:${this.mapGroup.scale.z}:${cityOffsets}`;
    this.dirty = false;
    if (key === this.labelKey) {
      return;
    }
    this.labelKey = key;
    const labels = this.regions.map(region => {
      const object = this.objects.get(region.code);
      // 避让只使用无悬浮位移的锚点，Hover 偏移最后单独叠加
      const anchor = new Vector3(region.anchorPoint.x, region.anchorPoint.y, MAP_DEPTH + 0.8);
      const base = anchor.clone().applyMatrix4(this.mapGroup.matrixWorld).project(this.camera);
      const point = anchor.applyMatrix4(object!.group.matrixWorld).project(this.camera);
      return {
        code: region.code,
        name: region.name,
        x: (base.x + 1) / 2 * this.width,
        y: (1 - base.y) / 2 * this.height,
        offsetX: (point.x - base.x) / 2 * this.width,
        offsetY: (base.y - point.y) / 2 * this.height
      };
    });
    this.callbacks.onLabels(labels);
  }

  /** 只在状态变化和动画更新时调度一帧，空闲不持续 RAF */
  private invalidate(): void {
    this.dirty = true;
    if (!this.disposed && !document.hidden && this.frame === undefined) {
      this.frame = requestAnimationFrame(() => this.tick());
    }
  }

  /** 截图在同步阶段冻结像素，后续字体等待不会改用新场景 */
  capture(): HTMLCanvasElement {
    if (this.disposed || !this.width || !this.height) {
      throw new Error('地图尚未就绪');
    }
    this.resize();
    this.render();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(this.width * 2);
    canvas.height = Math.round(this.height * 2);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('无法创建地图导出画布');
    }
    context.drawImage(this.renderer.domElement, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  private releaseObjects(): void {
    this.objects.forEach(object => {
      gsap.killTweensOf([object.group.position, object.materials.hover, object.materials.top.color]);
      object.glows.forEach(glow => glow.boundaryMask.dispose());
    });
    this.scene.traverse(object => {
      if (object instanceof Mesh || object instanceof Line) {
        if (object.geometry instanceof BufferGeometry) {
          object.geometry.dispose();
        }
        const materials: unknown[] = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => {
          if (material instanceof Material) {
            material.dispose();
          }
        });
      }
    });
    this.objects.clear();
    this.scene.clear();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.frame !== undefined) {
      cancelAnimationFrame(this.frame);
    }
    this.timeline?.kill();
    this.entranceClock?.[Symbol.dispose]();
    this.ambientTimeline?.kill();
    clearTimeout(this.ambientTimer);
    this.resolveEntrance?.();
    gsap.killTweensOf(this.view);
    if (this.drag && this.container.hasPointerCapture(this.drag.id)) {
      this.container.releasePointerCapture(this.drag.id);
    }
    this.drag = null;
    this.resources.dispose();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}
