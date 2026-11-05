import { RefreshLeft, Search } from '@element-plus/icons-vue';
import { MxPanel, MxTitle } from '@yzt/ui';
import { ElButton, ElCheckbox, ElInput, ElRadioButton, ElRadioGroup, ElTag } from 'element-plus';
import { computed, defineComponent, type PropType, ref, type VNodeChild } from 'vue';
import type { CategoryId } from '@/shared/city-indicators/catalog';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { JIANGSU_CITIES, shortRegionName } from '@/shared/map/region/region-catalog';
import { rememberedScopes, searchIndicators, SIMULATION_YEARS } from '../compose/composition';
import type { CompositionOwner } from '../composables/useComposition';
import type { ConditionDrag, DragItem } from '../composables/useConditionDrag';
import type { ScopeEditor } from '../composables/useScopeEditor';
import { INDICATOR_GROUPS, reachText, type SimulationIndicator } from '../model/indicators';
import type { ScopeArea } from '../model/scope';
import { areaBrief } from '../scope/area-tree';
import { AreaFilePicker } from './AreaFilePicker';
import { AreaThumbnail } from './AreaThumbnail';
import styles from './ConditionLibrary.module.scss';

const indicatorTitle = (item: SimulationIndicator) => `${item.name}（${item.unit}）${item.id} · ${reachText(item)}`;

const chipKey = (item: DragItem): string => {
  switch (item.kind) {
    case 'years':
      return `years:${item.year}`;
    case 'region':
      return `region:${item.code}`;
    case 'indicators':
      break;
  }
  return `indicators:${item.id}`;
};

// 一个模块：区块标题、右侧的补充，下面是内容；间距比 MxSection 紧凑，指标模块撑满剩余高度
const section = (title: VNodeChild, extra: VNodeChild, content: VNodeChild, fill = false) => (
  <section class={[styles.section, fill && styles.fill]}>
    <MxTitle>{{ default: () => title, extra: () => extra }}</MxTitle>
    {content}
  </section>
);

/**
 * 指标计算条件：年度、城市、指标都可以点选，也可以拖到编排图上；年度和范围固定在上面，只有指标列表滚动。
 * 监测范围分行政区划和自定义范围（ADR 0121）：自定义范围在这里上传、绘制，有了以后是范围卡片
 */
