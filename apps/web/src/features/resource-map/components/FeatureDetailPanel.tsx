import { Aim, ArrowLeft, Close } from '@element-plus/icons-vue';
import { ElButton } from 'element-plus';
import { useMapOverlay } from '@yzt/map-vue';
import { defineComponent, type PropType, ref, type VNode } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import type { FeatureRecord } from '../api';
import { featureRows, featureSummary, type PickCandidate } from '../feature-query';
import { type CandidateList, type FeaturePick, hasMorePages, type MoreStatus } from '../composables/useFeaturePick';
import styles from './FeatureDetailPanel.module.scss';

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

/**
 * 点选的面板（联调用的界面，5D 再设计；ADR 0047 第 7 节）：识别中、没有结果、失败、候选列表、详情。
 * 状态和操作都在拥有者里，这里只显示和调用；会挡住定位，登记为贴右边的悬浮元素
 */
export const FeatureDetailPanel = defineComponent({
  name: 'FeatureDetailPanel',
  props: {
    pick: { type: Object as PropType<FeaturePick>, required: true }
  },
  setup(props) {
    const element = ref<HTMLElement>();
    useMapOverlay(element, 'right');
    // 很快结束的识别和加载不显示提示（AGENTS.md"加载状态"）
    const identifying = useDelayedFlag(() => props.pick.state.value.kind === 'identifying');
    const detailLoading = useDelayedFlag(() => props.pick.detail.value?.kind === 'loading');

    const renderHeader = (title: string, subtitle?: string, extra?: VNode[]) => (
      <div class={styles.header}>
        <div class={styles.heading}>
          <span class={styles.title}>{title}</span>
          {subtitle && <span class={styles.subtitle}>{subtitle}</span>}
        </div>
        {extra}
        <ElButton link icon={Close} aria-label="关闭点选" onClick={props.pick.close} />
      </div>
    );

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
      const { mode, target, candidates } = list;
      const title = mode === 'box' ? `框选 · ${target.resource.name}` : target.resource.name;
      return (
        <>
          {renderHeader(title, `${target.year} 年 · ${countOf(list)}`)}
          <ul class={styles.candidates}>
            {candidates.map((candidate, index) => (
              <li key={candidate.key}>
                <button type="button" class={styles.candidate} onClick={() => props.pick.choose(candidate)}>
                  {index + 1}. {featureSummary(target, candidate.properties).subtitle}
                </button>
              </li>
            ))}
          </ul>
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
                  {state.target.resource.name}识别失败：{messageOf(state.error)}
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
        case 'candidates':
          return renderCandidates(state.list, state.more);
        case 'detail':
          return renderDetail(state.candidate, state.back !== null);
      }
      return null;
    };

    return () => (
      <div ref={element} class={styles.panel} data-feature-detail-panel>
        {renderContent()}
      </div>
    );
  }
});
