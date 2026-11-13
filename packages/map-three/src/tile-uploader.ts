import {
  type BufferAttribute,
  type BufferGeometry,
  type InterleavedBufferAttribute,
  type Material,
  type Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  type Texture,
  type WebGLRenderer
} from 'three';

// 上传预算（ADR 0147 第 5 节）：新瓦片的贴图和几何体在第一次绘制之前按每帧字节数上传。
// 一组兄弟瓦片要到齐才一起第一次绘制（REPLACE），不提前上传的话会集中在同一帧，见 docs/modules/map-three.md"上传"

interface UploadJob {
  readonly scene: Object3D;
  readonly textures: readonly Texture[];
  readonly geometries: readonly BufferGeometry[];
  // 下一张要传的贴图
  nextTexture: number;
  finish(): void;
}

function collectTextures(material: Material, into: Set<Texture>): void {
  for (const value of Object.values(material)) {
    if ((value as Partial<Texture> | null)?.isTexture === true) {
      into.add(value as Texture);
    }
  }
}

function collect(scene: Object3D): { textures: Texture[]; geometries: BufferGeometry[] } {
  const textures = new Set<Texture>();
  const geometries = new Set<BufferGeometry>();
  scene.traverse(object => {
    const { geometry, material } = object as Partial<Mesh>;
    if (geometry) {
      geometries.add(geometry);
    }
    for (const item of Array.isArray(material) ? material : material ? [material] : []) {
      collectTextures(item, textures);
    }
  });
  return { textures: [...textures], geometries: [...geometries] };
}

// 贴图在显存里的大小：RGBA，生成 mipmap 时多三分之一
function textureBytes(texture: Texture): number {
  const { width = 0, height = 0 } = (texture.image ?? {}) as { width?: number; height?: number };
  return width * height * 4 * (texture.generateMipmaps ? 4 / 3 : 1);
}

const attributeBytes = (attribute: BufferAttribute | InterleavedBufferAttribute) =>
  'isInterleavedBufferAttribute' in attribute ? attribute.data.array.byteLength : attribute.array.byteLength;

function geometryBytes(geometry: BufferGeometry): number {
  let bytes = geometry.index?.array.byteLength ?? 0;
  for (const attribute of Object.values(geometry.attributes)) {
    bytes += attributeBytes(attribute);
  }
  return bytes;
}

/** 每个瓦片集的 TilesRenderer 把解析好的瓦片交给它，渲染器每帧画模型之前按预算处理 */
export class TileUploader implements Disposable {
  readonly #bytesPerFrame: number | null;
  readonly #requestFrame: () => void;
  readonly #jobs: UploadJob[] = [];
  // Three 没有公开的方法单独上传几何体：把绘制范围设成 0 画一次（走到上传，不画任何东西），用同一个简单材质，不编译瓦片自己的着色器
  readonly #stage = new Scene();
  readonly #camera = new PerspectiveCamera();
  #active = false;
  #uploadedBytes = 0;
  // 这个上下文里提前传过的贴图：只释放它们，没提前传的要在第一次绘制时从内存里传。上下文丢了、撤下层时清空
  #uploaded = new WeakSet<Texture>();
  #releasedBytes = 0;

  /** bytesPerFrame 为 null 时不提前上传，第一次绘制时才上传 */
  constructor(bytesPerFrame: number | null, requestFrame: () => void) {
    this.#bytesPerFrame = bytesPerFrame;
    this.#requestFrame = requestFrame;
    this.#stage.overrideMaterial = new MeshBasicMaterial();
    this.#stage.matrixWorldAutoUpdate = false;
  }

  /** 排队等待的瓦片数 */
  get pending(): number {
    return this.#jobs.length;
  }

  /** 累计提前上传的字节 */
  get uploadedBytes(): number {
    return this.#uploadedBytes;
  }

  /** 累计释放了内存里那一份的贴图字节 */
  get releasedBytes(): number {
    return this.#releasedBytes;
  }

