import { Loading } from '@element-plus/icons-vue';
import { useVirtualList } from '@vueuse/core';
import { MxTitle } from '@yzt/ui';
import { ElIcon } from 'element-plus';
import { computed, defineComponent, type PropType, ref, type VNode, watch } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import { type IconName, SvgIcon } from '@/shared/icons/SvgIcon';
import type { FeatureRecord } from '../api';
import {
  BOX_ESTIMATE_LIMIT,
  featureLabel,
  type FeatureRow,
  featureRows,
  type PickCandidate
} from '../feature-query';
import { type CandidateList, type FeaturePick, hasMorePages, type MoreStatus } from '../composables/useFeaturePick';
import styles from './FeatureDetailPanel.module.scss';

// 候选列表每行的高度（像素），和样式里的一致；框选可能有几千行，只渲染看得见的（ADR 0049 第 4 节）
const CANDIDATE_HEIGHT = 34;

type NoticeTone = 'info' | 'warning' | 'error';

const NOTICE_ICONS: Readonly<Record<NoticeTone, IconName>> = { info: 'info', warning: 'warning', error: 'warning' };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误';
}

// 候选的数量：后端的有总数；框选用渲染要素的是松手时的快照，不说"共"（ADR 0049 第 2 节）
function countOf({ mode, candidates, pages }: CandidateList): string {
  if (pages) {
    return `共 ${pages.total} 个，已列出 ${candidates.length} 个`;
  }
  return mode === 'box' ? `地图上已画出的 ${candidates.length} 个` : `共 ${candidates.length} 个`;
}

// 提示条：说明、警告、出错，可以带一个操作（如重试）
function renderNotice(tone: NoticeTone, text: string, action?: { readonly label: string; readonly run: () => void }) {
  return (
    <div class={[styles.notice, styles[tone]]} role={tone === 'error' ? 'alert' : undefined} data-notice={tone}>
      <SvgIcon class={styles.noticeIcon} name={NOTICE_ICONS[tone]} size={14} />
      <span class={styles.noticeText}>{text}</span>
      {action && (
        <button type="button" class={styles.link} onClick={action.run}>
          {action.label}
        </button>
      )}
    </div>
  );
}

// 居中的状态：识别中、加载中、没有结果
function renderState(text: string, options: { readonly loading?: boolean; readonly hint?: string } = {}) {
  return (
    <div class={styles.state}>
      {options.loading && (
        <ElIcon class={['is-loading', styles.spinner]}>
          <Loading />
        </ElIcon>
      )}
      <span>{text}</span>
      {options.hint && <span class={styles.hint}>{options.hint}</span>}
    </div>
  );
}

// 标题（区块标题的规格）和下面一行灰色的说明；操作放在标题右边
function renderTitle(title: string, meta: string, actions: VNode[] = []) {
  return (
    <div class={styles.heading}>
      <MxTitle>
        {{
          default: () => <span title={title}>{title}</span>,
          extra: actions.length > 0 ? () => actions : undefined
        }}
      </MxTitle>
      <div class={styles.meta}>{meta}</div>
    </div>
  );
}

// 字段名表里没有的显示字段编码；没有值的显示灰色的 -
const renderRow = ({ key, label, value }: FeatureRow) => (
  <div key={key} class={styles.row}>
    <dt title={label ?? key}>{label ?? <span class={styles.code}>{key}</span>}</dt>
    <dd class={value === null && styles.dim} data-empty={value === null || undefined}>
      {value ?? '-'}
    </dd>
  </div>
);

/**
 * 点选的内容（设计稿 5D.6，ADR 0047 第 7 节）：识别中、没有结果、失败、候选列表、详情。
 * 状态和操作都在拥有者里，这里只显示和调用；独立外壳负责收起、关闭和悬浮登记（ADR 0070）
 */
