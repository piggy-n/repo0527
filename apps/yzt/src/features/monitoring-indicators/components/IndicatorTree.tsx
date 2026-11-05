import { ArrowDown, ArrowRight, Refresh, Search } from '@element-plus/icons-vue';
import { MxTitle } from '@yzt/ui';
import {
  ElButton,
  ElCheckbox,
  ElIcon,
  ElInput,
  ElRadioButton,
  ElRadioGroup,
  ElSkeleton,
  ElTag,
  ElTooltip,
  vLoading
} from 'element-plus';
import { computed, defineComponent, type PropType, ref, type VNode } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import type { IndicatorTree as IndicatorTreeOwner } from '../composables/useIndicatorTree';
import {
  filterIndicatorTree,
  INDICATOR_CATEGORIES,
  INDICATOR_STATUS_LABELS,
  type IndicatorCategory,
  indicatorLeaves,
  type IndicatorLeaf,
  type IndicatorStatus,
  type IndicatorTreeNode
} from '../indicator-tree';
import styles from './IndicatorTree.module.scss';

const STATUS_TAGS: Readonly<Record<IndicatorStatus, 'info' | 'primary' | 'success' | 'danger'>> = {
  pending: 'info',
  processing: 'primary',
  done: 'success',
  failed: 'danger'
};

// 计算树：指标后面的状态标签，有结果或原因时悬停查看
const renderStatus = (leaf: IndicatorLeaf) => {
  if (leaf.status === null) {
    return null;
  }
  const tag = (
    <ElTag class={styles.tag} size="small" type={STATUS_TAGS[leaf.status]} disableTransitions>
      {INDICATOR_STATUS_LABELS[leaf.status]}
    </ElTag>
  );
  if (leaf.result === null && leaf.reason === null) {
    return tag;
  }
  return (
    <ElTooltip placement="top" showAfter={200}>
      {{
        default: () => tag,
        content: () => (
          <div class={styles.tip}>
            {leaf.result !== null && <div>结果：{leaf.result}</div>}
            {leaf.reason !== null && <div>原因：{leaf.reason}</div>}
          </div>
        )
      }}
    </ElTooltip>
  );
};

// 展示树：指标后面的计算结果
const renderResult = (leaf: IndicatorLeaf) =>
  leaf.result !== null && (
    <span class={styles.result} title={leaf.result}>
      {leaf.result}
    </span>
  );

/**
 * 指标树：分类页签、搜索和勾选。calculation 用于计算（可多选、全选，指标后面是计算状态），
 * result 用于展示（单选，指标后面是计算结果）。分类默认全部展开，搜索时展开命中的分类
 */