  /** 能不能上传：层撤下、上下文丢失时不能。不能时不排队，已经排着的直接放行，退回第一次绘制时上传，不会卡住加载 */
  setActive(active: boolean): void {
    this.#active = active;
    if (!active) {
      this.#releaseAll();
      // 之前传的不一定还在显存里（上下文丢了）：这以后到的瓦片的贴图不释放，留给下一次上传
      this.#uploaded = new WeakSet();
    }
  }

  /**
   * 瓦片记完字节以后（库的 load-model 事件，ADR 0155 第 5 节）调用：这个上下文里提前传过的贴图，关掉内存里的那份（ImageBitmap）。
   * 不能更早：上传预算和瓦片库都在传完以后才按贴图的宽高算字节，关了以后宽高是 0。之后不能再从内存上传，上下文丢了要重新下载
   */
  release(scene: Object3D): void {
    for (const texture of collect(scene).textures) {
      const image: unknown = texture.image;
      if (this.#uploaded.has(texture) && image instanceof ImageBitmap) {
        this.#releasedBytes += image.width * image.height * 4;
        image.close();
      }
    }
  }

  /** 排队；传完、signal 中止、不能上传时结束，不会失败 */
  enqueue(scene: Object3D, signal: AbortSignal): Promise<void> {
    if (!this.#active || this.#bytesPerFrame === null || signal.aborted) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      const onAbort = () => {
        const index = this.#jobs.indexOf(job);
        if (index >= 0) {
          this.#jobs.splice(index, 1);
        }
        job.finish();
      };
      const job: UploadJob = {
        scene,
        ...collect(scene),
        nextTexture: 0,
        finish() {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }
      };
      signal.addEventListener('abort', onAbort);
      this.#jobs.push(job);
      this.#requestFrame();
    });
  }

  /** 一帧的上传：花完预算为止，一帧至少走一步，一张超过预算的贴图也能传。要在作废了 Three 的状态缓存之后调用 */
  run(webgl: WebGLRenderer): void {
    const budget = this.#bytesPerFrame;
    if (budget === null) {
      return;
    }
    let spent = 0;
    while (spent < budget) {
      const [job] = this.#jobs;
      if (!job) {
        break;
      }
      spent += this.#step(webgl, job);
    }
    this.#uploadedBytes += spent;
    if (this.#jobs.length > 0) {
      this.#requestFrame();
    }
  }

  [Symbol.dispose](): void {
    this.#active = false;
    this.#releaseAll();
    this.#stage.overrideMaterial?.dispose();
  }

  // 传一张贴图；贴图传完了传几何体，这块瓦片就算完成。返回这一步的字节
  #step(webgl: WebGLRenderer, job: UploadJob): number {
    const texture = job.textures[job.nextTexture];
    if (texture) {
      job.nextTexture++;
      webgl.initTexture(texture);
      this.#uploaded.add(texture);
      return textureBytes(texture);
    }
    this.#jobs.shift();
    const bytes = this.#uploadGeometries(webgl, job);
    job.finish();
    return bytes;
  }

  #uploadGeometries(webgl: WebGLRenderer, { scene, geometries }: UploadJob): number {
    const ranges = geometries.map(geometry => ({ ...geometry.drawRange }));
    for (const geometry of geometries) {
      geometry.setDrawRange(0, 0);
    }
    // 瓦片的 scene 这时还没有父节点；放上舞台画完就拿下来，世界矩阵不用算
    const { parent } = scene;
    this.#stage.add(scene);
    try {
      webgl.render(this.#stage, this.#camera);
    } finally {
      this.#stage.remove(scene);
      scene.parent = parent;
      geometries.forEach((geometry, index) => {
        const { start, count } = ranges[index] ?? { start: 0, count: Infinity };
        geometry.setDrawRange(start, count);
      });
    }
    return geometries.reduce((sum, geometry) => sum + geometryBytes(geometry), 0);
  }

  #releaseAll(): void {
    for (const job of this.#jobs.splice(0)) {
      job.finish();
    }
  }
}
