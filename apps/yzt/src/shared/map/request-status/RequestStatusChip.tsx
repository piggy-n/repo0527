import { Loading } from '@element-plus/icons-vue';
import { ElButton, ElIcon } from 'element-plus';
import { computed, defineComponent, type PropType, ref, type VNode, watch } from 'vue';
import { SvgIcon } from '../../icons/SvgIcon';
import { useLightDismiss } from '../popover/useLightDismiss';
import {
  type RequestItem,
  requestGroups,
  requestRowText,
  requestSummary
} from './request-status';
import type { RequestStatus } from './useRequestStatus';
import styles from './RequestStatusChip.module.scss';

/**
 * 状态栏右边的请求状态（ADR 0158，原型 `/design.local/current-map-layers/`）：空闲时不显示；点开是"数据加载"的明细，
 * 分加载中、有失败、已完成三组。点一行交给页面在当前图层里选中，模型失败的可以重试；点外面、Esc、再点条目关闭。
 * 时钟在加载时每 250 毫秒走一格，只在这个组件里读，不带动页面重渲染
 */
export const RequestStatusChip = defineComponent({
  name: 'RequestStatusChip',
  props: {
    status: { type: Object as PropType<RequestStatus>, required: true },
    /** 能在当前图层里选中的项 */
    selectable: { type: Function as PropType<(key: string) => boolean>, default: () => false }
  },
  emits: {
    select: (key: string) => typeof key === 'string',
    retry: (key: string) => typeof key === 'string'
  },
  setup(props, { emit }) {
    const root = ref<HTMLElement>();
    const open = ref(false);
    const summary = computed(() => requestSummary(props.status.items.value, props.status.now.value, open.value));
    const groups = computed(() => requestGroups(props.status.items.value));
    // 条目不显示了（没有在加载、没有失败）且明细关着：什么也不留
    watch(
      () => summary.value.kind,
      kind => {
        if (kind === 'hidden') {
          open.value = false;
        }
      }
    );
    useLightDismiss({
      active: () => open.value,
      contains: node => root.value?.contains(node) ?? false,
      onOutside: () => (open.value = false),
      onEscape: () => (open.value = false)
    });

    const renderChip = (): VNode | null => {
      const current = summary.value;
      if (current.kind === 'hidden') {
        return null;
      }
      const common = {
        type: 'button' as const,
        'aria-expanded': open.value,
        'aria-haspopup': 'dialog' as const,
        onClick: () => (open.value = !open.value)
      };
      if (current.kind === 'loading') {
        const percent = current.ratio === null ? null : Math.round(current.ratio * 100);
        return (
          <button {...common} class={styles.chip} data-request-chip="loading">
            <ElIcon class={['is-loading', styles.spinner]}>
              <Loading />
            </ElIcon>
            <span>
              正在加载 {current.count} 项{percent === null ? '' : ` · ${percent}%`}
            </span>
            {current.withFailures > 0 && (
              <span class={styles.dot} role="img" aria-label={`${current.withFailures} 项有失败`} />
            )}
            {current.ratio !== null && (
              <span class={styles.progress} aria-hidden="true">
                <i style={{ width: `${current.ratio * 100}%` }} />
              </span>
            )}
          </button>
        );
      }
      if (current.kind === 'failed') {
        return (
          <button {...common} class={[styles.chip, styles.failed]} data-request-chip="failed">
            <SvgIcon name="status-warning" size={14} />
            <span>{current.count} 项加载失败</span>
          </button>
        );
      }
      return (
        <button {...common} class={[styles.chip, styles.done]} data-request-chip="done">
          <SvgIcon name="check" size={14} />
          <span>已加载完成</span>
        </button>
      );
    };

    const renderRow = (item: RequestItem) => {
      const { text, progress, tone, waited } = requestRowText(item, props.status.now.value);
      const selectable = props.selectable(item.key);
      const failedModel = item.kind === 'model' && item.failed > 0;
      return (
        <li
          key={item.key}
          class={[styles.row, selectable && styles.selectable]}
          title={selectable ? '在当前图层中选中' : undefined}
          data-request-row={item.key}
          onClick={(event: MouseEvent) => {
            if (selectable && !(event.target instanceof Element && event.target.closest('button'))) {
              emit('select', item.key);
            }
          }}
        >
          <SvgIcon class={styles.icon} name={item.icon} size={16} />
          <span class={styles.name}>{item.name}</span>
          <span class={[styles.state, tone === 'slow' && styles.slow, tone === 'error' && styles.error]}>
            {text}
            {failedModel && (
              <ElButton
                class="button-inline"
                link
                type="primary"
                size="small"
                aria-label={`重新加载：${item.name}`}
                onClick={() => emit('retry', item.key)}
              >
                重试
              </ElButton>
            )}
          </span>
          {progress !== null && (
            <span class={styles.bar} aria-hidden="true">
              <i style={{ width: `${progress * 100}%` }} />
            </span>
          )}
          {waited !== null && <span class={styles.waited}>已等待 {waited} 秒</span>}
        </li>
      );
    };

    const renderGroup = (title: string, items: readonly RequestItem[]) =>
      items.length === 0
        ? []
        : [
            <li key={`group:${title}`} class={styles.group}>
              {title}
            </li>,
            ...items.map(renderRow)
          ];

    const renderPopover = () => {
      const { loading, failed, done } = groups.value;
      return (
        <div class={styles.popover} role="dialog" aria-label="数据加载" data-request-popover>
          <div class={styles.head}>
            <strong>数据加载</strong>
            <button type="button" class={styles.close} aria-label="关闭" onClick={() => (open.value = false)}>
              <SvgIcon name="close" size={16} />
            </button>
          </div>
          <ul class={styles.list}>
            {renderGroup('加载中', loading)}
            {renderGroup('有失败', failed)}
            {renderGroup('已完成', done)}
            {props.status.items.value.length === 0 && <li class={styles.empty}>当前视野没有要加载的数据</li>}
          </ul>
        </div>
      );
    };

    return () => {
      const chip = renderChip();
      if (!chip) {
        return null;
      }
      return (
        <div ref={root} class={styles.root} data-request-status>
          {chip}
          {open.value && renderPopover()}
        </div>
      );
    };
  }
});
