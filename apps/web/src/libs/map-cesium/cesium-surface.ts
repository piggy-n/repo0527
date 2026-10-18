import {
  CesiumWidget,
  EllipsoidTerrainProvider,
  GeographicTilingScheme,
  UrlTemplateImageryProvider
} from 'cesium';
import { safeReporter } from '@yzt/utils';
import type {
  CameraModel, CameraState, FitBoundsOptions, FlyToOptions, LngLat, PickResult, ScreenPoint,
  SourceErrors, StyleModel, ToolModel, ViewBounds
} from '@yzt/map-core';
import { CesiumCameraBridge } from './camera-bridge';
import { type CesiumCameraPose, createCesiumCameraPort, resizeCameraFrustum } from './camera-geometry';
import { planCesiumFitBounds, planCesiumFlyTo } from './camera-plan';
import { CesiumInput } from './cesium-input';
import { pickScene, projectScene } from './scene-query';
import { createImageryStylePort, type ImageryStylePort } from './imagery-style-port';
import { StyleMirror } from './style-mirror';

/** 最小三维画布的依赖；资源地址由应用提供，不读取部署环境 */
export interface CesiumSurfaceOptions {
  container: HTMLElement;
  assetBaseUrl: string;
  /** 会话相机；不传时保留 3D.1 的独立场景用途 */
  camera?: CameraModel;
  /** 会话样式；独立运行时验证不传，仍使用 SDK 本地底图 */
  style?: StyleModel<string>;
  tool?: ToolModel;
  active?: boolean;
  onReady?: () => void;
  onError?: (error: unknown) => void;
  onStyleError?: (error: unknown) => void;
  onSourceErrors?: (errors: SourceErrors) => void;
  onResize?: () => void;
  onSettle?: () => void;
}

/** 三维渲染与交互的拥有者，统一视图生命周期由 CesiumView 装配 */
export class CesiumSurface implements Disposable {
  // 独占子容器，初始化失败时也能清理 SDK 留下的 DOM
  readonly #host = document.createElement('div');
  readonly #resources = new DisposableStack();
  readonly #report: (error: unknown) => void;
  #widget: CesiumWidget | undefined;
  #camera: CesiumCameraBridge<CesiumCameraPose> | undefined;
  readonly #model: CameraModel | undefined;
  #input: CesiumInput | undefined;
  #style: StyleMirror | undefined;
  #imagery: ImageryStylePort | undefined;
  // 判断 postRender 中的样式更新是否已经出现在这一帧
  #styleRevision = 0;
  // 首轮可见瓦片完成前允许预备渲染，但不交付工具输入
  #loaded = false;
  #flight: { pose: CesiumCameraPose; cleanup: () => void } | undefined;
  #active = false;
  #failed = false;