export const FeatureDetailPanel = defineComponent({
  name: 'FeatureDetailPanel',
  props: {
    pick: { type: Object as PropType<FeaturePick>, required: true }
  },
  setup(props) {
    // 很快结束的识别和加载不显示提示（AGENTS.md"加载状态"）
    const identifying = useDelayedFlag(() => props.pick.state.value.kind === 'identifying');
    const candidates = computed(() => {
      const state = props.pick.state.value;
      return state.kind === 'candidates' ? state.list.candidates : [];
    });
    // 容器挂载、尺寸变化、列表变化、滚动时重新算可见的行，挂载后下一轮渲染才有行
    const { list: visible, containerProps, wrapperProps, scrollTo } = useVirtualList(candidates, {
      itemHeight: CANDIDATE_HEIGHT,
      overscan: 10
    });
    // 新一轮识别的列表从头显示，加载更多时列表的身份不变，不动滚动位置。
    // 单击、框选在同一轮调度里就出结果时面板不重新挂载，滚动容器还是上一轮的
    watch(
      () => {
        const state = props.pick.state.value;
        return state.kind === 'candidates' ? state.list.id : null;
      },
      (id, previous) => {
        if (id !== null && id !== previous) {
          scrollTo(0);
        }
      },
      { flush: 'post' }
    );
    // 虚拟列表把可见的行放在深层响应式里，行里的候选是代理；拥有者按对象身份确认候选，按序号取列表里的原对象
    const choose = (index: number) => {
      const candidate = candidates.value[index];
      if (candidate) {
        props.pick.choose(candidate);
      }
    };
    const detailLoading = useDelayedFlag(() => props.pick.detail.value?.kind === 'loading');
    // 没有值的字段默认收起；展开后换了要素仍展开，面板关闭时恢复
    const showEmpty = ref(false);

    const renderRows = (properties: Readonly<FeatureRecord>) => {
      const { filled, empty } = featureRows(properties);
      let summary = '';
      if (!showEmpty.value) {
        summary = filled.length > 0 ? `另有 ${empty.length} 个字段没有值` : `${empty.length} 个字段都没有值`;
      }
      return (
        <>
          <dl class={styles.rows}>{(showEmpty.value ? [...filled, ...empty] : filled).map(renderRow)}</dl>
          {empty.length > 0 && (
            <div class={styles.empties}>
              <span>{summary}</span>
              <button
                type="button"
                class={styles.link}
                aria-expanded={showEmpty.value}
                onClick={() => (showEmpty.value = !showEmpty.value)}
              >
                {showEmpty.value ? '收起没有值的字段' : '显示'}
              </button>
            </div>
          )}
        </>
      );
    };

    const renderMore = (list: CandidateList, more: MoreStatus) => {
      if (!hasMorePages(list.pages)) {
        return null;
      }
      if (more.kind === 'failed') {
        return renderNotice('error', `加载失败：${messageOf(more.error)}`, { label: '重试', run: props.pick.loadMore });
      }
      const loading = more.kind === 'loading';
      return (
        <div class={styles.more}>
          <button type="button" class={styles.link} disabled={loading} onClick={props.pick.loadMore}>
            {loading ? '正在加载…' : '加载更多'}
          </button>
        </div>
      );
    };

    const renderCandidates = (list: CandidateList, more: MoreStatus) => {
      const { mode, target, pages } = list;
      const { code, name } = target.resource;
      return (
        <>
          {renderTitle(mode === 'box' ? `框选 · ${name}` : name, `${target.year} · ${countOf(list)}`)}
          {mode === 'box' &&
            pages &&
            // 低级别的瓦片可能不带 guid，批量高亮匹配不到（docs/migration.md"框选的实测"）
            renderNotice('info', '低级别下地图上可能看不到高亮，放大到 14 级以上可以看到')}
          <div
            ref={containerProps.ref}
            class={styles.scroller}
            style={containerProps.style}
            onScroll={containerProps.onScroll}
          >
            <ul class={styles.candidates} style={wrapperProps.value.style}>
              {visible.value.map(({ data: candidate, index }) => {
                const label = featureLabel(code, candidate.properties);
                return (
                  <li key={candidate.key}>
                    <button type="button" class={styles.candidate} onClick={() => choose(index)}>
                      <span class={styles.index}>{index + 1}</span>
                      <span class={[styles.name, !label.name && styles.unnamed]}>{label.name ?? '未命名'}</span>
                      {label.category && <span class={styles.category}>{label.category}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          {renderMore(list, more)}
        </>
      );
    };

    const renderDetailBody = (candidate: PickCandidate) => {
      const status = props.pick.detail.value;
      switch (status?.kind) {
        case 'ready':
          return renderRows(status.detail.properties);
        case 'unsupported':
          return (
            <>
              {renderNotice('info', '这个资源暂不支持查询完整信息，下面是地图上的属性')}
              {renderRows(candidate.properties)}
            </>
          );
        case 'failed':
          return renderNotice('error', `详情加载失败：${messageOf(status.error)}`, {
            label: '重试',
            run: props.pick.retry
          });
        case 'loading':
        case undefined:
          break;
      }
      return detailLoading.value ? renderState('正在加载详情…', { loading: true }) : null;
    };

    const renderDetail = (candidate: PickCandidate, canGoBack: boolean) => {
      const status = props.pick.detail.value;
      const { resource, year } = candidate.target;
      // 详情到了用完整的属性，之前先用识别时拿到的
      const properties = status?.kind === 'ready' ? status.detail.properties : candidate.properties;
      const title = featureLabel(resource.code, properties).name ?? resource.name;
      const actions: VNode[] = [];
      if (canGoBack) {
        actions.push(
          <button type="button" class={styles.link} onClick={props.pick.back}>
            <SvgIcon name="arrow-left" size={12} />
            返回列表
          </button>
        );
      }
      // 不能查详情的资源没有完整几何，不能定位
      if (status?.kind !== 'unsupported') {
        actions.push(
          <button
            type="button"
            class={styles.iconButton}
            disabled={status?.kind !== 'ready'}
            aria-label="定位到要素"
            title="定位到要素"
            onClick={props.pick.locate}
          >
            <SvgIcon name="focus" size={16} />
          </button>
        );
      }
      return (
        <>
          {renderTitle(title, `${resource.name} · ${year}`, actions)}
          {renderDetailBody(candidate)}
        </>
      );
    };

    const renderContent = () => {
      const state = props.pick.state.value;
      switch (state.kind) {
        case 'idle':
          break;
        case 'identifying':
          return identifying.value ? renderState('正在识别…', { loading: true }) : null;
        case 'empty':
          return renderState('这里没有可查询的要素', { hint: '点在勾选的资源上，或放大地图后再点' });
        case 'failed': {
          const text = `${state.target?.resource.name ?? ''}识别失败：${messageOf(state.error)}`;
          return renderNotice('error', text, { label: '重试', run: props.pick.retry });
        }
        case 'too-many': {
          const { estimate, target } = state;
          const text = `框里约 ${estimate} 个${target.resource.name}，超过 ${BOX_ESTIMATE_LIMIT} 个，没有查询。请缩小框选范围后再试`;
          return renderNotice('warning', text);
        }
        case 'too-complex': {
          // ADR 0051 第 4 节：单击是线、点的容差框和区划求交，放大后容差框变小
          const { name } = state.target.resource;
          const text =
            state.mode === 'box'
              ? `这里的区划边界太复杂，没法和框选范围一起查询${name}。请缩小框选范围，或者放大地图后再试`
              : `这里的区划边界太复杂，没法和点击的位置一起查询${name}。请放大地图后再试`;
          return renderNotice('warning', text);
        }
        case 'candidates':
          return renderCandidates(state.list, state.more);
        case 'detail':
          return renderDetail(state.candidate, state.back !== null);
      }
      return null;
    };

    return () => (
      <div class={styles.panel} data-feature-detail-panel>
        {renderContent()}
      </div>
    );
  }
});
