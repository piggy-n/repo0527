import { Search } from '@element-plus/icons-vue';
import { MxTitle } from '@yzt/ui';
import { ElButton, ElInput, ElRadioButton, ElRadioGroup, ElTag, ElTooltip } from 'element-plus';
import { computed, defineComponent, type PropType, ref, type VNodeChild, watch } from 'vue';
import { ChatAvatar } from '@/shared/chat-avatar/ChatAvatar';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import type { CoverRelation } from '@/shared/map/area/area-coverage';
import { AREA_LIMITS } from '@/shared/map/area/area-geometry';
import { shortRegionName } from '@/shared/map/region/region-catalog';
import type { AnalysisStep, ScopeAnalysis, ScopeEditor } from '../composables/useScopeEditor';
import {
  type CityCover,
  type CoverFilter,
  type CoverMeasure,
  type CoverageTree,
  coverCounts,
  coverDetail,
  type DistrictCover,
  expandAllByDefault,
  filterTree,
  formatKm2
} from '../scope/area-tree';
import styles from './AreaAnalysisPanel.module.scss';

const RELATION_TEXT: Readonly<Record<CoverRelation, string>> = { full: '全部覆盖', partial: '部分覆盖' };

// 一行的标签：有部分覆盖时是橙色；行里只写面积，占比在悬浮提示里
const coverTag = (text: string, partial: boolean, measure: CoverMeasure) => (
  <ElTooltip content={coverDetail(measure)} placement="top">
    <ElTag class={['tag-mini', styles.tag]} type={partial ? 'warning' : 'primary'} disableTransitions>
      {text}
    </ElTag>
  </ElTooltip>
);

const renderArea = (area: number) => <span class={styles.measure}>{formatKm2(area)} km²</span>;

// 区县多于这个数时出现搜索框
const SEARCH_FROM = 8;

interface Stat {
  readonly label: string;
  readonly value: VNodeChild;
  readonly note: string | undefined;
}

const renderStep = (step: AnalysisStep, index: number) => (
  <li key={index} class={[styles.step, styles[step.state]]}>
    <span class={styles.dot} aria-hidden="true">
      {step.state === 'done' && <SvgIcon name="check" />}
    </span>
    <span class={styles.stepText}>
      {step.label}
      {step.detail && <small>{step.detail}</small>}
    </span>
  </li>
);

const renderEmpty = () => (
  <div class={styles.empty}>
    <ChatAvatar speaker="assistant" size={56} />
    <p>上传范围文件，或用地图左上角的工具绘制范围</p>
    <small>
      AI 会分析范围涉及的省、市、县，判断全部覆盖还是部分覆盖，并统计面积。
      支持 GeoJSON（.geojson、.json）和 Shapefile（.zip 压缩包，或同时选择 .shp、.dbf、.prj），
      坐标系为 CGCS2000 或 WGS84；文件不超过 {AREA_LIMITS.fileBytes / 1024 / 1024} MB，也可以把文件拖到地图上。
    </small>
  </div>
);

/**
 * AI 范围分析（ADR 0121）：分步的进度；完成后是摘要、四个数、提示和按省、市、县分级的列表——
 * 区县多时先只列各市，点开再看区县；可以按覆盖方式筛选、按名称搜索。悬停区县时地图描出它，点击移过去
 */
