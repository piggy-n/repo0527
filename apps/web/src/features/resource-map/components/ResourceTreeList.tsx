import { ArrowDown, ArrowRight } from '@element-plus/icons-vue';
import { ElButton, ElCheckbox } from 'element-plus';
import { defineComponent, nextTick, type PropType, ref, type VNode } from 'vue';
import { useSortableList } from '@/shared/composables/useSortableList';
import { type IconName, SvgIcon } from '@/shared/icons/SvgIcon';
import type { ResourceGeometry } from '../catalog';
import type { CatalogOrderOwner } from '../composables/useCatalogOrder';
import type { ResourceLayers } from '../composables/useResourceLayers';
import { arrowStep } from '../keyboard';
import { nodeKey, type PanelNode } from '../layer-panel';
import styles from './ResourceTreeList.module.scss';
import { focusMoveButton, LayerMoveButtons, type MoveDirection } from './LayerMoveButtons';
import { LayerOpacity } from './LayerOpacity';

const GEOMETRY_ICONS: Readonly<Record<ResourceGeometry, IconName>> = {
  fill: 'geometry-polygon',
  line: 'geometry-line',
  circle: 'geometry-point'
};

/**
 * 目录树里一个父节点下的子节点（ADR 0053 第 6 节）：分类可以展开，资源名称前是几何类型的图标。
 * 拖动手柄（复选框前面）和行末的上移、下移只在同一个父节点下调整目录顺序，交给目录顺序的拥有者，不改叠放顺序（ADR 0096）；
 * 搜索期间不能调整。每一层一个拖动实例，手柄按层级区分，免得外层的实例接手里层的拖动
 */
export const ResourceTreeList = defineComponent({
  name: 'ResourceTreeList',
  props: {
    nodes: { type: Array as PropType<readonly PanelNode[]>, required: true },
    /** 这些节点的父节点在目录顺序里的键 */
    parentId: { type: String, required: true },
    depth: { type: Number, required: true },
    expanded: { type: Object as PropType<ReadonlySet<string>>, required: true },
    searching: { type: Boolean, default: false },
    layers: { type: Object as PropType<ResourceLayers>, required: true },
    catalogOrder: { type: Object as PropType<CatalogOrderOwner>, required: true }
  },
  emits: {
    toggle: (id: string) => typeof id === 'string'
  },
  setup(props, { emit }) {
    const list = ref<HTMLElement>();
    const handleSelector = `[data-drag-handle="${props.depth}"]`;
    const move = (from: number, to: number) =>
      props.catalogOrder.move(props.parentId, props.nodes.map(nodeKey), from, to);

    useSortableList(list, {
      handle: handleSelector,
      draggable: '>[data-sortable-item]',
      disabled: () => props.searching,
      onMove: move
    });

    // 这一层里某个节点的行（li）
    const rowOf = (key: string) =>
      [...(list.value?.children ?? [])].find(
        item => item instanceof HTMLElement && (item.dataset.resource ?? item.dataset.category) === key
      );

    // 上移、下移一位；移动后列表重新渲染，焦点回到这一行的按钮上
    const onMoveButton = async (index: number, direction: MoveDirection) => {
      const node = props.nodes[index];
      if (!node) {
        return;
      }
      const key = nodeKey(node);
      move(index, index + (direction === 'up' ? -1 : 1));
      await nextTick();
      focusMoveButton(rowOf(key)?.firstElementChild, direction);
    };

    // 手柄上按上下方向键移动一位；移动后列表重新渲染，焦点回到这个手柄上
    const onHandleKeydown = async (event: KeyboardEvent, index: number) => {
      const to = index + arrowStep(event);
      if (to === index || to < 0 || to >= props.nodes.length) {
        return;
      }
      event.preventDefault();
      const key = props.nodes[index] && nodeKey(props.nodes[index]);
      move(index, to);
      await nextTick();
      const handles = list.value?.querySelectorAll<HTMLElement>(handleSelector) ?? [];
      [...handles].find(handle => handle.dataset.key === key)?.focus();
    };

    const renderMoves = (index: number, name: string) =>
      !props.searching && (
        <LayerMoveButtons
          name={name}
          order="catalog"
          canUp={index > 0}
          canDown={index < props.nodes.length - 1}
          onMove={direction => void onMoveButton(index, direction)}
        />
      );

    const renderHandle = (node: PanelNode, index: number, name: string) =>
      !props.searching && (
        <button
          type="button"
          class={styles.handle}
          data-drag-handle={props.depth}
          data-key={nodeKey(node)}
          aria-label={`调整目录顺序：${name}`}
          title="调整目录顺序"
          onKeydown={event => void onHandleKeydown(event, index)}
        >
          <SvgIcon name="drag-handle" size={16} />
        </button>
      );

    const renderNode = (node: PanelNode, index: number): VNode => {
      const { layers: owner } = props;
      if (node.kind === 'resource') {
        const display = owner.state.value.displays.get(node.code);
        return (
          <li key={node.code} data-sortable-item data-resource={node.code}>
            <div class={styles.row}>
              <span class={styles.leafPad} />
              {renderHandle(node, index, node.name)}
              <ElCheckbox
                class={styles.checkbox}
                modelValue={node.checked}
                onUpdate:modelValue={value => owner.setChecked(node.code, value === true)}
              >
                <span class={styles.label}>
                  <SvgIcon class={styles.geometry} name={GEOMETRY_ICONS[node.geometry]} size={16} />
                  <span class={styles.name} title={node.name}>
                    {node.name}
                  </span>
                </span>
              </ElCheckbox>
              {owner.configErrors.value.has(node.code) && <span class={styles.error}>配置错误</span>}
              {node.checked && display && (
                <LayerOpacity
                  name={node.name}
                  modelValue={display.opacity}
                  onUpdate:modelValue={value => owner.setOpacity(node.code, value)}
                />
              )}
              {renderMoves(index, node.name)}
            </div>
          </li>
        );
      }
      // 搜索时命中的路径都展开
      const open = props.searching || props.expanded.has(node.id);
      return (
        <li key={node.id} data-sortable-item data-category={node.id}>
          <div class={[styles.row, styles.group]}>
            <ElButton
              link
              class={styles.arrow}
              icon={open ? ArrowDown : ArrowRight}
              aria-label={`${open ? '收起' : '展开'}${node.name}`}
              disabled={props.searching}
              onClick={() => emit('toggle', node.id)}
            />
            {renderHandle(node, index, node.name)}
            <ElCheckbox
              class={styles.checkbox}
              modelValue={node.checkState === 'all'}
              indeterminate={node.checkState === 'some'}
              onUpdate:modelValue={value => owner.setCheckedMany(node.codes, value === true)}
            >
              <span class={styles.name}>{node.name}</span>
            </ElCheckbox>
            <span class={styles.count}>{node.codes.length}</span>
            {renderMoves(index, node.name)}
          </div>
          {open && (
            <ResourceTreeList
              class={styles.children}
              nodes={node.children}
              parentId={node.id}
              depth={props.depth + 1}
              expanded={props.expanded}
              searching={props.searching}
              layers={props.layers}
              catalogOrder={props.catalogOrder}
              onToggle={id => emit('toggle', id)}
            />
          )}
        </li>
      );
    };

    return () => (
      <ul ref={list} class={styles.list}>
        {props.nodes.map(renderNode)}
      </ul>
    );
  }
});