export const ConditionLibrary = defineComponent({
  name: 'ConditionLibrary',
  props: {
    composition: { type: Object as PropType<CompositionOwner>, required: true },
    drag: { type: Object as PropType<ConditionDrag>, required: true },
    editor: { type: Object as PropType<ScopeEditor>, required: true },
    /** 对话发起的配置还缺范围：标出"待补充"，提示可以在这里选（ADR 0129） */
    pendingScope: { type: Boolean, default: false }
  },
  setup(props) {
    const keyword = ref('');
    const folded = ref<ReadonlySet<CategoryId>>(new Set());
    const toggleFold = (id: CategoryId) => {
      const next = new Set(folded.value);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      folded.value = next;
    };

    const groups = computed(() => {
      const matched = new Set(searchIndicators(keyword.value).map(item => item.id));
      return INDICATOR_GROUPS.map(({ id, name, indicators }) => ({
        id,
        name,
        items: indicators.filter(item => matched.has(item.id))
      })).filter(group => group.items.length > 0);
    });

    const chip = (item: DragItem, pressed: boolean, onClick: () => void, content: VNodeChild, title?: string) => (
      <button
        key={chipKey(item)}
        type="button"
        class={styles.chip}
        draggable="true"
        aria-pressed={pressed}
        title={title}
        onClick={onClick}
        onDragstart={event => props.drag.start(item, event)}
        onDragend={() => props.drag.end()}
      >
        {content}
      </button>
    );

    const renderYears = () => {
      const { composition } = props;
      const { years } = composition.state.value.conditions;
      return (
        <div class={[styles.grid, styles.years]}>
          {SIMULATION_YEARS.map(year =>
            chip({ kind: 'years', year }, years.includes(year), () => composition.toggleYear(year), year)
          )}
        </div>
      );
    };

    const renderCities = () => {
      const { composition } = props;
      const { cityCodes } = rememberedScopes(composition.state.value);
      return (
        <div key="cities" class={[styles.grid, styles.cities, props.pendingScope && styles.glow]}>
          {JIANGSU_CITIES.map(city =>
            chip(
              { kind: 'region', code: city.code },
              cityCodes.includes(city.code),
              () => composition.toggleCity(city.code),
              shortRegionName(city.name),
              city.name
            )
          )}
        </div>
      );
    };

    // 自定义范围：还没有时是上传、绘制两个入口，有了是范围卡片；高度和三行城市接近，切换时下面的指标不跳
    const renderArea = (area: ScopeArea | null) => {
      const { composition, editor } = props;
      const upload = (files: File[]) => editor.start('upload', { files });
      if (!area) {
        return (
          <div key="entries" class={[styles.entries, props.pendingScope && styles.glow]}>
            <AreaFilePicker onPick={upload}>
              {{
                default: ({ open }: { readonly open: () => void }) => (
                  <button type="button" class={styles.entry} onClick={open}>
                    <SvgIcon name="file-upload" />
                    上传文件
                  </button>
                )
              }}
            </AreaFilePicker>
            <button type="button" class={styles.entry} onClick={() => editor.start('draw')}>
              <SvgIcon name="geometry-polygon" />
              地图绘制
            </button>
            <p class={styles.entryNote}>支持 GeoJSON、Shapefile（.zip），坐标系为 CGCS2000 或 WGS84</p>
          </div>
        );
      }
      const brief = areaBrief(area);
      return (
        <div key="card" class={styles.areaCard}>
          <AreaThumbnail outline={area.outline} size={64} />
          <div class={styles.areaInfo}>
            <div class={styles.areaName}>
              <span title={area.name}>{area.name}</span>
              <ElTag class="tag-mini" disableTransitions>
                {area.source === 'upload' ? '上传' : '绘制'}
              </ElTag>
            </div>
            <span class={styles.areaMeta}>{brief.where}</span>
            <span class={styles.areaMeta}>{brief.size}</span>
            <div class={styles.areaActions}>
              <ElButton link type="primary" onClick={() => editor.start('edit', { area })}>
                编辑范围
              </ElButton>
              <AreaFilePicker onPick={upload}>
                {{
                  default: ({ open }: { readonly open: () => void }) => (
                    <ElButton link type="primary" onClick={open}>
                      重新上传
                    </ElButton>
                  )
                }}
              </AreaFilePicker>
              <ElButton link type="danger" onClick={() => composition.setArea(null)}>
                移除
              </ElButton>
            </div>
          </div>
        </div>
      );
    };

    const renderScope = () => {
      const { composition } = props;
      const { scope } = composition.state.value.conditions;
      return [
        <ElRadioGroup
          key="kind"
          class="radio-group-block"
          size="small"
          modelValue={scope.kind}
          aria-label="监测范围的种类"
          onUpdate:modelValue={value => {
            if (value === 'cities' || value === 'area') {
              composition.setScopeKind(value);
            }
          }}
        >
          <ElRadioButton value="cities">行政区划</ElRadioButton>
          <ElRadioButton value="area">自定义范围</ElRadioButton>
        </ElRadioGroup>,
        scope.kind === 'cities' ? renderCities() : renderArea(scope.area)
      ];
    };

    const renderIndicators = () => {
      const { composition } = props;
      const { indicatorIds } = composition.state.value.conditions;
      const searching = keyword.value.trim() !== '';
      return [
        <ElInput
          key="search"
          class={styles.search}
          modelValue={keyword.value}
          placeholder="搜索指标名称或编码"
          aria-label="搜索指标"
          prefixIcon={Search}
          clearable
          onUpdate:modelValue={(value: string) => (keyword.value = value)}
        />,
        <div key="list" class={styles.list}>
          {groups.value.length === 0 && <p class={styles.empty}>没有匹配的指标</p>}
          {groups.value.map(group => {
            const open = searching || !folded.value.has(group.id);
            const picked = group.items.filter(item => indicatorIds.includes(item.id)).length;
            return (
              <div key={group.id} class={styles.group}>
                <button
                  type="button"
                  class={styles.groupHead}
                  aria-expanded={open}
                  disabled={searching}
                  onClick={() => toggleFold(group.id)}
                >
                  <span class={styles.caret} />
                  {group.name}
                  <span class={styles.count}>
                    {picked}/{group.items.length}
                  </span>
                </button>
                {open && (
                  <div class={[styles.grid, styles.indicators]}>
                    {group.items.map(item =>
                      chip(
                        { kind: 'indicators', id: item.id },
                        indicatorIds.includes(item.id),
                        () => composition.toggleIndicator(item.id),
                        <span class={styles.name}>{item.short}</span>,
                        indicatorTitle(item)
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ];
    };

    return () => {
      const { composition } = props;
      const { indicatorIds, scope } = composition.state.value.conditions;
      const { cityCodes } = rememberedScopes(composition.state.value);
      const all = cityCodes.length === JIANGSU_CITIES.length;
      return (
        <MxPanel class={styles.panel} title="指标计算条件" headerTone="muted" flush>
          {{
            actions: () => (
              <ElButton link type="primary" icon={RefreshLeft} onClick={() => composition.reset()}>
                重置条件
              </ElButton>
            ),
            default: () => (
              <div class={styles.body}>
                {section('监测年份', <span class={styles.extra}>可多选</span>, renderYears())}
                {section(
                  props.pendingScope
                    ? [
                        '监测范围',
                        <ElTag key="pending" class={['tag-mini', styles.pendingTag]} type="warning" disableTransitions>
                          待补充
                        </ElTag>
                      ]
                    : '监测范围',
                  scope.kind === 'cities' && (
                    <ElCheckbox
                      modelValue={all}
                      indeterminate={cityCodes.length > 0 && !all}
                      onChange={value => composition.setAllCities(value === true)}
                    >
                      全省
                    </ElCheckbox>
                  ),
                  renderScope()
                )}
                {section('监测指标', <span class={styles.extra}>已选 {indicatorIds.length}</span>, renderIndicators(), true)}
              </div>
            )
          }}
        </MxPanel>
      );
    };
  }
});
