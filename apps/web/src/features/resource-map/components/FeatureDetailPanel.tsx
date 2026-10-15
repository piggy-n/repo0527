import { Aim, ArrowLeft } from '@element-plus/icons-vue';
import { useVirtualList } from '@vueuse/core';
import { ElButton } from 'element-plus';
import { computed, defineComponent, type PropType, type VNode, watch } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import type { FeatureRecord } from '../api';
import { featureRows, featureSummary, type PickCandidate } from '../feature-query';
import { type CandidateList, type FeaturePick, hasMorePages, type MoreStatus } from '../composables/useFeaturePick';
import styles from './FeatureDetailPanel.module.scss';

// 候选列表每行的高度（像素），和样式里的一致；框选可能有几千行，只渲染看得见的（ADR 0049 第 4 节）
const CANDIDATE_HEIGHT = 30;

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

function renderRows(code: string, properties: Readonly<FeatureRecord>) {
  return (
    <dl class={styles.rows}>
      {featureRows(code, properties).map(row => (
        <div key={row.key} class={styles.row}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function renderHeader(title: string, subtitle?: string, extra?: VNode[]) {
  return (
    <div class={styles.header}>
      <div class={styles.heading}>
        <span class={styles.title}>{title}</span>
        {subtitle && <span class={styles.subtitle}>{subtitle}</span>}
      </div>
      {extra}
    </div>
  );
}

/**
 * 点选的内容（联调用的界面，5D 再设计；ADR 0047 第 7 节）：识别中、没有结果、失败、候选列表、详情。
 * 状态和操作都在拥有者里，这里只显示和调用；放在功能面板的"资源详情"里，关闭（清除选择）和登记由外壳和页面负责（ADR 0053 第 4 节）
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

    const renderMore = (list: CandidateList, more: MoreStatus) => {
      if (!hasMorePages(list.pages)) {
        return null;
      }
      if (more.kind === 'failed') {
        return (
          <div class={styles.notice}>
            <span class={styles.error}>加载失败：{messageOf(more.error)}</span>
            <ElButton link type="primary" onClick={props.pick.loadMore}>
              重试
            </ElButton>
          </div>
        );
      }
      return (
        <ElButton link type="primary" loading={more.kind === 'loading'} onClick={props.pick.loadMore}>
          加载更多
        </ElButton>
      );
    };

    const renderCandidates = (list: CandidateList, more: MoreStatus) => {
      const { mode, target, pages } = list;
      const title = mode === 'box' ? `框选 · ${target.resource.name}` : target.resource.name;
      return (
        <>
          {renderHeader(title, `${target.year} 年 · ${countOf(list)}`)}
          {mode === 'box' && pages && (
            // 低级别的瓦片可能不带 guid，批量高亮匹配不到（docs/migration.md"框选的实测"）
            <div class={styles.notice}>低级别下地图上可能看不到高亮，放大到 14 级以上可以看到</div>
          )}
          <div
            ref={containerProps.ref}
            class={styles.scroller}
            style={containerProps.style}
            onScroll={containerProps.onScroll}>
            <ul class={styles.candidates} style={wrapperProps.value.style}>
              {visible.value.map(({ data: candidate, index }) => (
                <li key={candidate.key}>
                  <button type="button" class={styles.candidate} onClick={() => choose(index)}>
                    {index + 1}. {featureSummary(target, candidate.properties).subtitle}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {renderMore(list, more)}
        </>
      );
    };

    const renderDetailBody = (candidate: PickCandidate) => {
      const status = props.pick.detail.value;
      const { code } = candidate.target.resource;
      switch (status?.kind) {
        case 'ready':
          return renderRows(code, status.detail.properties);
        case 'unsupported':
          return (
            <>
              <div class={styles.notice}>这个资源暂不支持查询完整信息，下面是地图上的属性</div>
              {renderRows(code, candidate.properties)}
            </>
          );
        case 'failed':
          return (
            <div class={styles.notice}>
              <span class={styles.error}>详情加载失败：{messageOf(status.error)}</span>
              <ElButton link type="primary" onClick={props.pick.retry}>
                重试
              </ElButton>
            </div>
          );
        case 'loading':
        case undefined:
          break;
      }
      return detailLoading.value ? <div class={styles.notice}>正在加载详情…</div> : null;
    };

    const renderDetail = (candidate: PickCandidate, canGoBack: boolean) => {
      const { title, subtitle } = featureSummary(candidate.target, candidate.properties);
      const ready = props.pick.detail.value?.kind === 'ready';
      const extra = [
        <ElButton link icon={Aim} disabled={!ready} aria-label="定位到要素" onClick={props.pick.locate} />
      ];
      return (
        <>
          {canGoBack && (
            <ElButton link icon={ArrowLeft} class={styles.back} onClick={props.pick.back}>
              返回列表
            </ElButton>
          )}
          {renderHeader(title, subtitle, extra)}
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
          return (
            <>
              {renderHeader('点选')}
              {identifying.value && <div class={styles.notice}>正在识别…</div>}
            </>
          );
        case 'empty':
          return (
            <>
              {renderHeader('点选')}
              <div class={styles.notice}>这里没有可查询的要素</div>
            </>
          );
        case 'failed':
          return (
            <>
              {renderHeader('点选')}
              <div class={styles.notice}>
                <span class={styles.error}>
                  {state.target?.resource.name}识别失败：{messageOf(state.error)}
                </span>
                <ElButton link type="primary" onClick={props.pick.retry}>
                  重试
                </ElButton>
              </div>
            </>
          );
        case 'too-many':
          return (
            <>
              {renderHeader('框选')}
              <div class={styles.notice}>
                {state.target.resource.name}范围内约 {state.estimate} 个要素，请缩小范围
              </div>
            </>
          );
        case 'too-complex':
          // 文字在 5D 定（ADR 0051 第 4 节）
          return (
            <>
              {renderHeader('点选')}
              <div class={styles.notice}>{state.target.resource.name}：这里的区划边界太复杂，请缩小范围</div>
            </>
          );
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
