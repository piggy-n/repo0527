import { ArrowDown, ArrowRight, ArrowUp, Expand, Fold, Operation, Search } from '@element-plus/icons-vue';
import { useMap, useMapOverlay } from '@yzt/map-vue';
import { ElButton, ElCheckbox, ElInput, ElOption, ElSelect, ElSlider } from 'element-plus';
import { computed, defineComponent, type PropType, ref, type VNode, watch } from 'vue';
import type { ResourceLayers } from '../composables/useResourceLayers';
import {
  type CheckedLayer,
  checkedLayers,
  expandedByDefault,
  moveTarget,
  type PanelNode,
  panelTree
} from '../layer-panel';
import { batchYearOptions } from '../resource-layers';
import { resourceNotices } from '../resource-notices';
import styles from './ResourceLayerPanel.module.scss';

// 集合里有这一项就去掉，没有就加上，返回新的集合
function toggle(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(key)) {
    next.add(key);
  }
  return next;
}

/**
 * 资源图层面板（5C.2，联调用的界面，5D 再设计）：目录树负责浏览和勾选，按目录顺序；"已勾选"按叠放顺序列出，
 * 在这里调整顺序、透明度和年份。只显示 useResourceLayers 的状态并调用它的操作；会挡住定位，登记为贴左边的悬浮元素
 */
