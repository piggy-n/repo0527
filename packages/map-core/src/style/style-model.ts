import type { LayerSpecification, SourceSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Unsubscribe } from '../events';
import { ModelEvents } from '../model-events';
import { diffSnapshot, type StyleCommand, type StyleSnapshot } from './diff-style';
import { assertStyleImage, type StyleImage, type StyleImages } from './style-image';

/** 一个拥有者负责的数据源、图层和样式图片：不可变，变化时整体替换（ADR 0022、0045） */
export interface StyleGroup {
  readonly sources: Readonly<Record<string, SourceSpecification>>;
  readonly layers: readonly LayerSpecification[];
  /** 图层引用的图片（如 `fill-pattern`）；ID 跨分组不能重复 */
  readonly images?: StyleImages;
}

/** 样式的根属性（glyphs、sprite 等），由装配方提供；相机归 CameraModel，不能写在这里 */
export type StyleRoot = Omit<
  StyleSpecification,
  'version' | 'sources' | 'layers' | 'center' | 'centerAltitude' | 'zoom' | 'bearing' | 'pitch' | 'roll'
>;

/** 一次通知：从上次通知的快照到当前快照的命令 */
export interface StyleChange {
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly commands: readonly StyleCommand[];
  readonly style: StyleSpecification;
  readonly images: StyleImages;
  /** 三维模型层插在这个图层下面，见 StyleSnapshot */
  readonly sceneBefore?: string;
}

export interface StyleModelOptions<G extends string> {
  /** 分组的叠放顺序，从下到上 */
  readonly groups: readonly G[];
  readonly root?: StyleRoot;
  /**
   * MapLibre 引擎的三维模型层的上限（ADR 0147 第 2 节、ADR 0161）：这个分组和以上的分组永远画在模型上面；没有插槽时
   * 模型层就在它下面，以下的分组被模型挡住。不给时没有上限，没有插槽时模型层在最上面
   */
  readonly sceneBelow?: G;
}

interface StyleModelEvents {
  change: (change: StyleChange) => void;
}

const EMPTY_GROUP: StyleGroup = { sources: {}, layers: [] };

// 组合的结果：快照，以及上限分组之前的图层个数（没有上限时为 undefined），插槽单独变化时按它重新定位置
interface Composed {
  readonly snapshot: StyleSnapshot;
  readonly ceiling: number | undefined;
}

// 模型层插在哪个图层下面（ADR 0161）：插槽的图层在样式里、并且在上限以下时插在它下面，否则插在上限分组及以上的
// 第一个图层下面；都没有时为 undefined（在最上面）
function sceneBeforeOf(
  layers: readonly LayerSpecification[],
  ceiling: number | undefined,
  slot: string | undefined
): string | undefined {
  const index = slot === undefined ? -1 : layers.findIndex(layer => layer.id === slot);
  const at = index !== -1 && (ceiling === undefined || index < ceiling) ? index : ceiling;
  return at === undefined ? undefined : layers[at]?.id;
}

function withSceneBefore(snapshot: StyleSnapshot, sceneBefore: string | undefined): StyleSnapshot {
  const { style, images } = snapshot;
  return sceneBefore === undefined ? { style, images } : { style, images, sceneBefore };
}

function compose<G extends string>(
  root: StyleRoot,
  order: readonly G[],
  groups: ReadonlyMap<G, StyleGroup>,
  sceneBelow: G | undefined,
  slot: string | undefined
): Composed {
  const sources: Record<string, SourceSpecification> = {};
  const layers: LayerSpecification[] = [];
  const images: Record<string, StyleImage> = {};
  const sourceOwners = new Map<string, G>();
  const layerOwners = new Map<string, G>();
  const imageOwners = new Map<string, G>();
  // 三维模型层的上限：sceneBelow 之前各分组的图层个数
  let below: number | undefined;

  for (const id of order) {
    if (id === sceneBelow) {
      below = layers.length;
    }
    const group = groups.get(id) ?? EMPTY_GROUP;
    for (const [sourceId, source] of Object.entries(group.sources)) {
      const owner = sourceOwners.get(sourceId);
      if (owner !== undefined) {
        throw new Error(`数据源 ID "${sourceId}" 在分组 ${owner} 和 ${id} 中重复`);
      }
      sourceOwners.set(sourceId, id);
      sources[sourceId] = source;
    }
    for (const layer of group.layers) {
      const owner = layerOwners.get(layer.id);
      if (owner !== undefined) {
        throw new Error(`图层 ID "${layer.id}" 在分组 ${owner} 和 ${id} 中重复`);
      }
      layerOwners.set(layer.id, id);
      layers.push(layer);
    }
    for (const [imageId, image] of Object.entries(group.images ?? {})) {
      const owner = imageOwners.get(imageId);
      if (owner !== undefined) {
        throw new Error(`图片 ID "${imageId}" 在分组 ${owner} 和 ${id} 中重复`);
      }
      assertStyleImage(imageId, image);
      imageOwners.set(imageId, id);
      images[imageId] = image;
    }
  }

  // 图层可以引用其他分组的数据源；删除数据源时，引用它的图层要在同一次提交中一起处理
  for (const layer of layers) {
    if ('source' in layer && !Object.hasOwn(sources, layer.source)) {
      throw new Error(`图层 "${layer.id}" 引用的数据源 "${layer.source}" 不存在`);
    }
  }

  const style: StyleSpecification = { ...root, version: 8, sources, layers };
  return { snapshot: withSceneBefore({ style, images }, sceneBeforeOf(layers, below, slot)), ceiling: below };
}

