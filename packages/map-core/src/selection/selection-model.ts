import type { Unsubscribe } from '../events';
import { ModelEvents } from '../model-events';

/** 选中的要素：数据源和稳定的业务主键（ADR 0022 第 6 条、ADR 0047 第 4 节）；属性和几何留在拥有者的查询缓存里 */
export interface SelectedFeature {
  readonly sourceId: string;
  readonly featureId: string;
}

interface SelectionModelEvents {
  change: (features: readonly SelectedFeature[]) => void;
}

const NONE: readonly SelectedFeature[] = Object.freeze([]);

const keyOf = ({ sourceId, featureId }: SelectedFeature) => JSON.stringify([sourceId, featureId]);

/** 会话的选择状态：只存身份，整体替换，内容不变时不发事件 */
export class SelectionModel implements Disposable {
  readonly #events = new ModelEvents<SelectionModelEvents>('SelectionModel');
  #current = NONE;

  get current(): readonly SelectedFeature[] {
    return this.#current;
  }

  /** 替换成这些要素；同一个要素出现两次时抛错 */
  set(features: readonly SelectedFeature[]): void {
    this.#events.assertAlive();
    const keys = features.map(keyOf);
    if (new Set(keys).size !== keys.length) {
      throw new Error('选中的要素有重复');
    }
    const currentKeys = this.#current.map(keyOf);
    if (keys.length === currentKeys.length && keys.every((key, index) => key === currentKeys[index])) {
      return;
    }
    // 复制后冻结：调用方之后改自己的数组、对象不影响会话
    const copies = features.map(({ sourceId, featureId }) => Object.freeze({ sourceId, featureId }));
    this.#current = copies.length === 0 ? NONE : Object.freeze(copies);
    this.#events.emit('change', this.#current);
  }

  clear(): void {
    this.set(NONE);
  }

  on<E extends keyof SelectionModelEvents>(event: E, callback: SelectionModelEvents[E]): Unsubscribe {
    return this.#events.on(event, callback);
  }

  [Symbol.dispose](): void {
    this.#events[Symbol.dispose]();
  }
}