export const IndicatorTree = defineComponent({
  name: 'IndicatorTree',
  directives: { loading: vLoading },
  props: {
    tree: { type: Object as PropType<IndicatorTreeOwner>, required: true },
    variant: { type: String as PropType<'calculation' | 'result'>, required: true }
  },
  setup(props) {
    const keyword = ref('');
    // 记收起的分类：新出现的分类默认展开，刷新后按编码保留收起状态
    const collapsed = ref(new Set<string>());
    const searching = computed(() => keyword.value.trim() !== '');

    const state = computed(() => props.tree.state.value);
    const nodes = computed(() => (state.value.kind === 'ready' ? state.value.nodes : []));
    const shown = computed(() => filterIndicatorTree(nodes.value, keyword.value));
    const enabled = computed(() => indicatorLeaves(nodes.value).filter(leaf => !leaf.disabled));
    const checkedCount = computed(() => enabled.value.filter(leaf => props.tree.checked.value.has(leaf.code)).length);

    // 骨架屏和遮罩延迟显示，很快返回时什么都不出现（docs/modules/table.md）
    const showSkeleton = useDelayedFlag(() => state.value.kind === 'loading');
    const showMask = useDelayedFlag(() => state.value.kind === 'ready' && state.value.refreshing);

    const toggleGroup = (code: string) => {
      const next = new Set(collapsed.value);
      if (!next.delete(code)) {
        next.add(code);
      }
      collapsed.value = next;
    };

    const renderLeaf = (leaf: IndicatorLeaf) => (
      <li key={leaf.code} class={[styles.row, leaf.disabled && styles.disabled]}>
        <span class={styles.arrowPad} />
        <ElCheckbox
          class={styles.checkbox}
          modelValue={props.tree.checked.value.has(leaf.code)}
          disabled={leaf.disabled}
          onChange={value => props.tree.toggle(leaf, value === true)}
        >
          <span title={leaf.name}>{leaf.name}</span>
        </ElCheckbox>
        {props.variant === 'calculation' ? renderStatus(leaf) : renderResult(leaf)}
      </li>
    );

    const renderNodes = (list: readonly IndicatorTreeNode[]): VNode => (
      <ul class={styles.list}>
        {list.map(node => {
          if (node.kind === 'leaf') {
            return renderLeaf(node);
          }
          const expanded = searching.value || !collapsed.value.has(node.code);
          return (
            <li key={node.code}>
              <button
                type="button"
                class={[styles.row, styles.group]}
                aria-expanded={expanded}
                disabled={searching.value}
                onClick={() => toggleGroup(node.code)}
              >
                <ElIcon class={styles.arrow}>{expanded ? <ArrowDown /> : <ArrowRight />}</ElIcon>
                <span class={styles.name} title={node.name}>
                  {node.name}
                </span>
              </button>
              {expanded && <div class={styles.children}>{renderNodes(node.children)}</div>}
            </li>
          );
        })}
      </ul>
    );

    const renderBody = () => {
      const current = state.value;
      if (current.kind === 'waiting') {
        return <div class={styles.message}>请选择年份和监测范围后查看指标</div>;
      }
      if (current.kind === 'loading') {
        return showSkeleton.value ? <ElSkeleton class={styles.skeleton} rows={6} animated /> : null;
      }
      if (current.kind === 'failed') {
        return (
          <div class={styles.message}>
            {current.message || '指标加载失败'}
            <ElButton link type="primary" onClick={props.tree.refresh}>
              重新加载
            </ElButton>
          </div>
        );
      }
      if (current.nodes.length === 0) {
        return <div class={styles.message}>暂无指标</div>;
      }
      return shown.value.length > 0 ? renderNodes(shown.value) : <div class={styles.message}>没有找到指标</div>;
    };

    return () => {
      const multiple = props.variant === 'calculation';
      const loading = state.value.kind === 'loading' || (state.value.kind === 'ready' && state.value.refreshing);
      return (
        <div class={styles.root}>
          <div class={styles.head}>
            <MxTitle description={multiple ? '可多选' : '单选'}>
              {{
                default: () => '选择指标',
                extra: () => [
                  <ElButton
                    link
                    type="primary"
                    icon={Refresh}
                    disabled={state.value.kind === 'waiting' || loading}
                    onClick={props.tree.refresh}
                  >
                    刷新
                  </ElButton>,
                  multiple && (
                    <ElCheckbox
                      class={styles.all}
                      modelValue={enabled.value.length > 0 && checkedCount.value === enabled.value.length}
                      indeterminate={checkedCount.value > 0 && checkedCount.value < enabled.value.length}
                      disabled={enabled.value.length === 0}
                      onChange={value => props.tree.toggleAll(value === true)}
                    >
                      全选
                    </ElCheckbox>
                  )
                ]
              }}
            </MxTitle>
          </div>
          <ElRadioGroup
            class={styles.categories}
            modelValue={props.tree.category.value}
            size="small"
            onUpdate:modelValue={value => props.tree.setCategory(value as IndicatorCategory)}
          >
            {INDICATOR_CATEGORIES.map(({ id, label }) => (
              <ElRadioButton key={id} value={id}>
                {label}
              </ElRadioButton>
            ))}
          </ElRadioGroup>
          <ElInput
            class={styles.search}
            modelValue={keyword.value}
            clearable
            prefixIcon={Search}
            placeholder="搜索指标"
            onUpdate:modelValue={(value: string) => (keyword.value = value)}
          />
          <div class={styles.body} v-loading={showMask.value}>
            {renderBody()}
          </div>
        </div>
      );
    };
  }
});