export const ResourceLayerPanel = defineComponent({
  name: 'ResourceLayerPanel',
  props: {
    layers: { type: Object as PropType<ResourceLayers>, required: true },
    /** 目录加载失败；已经有目录时照常显示它 */
    failed: { type: Boolean, default: false },
    /** 显示为收起：用户收起了，或窄屏时让给右边（ADR 0053 第 8 节），由页面决定 */
    collapsed: { type: Boolean, default: false }
  },
  emits: {
    retry: () => true,
    'update:collapsed': (collapsed: boolean) => typeof collapsed === 'boolean'
  },
  setup(props, { emit }) {
    const element = ref<HTMLElement>();
    useMapOverlay(element, 'left');
    const camera = useMap().useCamera();

    // 以下都是面板自己的界面状态
    const keyword = ref('');
    const expanded = ref<ReadonlySet<string>>(new Set());
    const opacityOpen = ref<ReadonlySet<string>>(new Set());

    const searching = computed(() => keyword.value.trim() !== '');
    const tree = computed(() => panelTree(props.layers.state.value, keyword.value));
    const layers = computed(() => checkedLayers(props.layers.state.value));
    const batchYears = computed(() => batchYearOptions(props.layers.state.value.catalog));

    // 目录第一次到达时展开含有勾选资源的分类；之后目录刷新不改用户的展开
    watch(
      () => props.layers.state.value.catalog,
      (catalog, previous) => {
        if (catalog && !previous) {
          expanded.value = expandedByDefault(panelTree(props.layers.state.value));
        }
      },
      { immediate: true }
    );

    const moveLayer = (code: string, direction: 'up' | 'down') => {
      const target = moveTarget(props.layers.state.value, code, direction);
      if (target !== null) {
        props.layers.move(code, target);
      }
    };

    // 滑块按百分比显示，拖动过程中实时生效
    const changeOpacity = (code: string, value: number | number[]) => {
      if (typeof value === 'number') {
        props.layers.setOpacity(code, value / 100);
      }
    };

    const renderNode = (node: PanelNode): VNode => {
      const { layers: owner } = props;
      if (node.kind === 'resource') {
        return (
          <li key={node.code} class={styles.row} data-resource={node.code}>
            <ElCheckbox
              modelValue={node.checked}
              onUpdate:modelValue={value => owner.setChecked(node.code, value === true)}>
              {node.name}
            </ElCheckbox>
            {owner.configErrors.value.has(node.code) && <span class={styles.notice}>配置错误</span>}
          </li>
        );
      }
      // 搜索时命中的路径都展开
      const open = searching.value || expanded.value.has(node.id);
      return (
        <li key={node.id} data-category={node.id}>
          <div class={styles.row}>
            <ElButton
              link
              icon={open ? ArrowDown : ArrowRight}
              aria-label={`${open ? '收起' : '展开'}${node.name}`}
              disabled={searching.value}
              onClick={() => (expanded.value = toggle(expanded.value, node.id))}
            />
            <ElCheckbox
              modelValue={node.checkState === 'all'}
              indeterminate={node.checkState === 'some'}
              onUpdate:modelValue={value => owner.setCheckedMany(node.codes, value === true)}>
              {node.name}
            </ElCheckbox>
            <span class={styles.count}>{node.codes.length}</span>
          </div>
          {open && <ul class={styles.children}>{node.children.map(renderNode)}</ul>}
        </li>
      );
    };

    const renderLayer = (layer: CheckedLayer): VNode => {
      const { layers: owner } = props;
      const state = owner.state.value;
      const display = state.displays.get(layer.code);
      const notices = resourceNotices({
        checked: display?.checked ?? false,
        configError: owner.configErrors.value.has(layer.code),
        tileError: owner.tileErrors.value.has(layer.code),
        minzoom: owner.minzoomOf(layer.code),
        zoom: camera.value.zoom
      });
      const showOpacity = opacityOpen.value.has(layer.code);
      return (
        <li key={layer.code} class={styles.layer} data-layer={layer.code}>
          <div class={styles.row}>
            <span class={styles.name}>{layer.name}</span>
            {layer.years.length > 1 ? (
              <ElSelect
                class={styles.year}
                size="small"
                modelValue={layer.year}
                aria-label={`${layer.name}的年份`}
                onUpdate:modelValue={(year: number) => owner.setYear(layer.code, year)}>
                {layer.years.map(year => (
                  <ElOption key={year} label={String(year)} value={year} />
                ))}
              </ElSelect>
            ) : (
              <span class={styles.year}>{layer.year}</span>
            )}
            <ElButton
              link
              icon={Operation}
              type={showOpacity ? 'primary' : 'default'}
              aria-label={`${layer.name}的透明度`}
              onClick={() => (opacityOpen.value = toggle(opacityOpen.value, layer.code))}
            />
            <ElButton
              link
              icon={ArrowUp}
              aria-label={`上移${layer.name}`}
              disabled={moveTarget(state, layer.code, 'up') === null}
              onClick={() => moveLayer(layer.code, 'up')}
            />
            <ElButton
              link
              icon={ArrowDown}
              aria-label={`下移${layer.name}`}
              disabled={moveTarget(state, layer.code, 'down') === null}
              onClick={() => moveLayer(layer.code, 'down')}
            />
          </div>
          {notices.map(notice => (
            <div key={notice} class={styles.notice}>
              {notice}
            </div>
          ))}
          {showOpacity && (
            <ElSlider
              class={styles.slider}
              size="small"
              modelValue={Math.round(layer.opacity * 100)}
              formatTooltip={(value: number) => `${value}%`}
              onUpdate:modelValue={value => changeOpacity(layer.code, value)}
            />
          )}
        </li>
      );
    };

    const renderBody = () => {
      if (!props.layers.state.value.catalog) {
        return props.failed ? (
          <div class={styles.status}>
            <span>资源目录加载失败</span>
            <ElButton size="small" onClick={() => emit('retry')}>
              重试
            </ElButton>
          </div>
        ) : (
          <div class={styles.status}>正在加载资源目录…</div>
        );
      }
      return (
        <>
          <ElInput
            modelValue={keyword.value}
            clearable
            prefixIcon={Search}
            placeholder="搜索资源或分类"
            onUpdate:modelValue={(value: string) => (keyword.value = value)}
          />
          {batchYears.value.length > 0 && (
            // 批量设置是一次操作（ADR 0052 第 2 节）：选完就执行、不保留选中值，所以连续两次选同一年也会执行
            <div class={styles.batch}>
              <ElSelect
                size="small"
                modelValue={undefined}
                placeholder="批量设置年份"
                aria-label="批量设置年份"
                onUpdate:modelValue={(year: number) => props.layers.setYearForAll(year)}>
                {batchYears.value.map(year => (
                  <ElOption key={year} label={`${year} 年`} value={year} />
                ))}
              </ElSelect>
              <span class={styles.hint}>没有这一年的资源保持不变</span>
            </div>
          )}
          <div class={styles.tree}>
            {tree.value.length > 0 ? (
              <ul class={styles.list}>{tree.value.map(renderNode)}</ul>
            ) : (
              <div class={styles.status}>没有找到资源</div>
            )}
          </div>
          <div class={styles.checked}>
            <div class={styles.sectionTitle}>
              已勾选 {layers.value.length}
              <span class={styles.hint}>靠上的画在上层</span>
            </div>
            {layers.value.length > 0 ? (
              <ul class={styles.list}>{layers.value.map(renderLayer)}</ul>
            ) : (
              <div class={styles.hint}>勾选资源后在这里调整叠放顺序和透明度</div>
            )}
          </div>
        </>
      );
    };

    return () => (
      <div ref={element} class={styles.panel} data-resource-layer-panel>
        <div class={styles.header}>
          <span class={styles.title}>资源图层</span>
          <ElButton
            link
            icon={props.collapsed ? Expand : Fold}
            aria-label={props.collapsed ? '展开资源图层' : '收起资源图层'}
            onClick={() => emit('update:collapsed', !props.collapsed)}
          />
        </div>
        {!props.collapsed && renderBody()}
      </div>
    );
  }
});
