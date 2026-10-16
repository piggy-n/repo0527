import { Search } from '@element-plus/icons-vue';
import { ElInput } from 'element-plus';
import { computed, defineComponent, type PropType, ref, type VNode } from 'vue';
import { useDelayedFlag } from '../../composables/useDelayedFlag';
import {
  districtsOf,
  JIANGSU_CITIES,
  parentCityName,
  type Region,
  regionPath,
  searchRegions,
  shortRegionName
} from './region-catalog';
import { RegionTrail } from './RegionTrail';
import { nextRegionSelection, type RegionLocate } from './useRegionLocate';
import styles from './RegionLocatePanel.module.scss';

// 名称里第一次出现的关键字标出来；搜索按路径包含关键字，关键字也可能只在所属的市名里
function marked(text: string, keyword: string): (VNode | string)[] {
  const index = keyword ? text.indexOf(keyword) : -1;
  if (index < 0) {
    return [text];
  }
  return [text.slice(0, index), <mark>{keyword}</mark>, text.slice(index + keyword.length)];
}

/**
 * 区划定位的内容（ADR 0036，设计稿 5D.4）：搜索、当前位置、市和区县的格子，显示 useRegionLocate 的状态并调用它的操作。
 * 放在功能面板的 Tab 里，标题、关闭和悬浮元素的登记由外壳负责（ADR 0053 第 4 节）；关闭不清掉选择
 */
export const RegionLocatePanel = defineComponent({
  name: 'RegionLocatePanel',
  props: {
    region: { type: Object as PropType<RegionLocate>, required: true }
  },
  setup(props) {
    const keyword = ref('');
    const results = computed(() => searchRegions(keyword.value));
    const loading = useDelayedFlag(() => props.region.state.value.boundary.kind === 'loading');

    // 格子按旧项目的规则切换；当前位置和搜索结果直接选中
    const toggle = (clicked: Region) => {
      props.region.select(nextRegionSelection(props.region.state.value.selected, clicked));
    };
    const choose = (region: Region) => {
      keyword.value = '';
      props.region.select(region.code);
    };
    const chooseFirst = () => {
      const [first] = results.value;
      if (first) {
        choose(first);
      }
    };

    const renderStatus = () => {
      const { boundary } = props.region.state.value;
      if (boundary.kind === 'failed') {
        return (
          <span class={[styles.status, styles.failed]}>
            边界加载失败
            <button type="button" class={styles.retry} onClick={props.region.retry}>
              重试
            </button>
          </span>
        );
      }
      return loading.value && <span class={styles.status}>正在加载边界…</span>;
    };

    // 江苏省 › 南京市 › 江宁区：前面几级可以点，回到全省或回到市（和地图上方的区划条共用）
    const renderTrail = () => (
      <div class={styles.trail}>
        <RegionTrail class={styles.crumbs} region={props.region} />
        {renderStatus()}
      </div>
    );

    const renderChips = (regions: readonly Region[], selectedCode: string | null | undefined, short: boolean) => (
      <div class={styles.chips}>
        {regions.map(region => {
          const on = region.code === selectedCode;
          return (
            <button
              key={region.code}
              type="button"
              class={[styles.chip, on && styles.chipOn]}
              aria-pressed={on}
              onClick={() => toggle(region)}>
              {short ? shortRegionName(region.name) : region.name}
            </button>
          );
        })}
      </div>
    );

    const renderResults = () =>
      results.value.length === 0 ? (
        <div class={styles.empty}>没有找到"{keyword.value.trim()}"</div>
      ) : (
        <ul class={styles.results}>
          {results.value.map((region, index) => (
            <li key={region.code}>
              <button
                type="button"
                class={[styles.result, index === 0 && styles.first]}
                aria-label={regionPath(region)}
                onClick={() => choose(region)}>
                <span>{marked(region.name, keyword.value.trim())}</span>
                <span class={styles.parent}>{marked(parentCityName(region) ?? '', keyword.value.trim())}</span>
              </button>
            </li>
          ))}
        </ul>
      );

    return () => {
      const { selected } = props.region.state.value;
      const city = selected && JIANGSU_CITIES.find(item => item.code === selected.cityCode);
      return (
        <div class={styles.panel} data-region-locate-panel>
          <ElInput
            modelValue={keyword.value}
            prefixIcon={Search}
            clearable
            placeholder="搜索市、区县"
            aria-label="搜索市、区县"
            onUpdate:modelValue={(value: string) => (keyword.value = value)}
            onKeydown={(event: KeyboardEvent | Event) => {
              if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.isComposing) {
                chooseFirst();
              }
            }}
          />
          {keyword.value.trim()
            ? renderResults()
            : [
                renderTrail(),
                <div class={styles.groupLabel}>设区市</div>,
                renderChips(JIANGSU_CITIES, selected?.cityCode, true),
                city && [
                  <div class={styles.groupLabel}>{city.name}的区县</div>,
                  renderChips(districtsOf(city.code), selected?.code, false)
                ]
              ]}
        </div>
      );
    };
  }
});
