import { ArrowRight } from '@element-plus/icons-vue';
import { ElIcon, ElTooltip } from 'element-plus';
import { computed, defineComponent, nextTick, type PropType, ref, type VNode } from 'vue';
import { SvgIcon } from '../../icons/SvgIcon';
import { MAP_TOOLTIP_PROPS } from '../tooltip';
import { type CatalogSelection, focusKey, rovingKey, selectKey, type SelectMode } from './catalog-selection';
import { type CatalogNode, catalogCover, findCatalogNode, leavesOf, visibleKeys } from './catalog-tree';
import styles from './CatalogTree.module.scss';
import { revealInScroll } from './scroll';

/** 打开右键菜单的位置（视口坐标） */
export interface MenuPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * 资源目录的树（ADR 0157）：只有项能选中，单击选中，Ctrl（Mac 上 ⌘）单击加选，Shift 单击连选；分类不能选中
 * （用户 2026-11-15），单击是展开、收起。行尾一列：分类是项数，已添加的项是绿色的勾，悬停、键盘焦点时换成这一行的
 * 添加或移除（分类作用于下面全部的项）；双击已添加的项是定位。节点由各 feature 推导、页面拼好交进来，
 * 选中和展开由页面持有，添加、移除、定位都只报告给页面
 */
export const CatalogTree = defineComponent({
  name: 'CatalogTree',
  props: {
    nodes: { type: Array as PropType<readonly CatalogNode[]>, required: true },
    expanded: { type: Object as PropType<ReadonlySet<string>>, required: true },
    selection: { type: Object as PropType<CatalogSelection>, required: true },
    /** 有搜索关键字：分类全部展开，不能收起 */
    searching: { type: Boolean, default: false },
    label: { type: String, required: true }
  },
  emits: {
    'update:selection': (selection: CatalogSelection) => typeof selection === 'object',
    'update:expanded': (expanded: ReadonlySet<string>) => expanded instanceof Set,
    /** 要加入、移出的项的键，按目录的先后 */
    add: (keys: readonly string[]) => Array.isArray(keys),
    remove: (keys: readonly string[]) => Array.isArray(keys),
    /** 定位到当前图层里的这一项：只对已添加的项发出 */
    locate: (key: string) => typeof key === 'string',
    menu: (key: string, point: MenuPoint) => typeof key === 'string' && typeof point === 'object'
  },
  setup(props, { emit }) {
    const root = ref<HTMLElement>();
    const visible = computed(() => visibleKeys(props.nodes, props.expanded, props.searching));
    const roving = computed(() => rovingKey(props.selection, visible.value));
    // 能选中的只有项：连选只连显示着的项
    const leafKeys = computed(() => new Set(props.nodes.flatMap(leavesOf).map(leaf => leaf.key)));
    const visibleLeaves = computed(() => visible.value.filter(key => leafKeys.value.has(key)));

    const rowOf = (key: string) => root.value?.querySelector<HTMLElement>(`[data-catalog-node="${CSS.escape(key)}"]`);
    const focusRow = async (key: string) => {
      await nextTick();
      const row = rowOf(key);
      if (row) {
        row.focus({ preventScroll: true });
        revealInScroll(row);
      }
    };

    const select = (key: string, mode: SelectMode = {}) =>
      emit('update:selection', selectKey(props.selection, key, visibleLeaves.value, mode));
    // 分类只接键盘焦点，选中不变
    const focusOnly = (key: string) => emit('update:selection', focusKey(props.selection, key));

    const toggleExpanded = (key: string, open?: boolean) => {
      const next = new Set(props.expanded);
      const shouldOpen = open ?? !next.has(key);
      if (shouldOpen === next.has(key)) {
        return;
      }
      if (shouldOpen) {
        next.add(key);
      } else {
        next.delete(key);
      }
      emit('update:expanded', next);
    };

    const locate = (key: string) => {
      const node = findCatalogNode(props.nodes, key);
      if (node?.kind === 'leaf' && node.added) {
        emit('locate', key);
        return true;
      }
      return false;
    };

    // 行上的单击：项是选中（Ctrl / ⌘ 加选，Shift 连选），分类是展开、收起
    const onRowClick = (event: MouseEvent, node: CatalogNode) => {
      if (node.kind === 'leaf') {
        select(node.key, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey });
        return;
      }
      focusOnly(node.key);
      if (!props.searching) {
        toggleExpanded(node.key);
      }
    };

    // 双击：已添加的项是定位，没添加的什么也不做；分类的两下单击已经展开又收起，这里不再处理
    const onRowDblclick = (event: MouseEvent, node: CatalogNode) => {
      if (node.kind === 'leaf' && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        locate(node.key);
      }
    };

    // 右键：不在选中里的项先改成只选它，在选中里时保留多选；分类不改选中，菜单作用于它下面的项
    const openMenu = (node: CatalogNode, point: MenuPoint) => {
      if (node.kind === 'branch' || props.selection.keys.has(node.key)) {
        focusOnly(node.key);
      } else {
        select(node.key);
      }
      emit('menu', node.key, point);
    };

    // Insert、Delete 作用的项：焦点在分类上时是它下面的，否则是选中的
    const keyboardCover = (node: CatalogNode) =>
      catalogCover(props.nodes, node.kind === 'branch' ? new Set([node.key]) : props.selection.keys);

    const onRowKeydown = (event: KeyboardEvent, node: CatalogNode) => {
      if (event.target !== event.currentTarget || event.isComposing) {
        return;
      }
      const index = visible.value.indexOf(node.key);
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      if (step !== undefined) {
        const next = visible.value[Math.min(visible.value.length - 1, Math.max(0, index + step))];
        if (next !== undefined && leafKeys.value.has(next)) {
          select(next, { range: event.shiftKey });
        } else if (next !== undefined) {
          focusOnly(next);
        }
        if (next !== undefined) {
          void focusRow(next);
        }
      } else if (event.key === 'ArrowRight' && node.kind === 'branch' && !props.searching) {
        toggleExpanded(node.key, true);
      } else if (event.key === 'ArrowLeft' && node.kind === 'branch' && !props.searching) {
        toggleExpanded(node.key, false);
      } else if (event.key === ' ' || event.key === 'Enter') {
        if (node.kind === 'branch') {
          if (!props.searching) {
            toggleExpanded(node.key);
          }
        } else if (event.key === ' ') {
          select(node.key, { toggle: true });
        } else {
          locate(node.key);
        }
      } else if (event.key === 'Insert' || event.key === 'Delete') {
        const cover = keyboardCover(node);
        const keys = event.key === 'Insert' ? cover.add : cover.remove;
        if (keys.length > 0 && event.key === 'Insert') {
          emit('add', keys);
        } else if (keys.length > 0) {
          emit('remove', keys);
        }
      } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        openMenu(node, { x: rect.left + 40, y: rect.bottom });
      } else {
        return;
      }
      event.preventDefault();
    };

    // 行尾一列（用户 2026-11-15：勾和项数在同一条竖线上）：分类平时是项数，全部添加的项是绿色的勾；
    // 悬停、键盘焦点时换成这一行能做的操作，还有没添加的是添加，否则是移除
    const renderEnd = (node: CatalogNode) => {
      const leaves = leavesOf(node);
      const added = leaves.filter(leaf => leaf.added).length;
      const canAdd = added < leaves.length;
      const count = canAdd ? leaves.length - added : leaves.length;
      const action = canAdd ? '添加' : '移除';
      const tip = node.kind === 'branch' ? `${action} ${count} 项` : action;
      const keys = leaves.filter(leaf => leaf.added !== canAdd).map(leaf => leaf.key);
      return (
        <span class={styles.end}>
          {node.kind === 'branch' && <span class={styles.badge}>{leaves.length}</span>}
          {node.kind === 'leaf' && node.added && (
            <span class={styles.mark} role="img" aria-label="已添加" data-added-mark>
              <SvgIcon name="check" size={14} />
            </span>
          )}
          {leaves.length > 0 && (
            <ElTooltip {...MAP_TOOLTIP_PROPS} content={tip} placement="top">
              <button
                type="button"
                class={[styles.action, !canAdd && styles.remove]}
                tabindex={-1}
                aria-label={`${tip}：${node.label}`}
                data-node-action={canAdd ? 'add' : 'remove'}
                onClick={(event: MouseEvent) => {
                  event.stopPropagation();
                  if (canAdd) {
                    emit('add', keys);
                  } else {
                    emit('remove', keys);
                  }
                }}
                onDblclick={(event: MouseEvent) => event.stopPropagation()}
              >
                <SvgIcon name={canAdd ? 'layer-add' : 'layer-remove'} size={16} />
              </button>
            </ElTooltip>
          )}
        </span>
      );
    };

    const renderNode = (node: CatalogNode, depth: number): VNode => {
      const selected = props.selection.keys.has(node.key);
      const open = node.kind === 'branch' && (props.searching || props.expanded.has(node.key));
      const row = (
        <div
          class={[styles.row, node.kind === 'branch' && styles.branch, selected && styles.selected]}
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={node.kind === 'leaf' ? selected : undefined}
          aria-expanded={node.kind === 'branch' ? open : undefined}
          tabindex={node.key === roving.value ? 0 : -1}
          data-catalog-node={node.key}
          style={{ paddingLeft: `${depth * 18}px` }}
          onClick={(event: MouseEvent) => onRowClick(event, node)}
          onDblclick={(event: MouseEvent) => onRowDblclick(event, node)}
          onContextmenu={(event: MouseEvent) => {
            event.preventDefault();
            openMenu(node, { x: event.clientX, y: event.clientY });
          }}
          onKeydown={(event: KeyboardEvent) => onRowKeydown(event, node)}
        >
          {node.kind === 'branch' ? (
            <button
              type="button"
              class={[styles.arrow, open && styles.open]}
              tabindex={-1}
              aria-label={`${open ? '收起' : '展开'}${node.label}`}
              disabled={props.searching}
              onClick={(event: MouseEvent) => {
                event.stopPropagation();
                toggleExpanded(node.key);
              }}
              onDblclick={(event: MouseEvent) => event.stopPropagation()}
            >
              <ElIcon>
                <ArrowRight />
              </ElIcon>
            </button>
          ) : (
            <span class={styles.pad} />
          )}
          {node.kind === 'leaf' && <SvgIcon class={styles.icon} name={node.icon} size={16} />}
          {node.kind === 'branch' && node.icon && <SvgIcon class={styles.icon} name={node.icon} size={16} />}
          <span class={styles.name} title={node.label}>
            {node.label}
          </span>
          {node.kind === 'leaf' && node.note && <span class={styles.note}>{node.note}</span>}
          {renderEnd(node)}
        </div>
      );
      return (
        <li key={node.key} role="none">
          {row}
          {open && node.kind === 'branch' && (
            <ul class={styles.children} role="group" style={{ '--guide-depth': depth }}>
              {node.children.map(child => renderNode(child, depth + 1))}
            </ul>
          )}
        </li>
      );
    };

    return () => (
      <ul ref={root} class={styles.tree} role="tree" aria-label={props.label} aria-multiselectable="true">
        {props.nodes.map(node => renderNode(node, 0))}
      </ul>
    );
  }
});