  constructor(options: CesiumSurfaceOptions) {
    this.#model = options.camera;
    this.#report = safeReporter(options.onError ?? console.error, 'CesiumSurface');
    const resized = safeReporter(() => options.onResize?.(), 'CesiumSurface.onResize');
    const settled = safeReporter(() => options.onSettle?.(), 'CesiumSurface.onSettle');
    this.#host.style.width = '100%';
    this.#host.style.height = '100%';
    options.container.append(this.#host);
    this.#resources.defer(() => this.#host.remove());

    try {
      const widget = new CesiumWidget(this.#host, {
        baseLayer: false,
        terrainProvider: new EllipsoidTerrainProvider(),
        skyBox: false,
        skyAtmosphere: false,
        scene3DOnly: true,
        shouldAnimate: false,
        useDefaultRenderLoop: false,
        showRenderLoopErrors: false,
        requestRenderMode: true,
        maximumRenderTimeChange: Number.POSITIVE_INFINITY
      });
      this.#widget = widget;
      this.#resources.defer(() => widget.destroy());

      resizeCameraFrustum(widget);
      const port = createCesiumCameraPort(widget);
      if (options.camera) {
        // 候选视图也有初始视角，但准备期间不改写共享会话
        port.apply(options.camera.current);
        const bridge = new CesiumCameraBridge(options.camera, port, error => this.#fail(error));
        this.#camera = bridge;
        this.#resources.use(bridge);
      }
      if (options.tool) {
        this.#input = this.#resources.use(new CesiumInput({
          canvas: widget.canvas, tool: options.tool, controller: widget.scene.screenSpaceCameraController,
          view: Object.freeze({
            kind: '3d' as const,
            pick: (point: ScreenPoint) => this.pick(point),
            project: (lngLat: LngLat, height?: number) => this.project(lngLat, height),
            queryRendered: () => []
          }),
          beginUserOperation: () => {
            this.#cancelFlight();
            this.#camera?.beginUserOperation();
          },
          onError: error => this.#fail(error)
        }));
      }
      let width = widget.canvas.clientWidth;
      let height = widget.canvas.clientHeight;
      let previousPose = port.capture();
      let renderedStyleRevision = 0;
      let resizedDuringFrame = false;
      this.#resources.defer(widget.scene.preRender.addEventListener(() => {
        renderedStyleRevision = this.#styleRevision;
      }));
      this.#resources.defer(widget.scene.postRender.addEventListener(() => {
        resizedDuringFrame = width !== widget.canvas.clientWidth || height !== widget.canvas.clientHeight;
        if (resizedDuringFrame) {
          width = widget.canvas.clientWidth;
          height = widget.canvas.clientHeight;
          resizeCameraFrustum(widget);
          this.#camera?.viewportChanged();
          resized(undefined);
          widget.scene.requestRender();
        } else {
          this.#camera?.update(this.#flight ? 'program' : 'user');
        }
        this.#input?.afterRender();
        const pose = port.capture();
        if (this.#loaded && this.#active && !this.#flight && !resizedDuringFrame &&
          renderedStyleRevision === this.#styleRevision && widget.scene.globe.tilesLoaded && this.#imagery?.ready !== false &&
          port.equals(previousPose, pose)) {
          settled(undefined);
        }
        previousPose = pose;
      }));

      if (options.style) {
        if (!options.camera) {
          throw new Error('三维样式镜像需要共享相机');
        }
        this.#imagery = this.#resources.use(createImageryStylePort({
          layers: widget.imageryLayers,
          requestRender: () => {
            this.#styleRevision++;
            widget.scene.requestRender();
          }
        }));
        this.#style = this.#resources.use(new StyleMirror({
          style: options.style,
          camera: options.camera,
          port: this.#imagery,
          onError: options.onStyleError,
          onSourceErrors: options.onSourceErrors
        }));
      } else {
        // 独立运行时验证仍使用随 SDK 部署的 Natural Earth II，实际只有 0～2 级
        const imagery = new UrlTemplateImageryProvider({
          url: `${options.assetBaseUrl}Assets/Textures/NaturalEarthII/{z}/{x}/{reverseY}.jpg`,
          tilingScheme: new GeographicTilingScheme(),
          maximumLevel: 2,
          enablePickFeatures: false,
          credit: 'Natural Earth II'
        });
        this.#resources.defer(imagery.errorEvent.addEventListener(() => {
          this.#fail(new Error('本地三维底图加载失败，请检查 Cesium 静态资源是否完整部署'));
        }));
        widget.imageryLayers.addImageryProvider(imagery);
      }
      this.#resources.defer(widget.scene.renderError.addEventListener((_scene: unknown, error: unknown) => {
        this.#fail(error);
      }));

      // 首轮可见瓦片完成且经过一次渲染后才报告就绪
      const ready = safeReporter(() => options.onReady?.(), 'CesiumSurface.onReady');
      const removeReady = widget.scene.postRender.addEventListener(() => {
        if (!this.#failed && !resizedDuringFrame && renderedStyleRevision === this.#styleRevision &&
          widget.scene.globe.tilesLoaded && this.#imagery?.ready !== false) {
          removeReady();
          this.#loaded = true;
          if (this.#active) {
            this.#input?.setActive(true);
            if (!this.#input) {
              widget.scene.screenSpaceCameraController.enableInputs = true;
            }
          } else {
            this.pause();
          }
          ready(undefined);
          widget.scene.requestRender();
        }
      });
      this.#resources.defer(removeReady);
      if (options.active !== false) {
        this.resume();
      } else {
        this.pause();
      }
    } catch (error) {
      this[Symbol.dispose]();
      throw error;
    }
  }

  /** 隐藏时停止渲染循环与相机输入 */
  pause(): void {
    if (!this.#widget || this.#resources.disposed) {
      return;
    }
    // 暂停中的定位动画直接到终点，仍按 program 写回会话
    const destination = this.#flight?.pose;
    this.#cancelFlight();
    if (destination) {
      this.#camera?.move(destination);
    }
    this.#widget.useDefaultRenderLoop = !this.#loaded && !this.#failed;
    this.#input?.setActive(false);
    this.#widget.scene.screenSpaceCameraController.enableInputs = false;
    this.#active = false;
    this.#camera?.pause();
    this.#style?.pause();
    // 候选的首次准备仍需加载影像，交付首帧后才停止后台任务
    if (this.#loaded) { this.#imagery?.pause(); }
  }

  /** 恢复前先按当前容器尺寸调整画布 */
  resume(): void {
    if (!this.#widget || this.#resources.disposed || this.#failed || this.#active) {
      return;
    }
    this.#widget.resize();
    resizeCameraFrustum(this.#widget);
    this.#camera?.resume();
    if (this.#failed) {
      return;
    }
    this.#imagery?.resume();
    this.#style?.resume();
    if (this.#failed || this.#resources.disposed) {
      return;
    }
    this.#active = true;
    this.#input?.setActive(this.#loaded);
    if (!this.#input) {
      this.#widget.scene.screenSpaceCameraController.enableInputs = this.#loaded;
    }
    this.#widget.scene.requestRender();
    this.#widget.useDefaultRenderLoop = true;
  }

  /** 按当前共享尺度规划一次定位，duration 的公共单位是毫秒 */
  flyTo(target: Partial<CameraState>, options: FlyToOptions = {}): void {
    const widget = this.#requireWidget();
    this.#fly(planCesiumFlyTo(widget, this.#currentCamera(), target, options), options.duration);
  }

  fitBounds(bounds: ViewBounds, options: FitBoundsOptions = {}): void {
    const widget = this.#requireWidget();
    this.#fly(planCesiumFitBounds(widget, this.#currentCamera(), bounds, options), options.duration);
  }

  pick(point: ScreenPoint): PickResult { return pickScene(this.#requireWidget().scene, point); }
  project(lngLat: LngLat, height?: number): ScreenPoint | null {
    return projectScene(this.#requireWidget().scene, lngLat, height);
  }

  #requireWidget(): CesiumWidget {
    if (!this.#widget || this.#failed || this.#resources.disposed) {
      throw new Error('Cesium 画布不可用');
    }
    return this.#widget;
  }

  #currentCamera(): CameraState {
    const state = this.#model?.current ?? createCesiumCameraPort(this.#requireWidget()).read();
    if (!state) {
      throw new Error('当前视角没有可用的共享相机');
    }
    return state;
  }

  #fly(pose: CesiumCameraPose, duration = 1000): void {
    if (!Number.isFinite(duration) || duration < 0) {
      throw new RangeError('定位时长必须是非负有限数');
    }
    const widget = this.#requireWidget();
    this.#cancelFlight();
    this.#input?.cancelInteraction();
    if (duration === 0) {
      this.#camera?.move(pose);
      widget.scene.requestRender();
      return;
    }
    const signal = this.#model?.operation;
    const cancel = () => this.#cancelFlight();
    const flight = { pose, cleanup: () => signal?.removeEventListener('abort', cancel) };
    this.#flight = flight;
    signal?.addEventListener('abort', cancel, { once: true });
    widget.camera.flyTo({
      destination: pose.position,
      orientation: { direction: pose.direction, up: pose.up },
      duration: duration / 1000,
      complete: () => {
        if (this.#flight === flight) {
          flight.cleanup();
          this.#flight = undefined;
          this.#camera?.move(pose);
          widget.scene.requestRender();
        }
      },
      cancel: () => {
        if (this.#flight === flight) {
          flight.cleanup();
          this.#flight = undefined;
          this.#camera?.update('program');
        }
      }
    });
    widget.scene.requestRender();
  }

  #cancelFlight(): void {
    const flight = this.#flight;
    if (!flight) {
      return;
    }
    this.#flight = undefined;
    flight.cleanup();
    this.#widget?.camera.cancelFlight();
    this.#camera?.update('program');
  }

  /** 离开 SDK 的事件调用栈后再释放，避免它继续访问已经销毁的场景 */
  #fail(error: unknown): void {
    if (this.#failed || this.#resources.disposed) {
      return;
    }
    this.#failed = true;
    this.#camera?.[Symbol.dispose]();
    this.pause();
    queueMicrotask(() => {
      if (this.#resources.disposed) {
        return;
      }
      this[Symbol.dispose]();
      this.#report(error);
    });
  }

  /** 先解绑事件，再释放 GPU 与 DOM；多次释放没有副作用 */
  [Symbol.dispose](): void {
    if (this.#resources.disposed) {
      return;
    }
    this.#camera?.[Symbol.dispose]();
    this.pause();
    this.#widget = undefined;
    try {
      this.#resources.dispose();
    } catch (error) {
      this.#report(error);
    }
  }
}