export const AreaAnalysisPanel = defineComponent({
  name: 'AreaAnalysisPanel',
  props: {
    editor: { type: Object as PropType<ScopeEditor>, required: true }
  },
  setup(props) {
    const filter = ref<CoverFilter>('all');
    const keyword = ref('');
    const expanded = ref<ReadonlySet<string>>(new Set());
    const touchesOpen = ref(false);

    const tree = computed((): CoverageTree | null => {
      const analysis = props.editor.analysis.value;
      return analysis.status === 'done' ? analysis.tree : null;
    });
    // 换了一次分析：筛选、搜索复位，市和区县少时全部展开；编辑已有的范围时打开就有分析
    watch(
      tree,
      next => {
        filter.value = 'all';
        keyword.value = '';
        touchesOpen.value = false;
        expanded.value = next && expandAllByDefault(next) ? new Set(next.cities.map(city => city.code)) : new Set();
      },
      { immediate: true }
    );
    const cities = computed(() => (tree.value ? filterTree(tree.value, filter.value, keyword.value) : []));
    const searching = computed(() => keyword.value.trim() !== '' || filter.value !== 'all');

    const toggleCity = (code: string) => {
      const next = new Set(expanded.value);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      expanded.value = next;
    };

    const renderFailed = (message: string, retryable: boolean) => {
      const { editor } = props;
      return (
        <div class={styles.failure} role="alert">
          <SvgIcon class={styles.failureIcon} name="status-error" />
          <div>
            <p>{message}</p>
            <div class={styles.failureActions}>
              {retryable && (
                <ElButton link type="primary" onClick={editor.retry}>
                  重试
                </ElButton>
              )}
              {editor.canUndo.value && (
                <ElButton link type="primary" onClick={editor.undo}>
                  撤销，回到上一个范围
                </ElButton>
              )}
            </div>
          </div>
        </div>
      );
    };

    const renderDistrict = (district: DistrictCover) => {
      const { editor } = props;
      return (
        <li key={district.code} class={styles.treeItem}>
          <button
            type="button"
            class={[styles.row, styles.districtRow, editor.hovered.value === district.code && styles.lit]}
            aria-label={`${district.name}，${RELATION_TEXT[district.relation]}，${coverDetail(district)}，移到这里`}
            onMouseenter={() => editor.hover(district.code)}
            onFocus={() => editor.hover(district.code)}
            onClick={() => editor.focusDistrict(district.code)}
          >
            {/* 提示写在名称上：写在整行上会和标签的悬浮提示同时出现 */}
            <span class={styles.name} title={`移到${district.name}`}>
              {district.name}
            </span>
            {coverTag(RELATION_TEXT[district.relation].slice(0, 2), district.relation === 'partial', district)}
            {renderArea(district.area)}
          </button>
        </li>
      );
    };

    const renderCity = (city: CityCover) => {
      const open = searching.value || expanded.value.has(city.code);
      return (
        <li key={city.code} class={styles.treeItem}>
          <button
            type="button"
            class={[styles.row, styles.cityRow]}
            aria-expanded={open}
            aria-label={`${city.name}，${RELATION_TEXT[city.relation]}，涉及区县${coverCounts(city)}，${coverDetail(city)}`}
            disabled={searching.value}
            onClick={() => toggleCity(city.code)}
          >
            <span class={styles.cityName}>
              <span class={[styles.caret, open && styles.caretOpen]} aria-hidden="true" />
              <span class={styles.name}>{city.name}</span>
            </span>
            {coverTag(coverCounts(city), city.partial > 0, city)}
            {renderArea(city.area)}
          </button>
          {open && <ul class={styles.districts}>{city.districts.map(renderDistrict)}</ul>}
        </li>
      );
    };

    const renderTree = (current: CoverageTree) => {
      const total = current.full + current.partial;
      const list = cities.value;
      return (
        <section class={styles.tree} onMouseleave={() => props.editor.hover(null)}>
          {/* 标题、筛选和搜索在列表滚动时停在顶上 */}
          <div class={styles.treeTools}>
            <MxTitle>
              {{ default: () => '涉及的行政区', extra: () => <span class={styles.hint}>范围内面积</span> }}
            </MxTitle>
            <ElRadioGroup
              class="radio-group-block"
              size="small"
              modelValue={filter.value}
              aria-label="按覆盖方式筛选"
              onUpdate:modelValue={value => {
                if (value === 'all' || value === 'full' || value === 'partial') {
                  filter.value = value;
                }
              }}
            >
              <ElRadioButton value="all">全部 {total}</ElRadioButton>
              <ElRadioButton value="full" disabled={current.full === 0}>
                全部覆盖 {current.full}
              </ElRadioButton>
              <ElRadioButton value="partial" disabled={current.partial === 0}>
                部分覆盖 {current.partial}
              </ElRadioButton>
            </ElRadioGroup>
            {total > SEARCH_FROM && (
              <ElInput
                class={styles.search}
                size="small"
                modelValue={keyword.value}
                placeholder="搜索市、区县名称"
                aria-label="搜索市、区县"
                prefixIcon={Search}
                clearable
                onUpdate:modelValue={(value: string) => (keyword.value = value)}
              />
            )}
          </div>
          <div class={styles.rows}>
            <div class={[styles.row, styles.provinceRow]}>
              <span class={styles.name}>江苏省</span>
              {coverTag(coverCounts(current), current.partial > 0, current.province)}
              {renderArea(current.province.area)}
            </div>
            {list.length > 0 ? (
              <ul class={styles.cities}>{list.map(renderCity)}</ul>
            ) : (
              <p class={styles.none}>没有符合条件的区县</p>
            )}
          </div>
          {current.touches.length > 0 && (
            <div class={styles.touches}>
              <ElButton
                link
                type="info"
                aria-expanded={touchesOpen.value}
                onClick={() => (touchesOpen.value = !touchesOpen.value)}
              >
                只与边界相交、不算覆盖的区县 {current.touches.length} 个
              </ElButton>
              {touchesOpen.value && <p>{current.touches.map(item => item.name).join('、')}</p>}
            </div>
          )}
        </section>
      );
    };

    const renderDone = (done: Extract<ScopeAnalysis, { status: 'done' }>) => {
      const { summary, notices, tree: current, coverage, population } = done;
      const total = current.full + current.partial;
      const people = population.toLocaleString('zh-CN', { maximumFractionDigits: population >= 10 ? 0 : 1 });
      const cityNames = current.cities.map(city => shortRegionName(city.name));
      // 每个数下面一行小字补充说明，卡片等高、不折行
      const stats: readonly Stat[] = [
        {
          label: '范围面积',
          value: [<b key="v">{formatKm2(coverage.area)}</b>, ' km²'],
          note: coverage.outsideArea > 0 ? `省内 ${formatKm2(coverage.coveredArea)} km²` : undefined
        },
        {
          label: '涉及区县',
          value: [<b key="v">{total}</b>, ' 个'],
          note: `全部 ${current.full} · 部分 ${current.partial}`
        },
        {
          label: '涉及市',
          value: [<b key="v">{current.cities.length}</b>, ' 个'],
          note: cityNames.length <= 3 ? cityNames.join('、') : undefined
        },
        {
          label: '估算常住人口',
          value: ['≈', <b key="v">{people}</b>, ' 万人'],
          note: current.partial > 0 ? '部分覆盖按面积折算' : undefined
        }
      ];
      return [
        <div key="summary" class={styles.summary}>
          <ChatAvatar speaker="assistant" size={24} />
          <p>{summary}</p>
        </div>,
        <dl key="stats" class={styles.stats}>
          {stats.map(({ label, value, note }) => (
            <div key={label} class={styles.stat}>
              <dt>{label}</dt>
              <dd>{value}</dd>
              {note && <dd class={styles.note}>{note}</dd>}
            </div>
          ))}
        </dl>,
        notices.length > 0 && (
          <ul key="notices" class={styles.notices}>
            {notices.map(notice => (
              <li key={notice}>
                <SvgIcon name="status-warning" />
                {notice}
              </li>
            ))}
          </ul>
        ),
        <div key="tree">{renderTree(current)}</div>
      ];
    };

    return () => {
      const analysis = props.editor.analysis.value;
      const state = { empty: '', running: '分析中…', done: '分析完成', failed: '不能使用' }[analysis.status];
      let body: VNodeChild;
      switch (analysis.status) {
        case 'empty':
          body = renderEmpty();
          break;
        case 'running':
          body = <ol class={styles.steps}>{analysis.steps.map(renderStep)}</ol>;
          break;
        case 'failed':
          body = [
            analysis.steps.length > 0 && (
              <ol key="steps" class={styles.steps}>
                {analysis.steps.map(renderStep)}
              </ol>
            ),
            <div key="failure">{renderFailed(analysis.message, analysis.retryable)}</div>
          ];
          break;
        case 'done':
          body = renderDone(analysis);
          break;
      }
      return (
        <aside class={styles.panel} aria-label="AI 范围分析" aria-busy={analysis.status === 'running'}>
          <header class={styles.head}>
            <ChatAvatar speaker="assistant" size={24} />
            <h3>AI 范围分析</h3>
            <span class={styles.state} aria-live="polite">
              {state}
            </span>
          </header>
          <div class={styles.body}>{body}</div>
        </aside>
      );
    };
  }
});
