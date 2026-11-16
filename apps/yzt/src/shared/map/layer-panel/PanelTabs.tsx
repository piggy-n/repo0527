import { defineComponent, type PropType } from 'vue';
import styles from './PanelTabs.module.scss';

/** 一个带数量的标签：资源显示什么（用户 2026-11-16 选的丁），图层看哪一类（ADR 0161） */
export interface PanelTab {
  readonly id: string;
  readonly label: string;
  /** 这一项的项数（搜索时是匹配的项数）；null 或不给时只有名称（数据还没到或读不到） */
  readonly count?: number | null;
}

/**
 * 资源图层面板里一行带数量的标签（"资源"在搜索行下面、"图层"在标题下面，两处同一个样子）：只能单选；读屏名称带上数量，
 * 数量为 0 的变灰、仍可以点，没有数量的只有名称。每个标签带 data-<kind>-view，测试和页面按它找
 */
export const PanelTabs = defineComponent({
  name: 'PanelTabs',
  props: {
    tabs: { type: Array as PropType<readonly PanelTab[]>, required: true },
    /** 选中的那个标签的 id */
    value: { type: String, required: true },
    /** 这一行的读屏名称 */
    label: { type: String, required: true },
    /** 资源是 catalog，图层是 current */
    kind: { type: String as PropType<'catalog' | 'current'>, required: true }
  },
  emits: {
    'update:value': (id: string) => typeof id === 'string'
  },
  setup(props, { emit }) {
    return () => (
      <div class={styles.tabs} role="tablist" aria-label={props.label}>
        {props.tabs.map(item => {
          const selected = props.value === item.id;
          const count = item.count ?? null;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              class={[styles.tab, selected && styles.selected, count === 0 && styles.empty]}
              aria-selected={selected}
              aria-label={count === null ? item.label : `${item.label} ${count} 项`}
              {...{ [`data-${props.kind}-view`]: item.id }}
              onClick={() => emit('update:value', item.id)}
            >
              {item.label}
              {count !== null && <span class={styles.count}>{count}</span>}
            </button>
          );
        })}
      </div>
    );
  }
});