/**
 * 样式模型：按分组组合样式，提交时修订号加 1，同一轮事件循环的变化合并通知（ADR 0022）。
 * 三维模型层的位置也是快照的一部分：上限分组是构造时声明的，插槽在运行时设置（ADR 0161）
 */
export class StyleModel<const G extends string> implements Disposable {
  readonly #order: readonly G[];
  readonly #root: StyleRoot;
  readonly #sceneBelow: G | undefined;
  readonly #events = new ModelEvents<StyleModelEvents>('StyleModel');
  #groups = new Map<G, StyleGroup>();
  #slot: string | undefined;
  #ceiling: number | undefined;
  #current: StyleSnapshot;
  #revision = 0;
  // 上次通知时的快照，下次通知从它开始对比
  #notified: { revision: number; snapshot: StyleSnapshot };
  #flushScheduled = false;

  constructor({ groups, root = {}, sceneBelow }: StyleModelOptions<G>) {
    if (new Set(groups).size !== groups.length) {
      throw new Error(`分组 ID 重复：${groups.join(', ')}`);
    }
    if (sceneBelow !== undefined && !groups.includes(sceneBelow)) {
      throw new Error(`三维模型层所在的分组 ${sceneBelow} 没有声明`);
    }
    this.#order = [...groups];
    this.#root = root;
    this.#sceneBelow = sceneBelow;
    const { snapshot, ceiling } = compose(root, this.#order, this.#groups, sceneBelow, undefined);
    this.#current = snapshot;
    this.#ceiling = ceiling;
    this.#notified = { revision: 0, snapshot: this.#current };
  }

  /** 当前的完整样式快照 */
  get current(): StyleSpecification {
    return this.#current.style;
  }

  /** 当前快照里的样式图片，和 current 是同一份快照 */
  get images(): StyleImages {
    return this.#current.images;
  }

  /** 当前快照里三维模型层插在哪个图层下面，和 current 是同一份快照 */
  get sceneBefore(): string | undefined {
    return this.#current.sceneBefore;
  }

  /** 设置的插槽，不管它现在是否生效（见 setSceneSlot） */
  get sceneSlot(): string | undefined {
    return this.#slot;
  }

  /** 每次提交加 1 */
  get revision(): number {
    return this.#revision;
  }

  setGroup(id: G, group: StyleGroup): void {
    this.#commit([[id, group]]);
  }

  /** 一次提交多个分组，修订号只加 1 */
  setGroups(groups: Partial<Readonly<Record<G, StyleGroup>>>): void {
    this.#commit(Object.entries<StyleGroup | undefined>(groups));
  }

  /**
   * 三维模型层的插槽（ADR 0161）：模型层插在这个图层下面。图层不在样式里（还没提交、已经删掉）或者在 sceneBelow 分组及以上时
   * 不生效，按 sceneBelow 放；之后的提交让它出现时生效。位置变了算一次提交（修订号加 1、通知里没有命令也通知），没变时只记下
   */
  setSceneSlot(layerId: string | undefined): void {
    this.#events.assertAlive();
    if (layerId === this.#slot) {
      return;
    }
    this.#slot = layerId;
    const sceneBefore = sceneBeforeOf(this.#current.style.layers, this.#ceiling, layerId);
    if (sceneBefore === this.#current.sceneBefore) {
      return;
    }
    this.#current = withSceneBefore(this.#current, sceneBefore);
    this.#revision++;
    this.#scheduleFlush();
  }

  on<E extends keyof StyleModelEvents>(event: E, callback: StyleModelEvents[E]): Unsubscribe {
    return this.#events.on(event, callback);
  }

  [Symbol.dispose](): void {
    this.#events[Symbol.dispose]();
  }

  #commit(changes: ReadonlyArray<readonly [string, StyleGroup | undefined]>): void {
    this.#events.assertAlive();
    const next = new Map(this.#groups);
    for (const [id, group] of changes) {
      if (!this.#isGroupId(id)) {
        throw new Error(`未声明的分组：${id}`);
      }
      if (group !== undefined) {
        next.set(id, group);
      }
    }
    if (this.#order.every(id => next.get(id) === this.#groups.get(id))) {
      return;
    }
    // 先组合再改状态：校验失败时整次提交不生效
    const { snapshot, ceiling } = compose(this.#root, this.#order, next, this.#sceneBelow, this.#slot);
    this.#groups = next;
    this.#current = snapshot;
    this.#ceiling = ceiling;
    this.#revision++;
    this.#scheduleFlush();
  }

  #scheduleFlush(): void {
    if (this.#flushScheduled) {
      return;
    }
    this.#flushScheduled = true;
    queueMicrotask(() => this.#flush());
  }

  #flush(): void {
    this.#flushScheduled = false;
    if (this.#events.disposed) {
      return;
    }
    const from = this.#notified;
    // 先记下再通知：监听器里再次提交时，下一次通知从这里开始对比
    this.#notified = { revision: this.#revision, snapshot: this.#current };
    const commands = diffSnapshot(from.snapshot, this.#current);
    // 只有模型层的位置变了也通知：视图收到空的命令时只挪模型层
    if (commands.length === 0 && from.snapshot.sceneBefore === this.#current.sceneBefore) {
      return;
    }
    this.#events.emit('change', {
      fromRevision: from.revision,
      toRevision: this.#revision,
      commands,
      style: this.#current.style,
      images: this.#current.images,
      ...(this.#current.sceneBefore === undefined ? {} : { sceneBefore: this.#current.sceneBefore })
    });
  }

  #isGroupId(id: string): id is G {
    return (this.#order as readonly string[]).includes(id);
  }
}
