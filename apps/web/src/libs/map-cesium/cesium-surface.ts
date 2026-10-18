import {
  CesiumWidget,
  EllipsoidTerrainProvider,
  GeographicTilingScheme,
  UrlTemplateImageryProvider
} from 'cesium';
import { safeReporter } from '@yzt/utils';
import type { CameraModel } from '@yzt/map-core';
import { CesiumCameraBridge } from './camera-bridge';
import { type CesiumCameraPose, createCesiumCameraPort, resizeCameraFrustum } from './camera-geometry';

/** 最小三维画布的依赖；资源地址由应用提供，不读取部署环境 */
export interface CesiumSurfaceOptions {
  container: HTMLElement;
  assetBaseUrl: string;
  /** 会话相机；不传时保留 3D.1 的独立场景用途 */
  camera?: CameraModel;
  active?: boolean;
  onReady?: () => void;
  onError?: (error: unknown) => void;
}

/** 本地底图画布与会话相机桥接；完整 MapView 和样式镜像留给后续步骤 */
export class CesiumSurface implements Disposable {
  // 独占子容器，初始化失败时也能清理 SDK 留下的 DOM
  readonly #host = document.createElement('div');
  readonly #resources = new DisposableStack();
  readonly #report: (error: unknown) => void;
  #widget: CesiumWidget | undefined;
  #camera: CesiumCameraBridge<CesiumCameraPose> | undefined;
  #active = false;
  #failed = false;

  constructor(options: CesiumSurfaceOptions) {
    this.#report = safeReporter(options.onError ?? console.error, 'CesiumSurface');
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
      if (options.camera) {
        const bridge = new CesiumCameraBridge(options.camera, createCesiumCameraPort(widget), error => this.#fail(error));
        this.#camera = bridge;
        this.#resources.use(bridge);
      }
      // SDK 的 moveStart 不带原因；用户意图从画布输入开始，程序写入由桥接器显式记录
      const beginUserOperation = () => this.#camera?.beginUserOperation();
      widget.canvas.addEventListener('pointerdown', beginUserOperation, { passive: true });
      widget.canvas.addEventListener('wheel', beginUserOperation, { passive: true });
      this.#resources.defer(() => {
        widget.canvas.removeEventListener('pointerdown', beginUserOperation);
        widget.canvas.removeEventListener('wheel', beginUserOperation);
      });
      let width = widget.canvas.clientWidth;
      let height = widget.canvas.clientHeight;
      this.#resources.defer(widget.scene.postRender.addEventListener(() => {
        if (width !== widget.canvas.clientWidth || height !== widget.canvas.clientHeight) {
          width = widget.canvas.clientWidth;
          height = widget.canvas.clientHeight;
          resizeCameraFrustum(widget);
          this.#camera?.viewportChanged();
          widget.scene.requestRender();
        } else {
          this.#camera?.update();
        }
      }));

      // Natural Earth II 随 SDK 部署，实际发布的瓦片只有 0～2 级
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
      this.#resources.defer(widget.scene.renderError.addEventListener((_scene: unknown, error: unknown) => {
        this.#fail(error);
      }));

      // 首轮可见瓦片完成且经过一次渲染后才报告就绪
      const ready = safeReporter(() => options.onReady?.(), 'CesiumSurface.onReady');
      const removeReady = widget.scene.postRender.addEventListener(() => {
        if (!this.#failed && widget.scene.globe.tilesLoaded) {
          removeReady();
          ready(undefined);
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
    this.#widget.useDefaultRenderLoop = false;
    this.#widget.scene.screenSpaceCameraController.enableInputs = false;
    this.#active = false;
    this.#camera?.pause();
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
    this.#active = true;
    this.#widget.scene.screenSpaceCameraController.enableInputs = true;
    this.#widget.scene.requestRender();
    this.#widget.useDefaultRenderLoop = true;
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
