import type { LayerSpecification, SourceSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { createNanoEvents } from 'nanoevents';
import type { Unsubscribe } from '../events';
import { diffStyle, type StyleCommand } from './diff-style';

/** 一个拥有者负责的数据源和图层：不可变，变化时整体替换（ADR 0022） */
export interface StyleGroup {
  readonly sources: Readonly<Record<string, SourceSpecification>>;
  readonly layers: readonly LayerSpecification[];
}

/** 样式的根属性（glyphs、sprite 等），由装配方提供；相机归 CameraModel，不能写在这里 */
export type StyleRoot = Omit<
  StyleSpecification,
  'version' | 'sources' | 'layers' | 'center' | 'centerAltitude' | 'zoom' | 'bearing' | 'pitch' | 'roll'
>;

/** 一次通知：从上次通知的快照到当前快照的命令 */
export interface StyleChange {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly commands: readonly StyleCommand[];
  readonly style: StyleSpecification;
}

export interface StyleModelOptions<G extends string> {
  /** 分组的叠放顺序，从下到上 */
  readonly groups: readonly G[];
  readonly root?: StyleRoot;
}

interface StyleModelEvents {
  change: (change: StyleChange) => void;
}

const EMPTY_GROUP: StyleGroup = { sources: {}, layers: [] };

function compose<G extends string>(
  root: StyleRoot,
  order: readonly G[],
  groups: ReadonlyMap<G, StyleGroup>
): StyleSpecification {
  const sources: Record<string, SourceSpecification> = {};
  const layers: LayerSpecification[] = [];
  const sourceOwners = new Map<string, G>();
  const layerOwners = new Map<string, G>();

  for (const id of order) {
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
  }

  // 图层可以引用其他分组的数据源；删除数据源时，引用它的图层要在同一次提交中一起处理
  for (const layer of layers) {
    if ('source' in layer && !Object.hasOwn(sources, layer.source)) {
      throw new Error(`图层 "${layer.id}" 引用的数据源 "${layer.source}" 不存在`);
    }
  }

  return { ...root, version: 8, sources, layers };
}

/** 样式模型：按分组组合样式，提交时加版本号，同一轮事件循环的变化合并通知（ADR 0022） */
export class StyleModel<const G extends string> implements Disposable {
  readonly #order: readonly G[];
  readonly #root: StyleRoot;
  readonly #emitter = createNanoEvents<StyleModelEvents>();
  #groups = new Map<G, StyleGroup>();
  #current: StyleSpecification;
  #version = 0;
  // 上次通知时的快照，下次通知从它开始对比
  #notified: { version: number; style: StyleSpecification };
  #flushScheduled = false;
  #disposed = false;

  constructor({ groups, root = {} }: StyleModelOptions<G>) {
    if (new Set(groups).size !== groups.length) {
      throw new Error(`分组 ID 重复：${groups.join(', ')}`);
    }
    this.#order = [...groups];
    this.#root = root;
    this.#current = compose(root, this.#order, this.#groups);
    this.#notified = { version: 0, style: this.#current };
  }

  /** 当前的完整样式快照 */
  get current(): StyleSpecification {
    return this.#current;
  }

  /** 每次提交加 1 */
  get version(): number {
    return this.#version;
  }

  setGroup(id: G, group: StyleGroup): void {
    this.#commit([[id, group]]);
  }

  /** 一次提交多个分组，只加一次版本号 */
  setGroups(groups: Partial<Readonly<Record<G, StyleGroup>>>): void {
    this.#commit(Object.entries<StyleGroup | undefined>(groups));
  }

  on<E extends keyof StyleModelEvents>(event: E, callback: StyleModelEvents[E]): Unsubscribe {
    this.#assertAlive();
    return this.#emitter.on(event, callback);
  }

  [Symbol.dispose](): void {
    this.#disposed = true;
    this.#emitter.events = {};
  }

  #commit(changes: ReadonlyArray<readonly [string, StyleGroup | undefined]>): void {
    this.#assertAlive();
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
    const style = compose(this.#root, this.#order, next);
    this.#groups = next;
    this.#current = style;
    this.#version++;
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
    if (this.#disposed) {
      return;
    }
    const from = this.#notified;
    // 先记下再通知：监听器里再次提交时，下一次通知从这里开始对比
    this.#notified = { version: this.#version, style: this.#current };
    const commands = diffStyle(from.style, this.#current);
    if (commands.length === 0) {
      return;
    }
    this.#emitter.emit('change', {
      fromVersion: from.version,
      toVersion: this.#version,
      commands,
      style: this.#current
    });
  }

  #isGroupId(id: string): id is G {
    return (this.#order as readonly string[]).includes(id);
  }

  #assertAlive(): void {
    if (this.#disposed) {
      throw new Error('StyleModel 已释放');
    }
  }
}
