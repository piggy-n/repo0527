import { Close, Search } from '@element-plus/icons-vue';
import { ElButton, ElInput, ElSpace } from 'element-plus';
import { useMapOverlay } from '@yzt/map-vue';
import { computed, defineComponent, type PropType, ref } from 'vue';
import { useDelayedFlag } from '../../composables/useDelayedFlag';
import {
  districtsOf,
  JIANGSU_CITIES,
  type Region,
  regionPath,
  searchRegions,
  shortRegionName
} from './region-catalog';
import { nextRegionSelection, type RegionLocate } from './useRegionLocate';
import styles from './RegionLocatePanel.module.scss';

/**
 * 区划定位的面板（联调用的界面，5D 再设计；ADR 0036）：显示 useRegionLocate 的状态并调用它的操作。
 * 会挡住定位，登记为贴右边的悬浮元素（ADR 0029）；关闭面板不清掉选择
 */
export const RegionLocatePanel = defineComponent({
  name: 'RegionLocatePanel',
  props: {
    region: { type: Object as PropType<RegionLocate>, required: true }
  },
  emits: {
    close: () => true
  },
  setup(props, { emit }) {
    const element = ref<HTMLElement>();
    useMapOverlay(element, 'right');

    const keyword = ref('');
    const results = computed(() => searchRegions(keyword.value));
    const loading = useDelayedFlag(() => props.region.state.value.boundary.kind === 'loading');

    // 列表里的市、区县按旧项目的规则切换；搜索结果直接选中
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
          <div class={styles.status}>
            边界加载失败
            <ElButton link type="primary" onClick={props.region.retry}>
              重试
            </ElButton>
          </div>
        );
      }
      return loading.value && <div class={styles.status}>正在加载边界…</div>;
    };

    return () => {
      const { selected } = props.region.state.value;
      return (
        <div ref={element} class={styles.panel} data-region-locate-panel>
          <div class={styles.header}>
            <span class={styles.title}>区划定位</span>
            <span class={styles.current}>{selected ? regionPath(selected) : '全省'}</span>
            <ElButton link icon={Close} aria-label="关闭区划定位" onClick={() => emit('close')} />
          </div>
          <ElSpace wrap size={6}>
            {JIANGSU_CITIES.map(city => (
              <ElButton
                key={city.code}
                size="small"
                type={selected?.cityCode === city.code ? 'primary' : 'default'}
                onClick={() => toggle(city)}>
                {shortRegionName(city.name)}
              </ElButton>
            ))}
          </ElSpace>
          <div class={styles.search}>
            <ElInput
              modelValue={keyword.value}
              clearable
              placeholder="请输入城市名或区县名"
              onUpdate:modelValue={(value: string) => (keyword.value = value)}
              onKeydown={(event: KeyboardEvent | Event) => {
                if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.isComposing) {
                  chooseFirst();
                }
              }}
            />
            <ElButton type="primary" icon={Search} onClick={chooseFirst}>
              搜索
            </ElButton>
          </div>
          {results.value.length > 0 && (
            <ul class={styles.results}>
              {results.value.map(region => (
                <li key={region.code}>
                  <ElButton link onClick={() => choose(region)}>
                    {regionPath(region)}
                  </ElButton>
                </li>
              ))}
            </ul>
          )}
          {selected && (
            <ElSpace wrap size={6}>
              {districtsOf(selected.cityCode).map(district => (
                <ElButton
                  key={district.code}
                  size="small"
                  type={selected.code === district.code ? 'primary' : 'default'}
                  onClick={() => toggle(district)}>
                  {district.name}
                </ElButton>
              ))}
            </ElSpace>
          )}
          {renderStatus()}
        </div>
      );
    };
  }
});
