import { Loading } from '@element-plus/icons-vue';
import { useEventListener, useResizeObserver } from '@vueuse/core';
import { usePageActive } from '@mx/map-vue';
import { ElButton, ElIcon, ElTooltip } from 'element-plus';
import { computed, defineComponent, type PropType, ref, shallowRef, type VNode, watch } from 'vue';
import { SvgIcon } from '../../icons/SvgIcon';
import { useLightDismiss } from '../popover/useLightDismiss';
import { MAP_TOOLTIP_PROPS } from '../tooltip';
import { type RequestPopoverPlacement, requestPopoverPlacement } from './request-popover';
import {
  failedRowText,
  type RequestItem,
  requestGroups,
  requestPercent,
  type RequestRowText,
  requestRowText,
  requestStatusText,
  requestStatusTip,
  type RequestSummary,
  requestSummary
} from './request-status';
import type { RequestStatus } from './useRequestStatus';
import styles from './RequestStatusChip.module.scss';

// 高斯泼溅那一行的说明：库只给比例（ADR 0162）
const DETAIL_HINT = '高斯泼溅只能知道当前视角的细节加载了多少，和瓦片集的块数不是一种算法';

// 按钮上的图标和数字：加载中是转圈和百分比（上一轮有失败时转圈角上一个红点），失败是警告和项数，完成、空闲是勾
function statusContent(summary: RequestSummary): VNode[] {
  if (summary.kind === 'loading') {
    return [
      <span class={styles.icon}>
        <ElIcon class={['is-loading', styles.spinner]} size={14}>
          <Loading />
        </ElIcon>
        {summary.withFailures > 0 && <span class={styles.badge} data-request-badge />}
      </span>,
      ...(summary.ratio === null ? [] : [<span>{requestPercent(summary.ratio)}%</span>])
    ];
  }
  if (summary.kind === 'failed') {
    return [<SvgIcon name="status-warning" size={14} />, <span>{summary.count}</span>];
  }
  return [<SvgIcon name="check" size={14} />];
}

/**
 * 状态栏前面的请求状态（ADR 0158、0171，原型 `/design.local/status-bar/`）：一直在的按钮，宽度按"转圈 99%"固定、内容居中，
 * 状态变了读数不动；只有图标和数字，全称在 Tooltip 和读屏名称里。点开是"数据加载"的明细，分加载中、有失败、已完成三组。
 * 点一行交给页面在面板的图层列表里选中，模型失败的可以重试；点外面、Esc、再点按钮关闭。明细贴着资源图层面板的右边、
 * 底边在状态栏上方（requestPopoverPlacement，用户 2026-11-16）。时钟在加载时每 250 毫秒走一格，只在这个组件里读，
 * 不带动页面重渲染
 */
export const RequestStatusChip = defineComponent({
  name: 'RequestStatusChip',
  props: {
    status: { type: Object as PropType<RequestStatus>, required: true },
    /** 能在面板的图层列表里选中的项 */
    selectable: { type: Function as PropType<(key: string) => boolean>, default: () => false },
    /** 资源图层面板所在的一列：明细贴在它右边，宽度变了、收起时跟着走；没有时贴着区域的左边 */
    panel: { type: Function as PropType<() => HTMLElement | null>, default: () => null },
    /** 明细能放的区域（地图上四周留白以内）；没有时用整个视口 */
    area: { type: Function as PropType<() => HTMLElement | null>, default: () => null }
  },
  emits: {
    select: (key: string) => typeof key === 'string',
    retry: (key: string) => typeof key === 'string'
  },
  setup(props, { emit }) {
    const root = ref<HTMLElement>();
    const open = ref(false);
    // 关掉的一类不在条目和明细里（ADR 0167）
    const summary = computed(() =>
      requestSummary(props.status.items.value, props.status.display.value, open.value, props.status.kinds.value)
    );
    const groups = computed(() => requestGroups(props.status.items.value, props.status.kinds.value));
    // 三类都关掉、按钮不显示了：明细一起关上
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

    // 明细的位置：开着时量面板、区域和状态栏（条目的上边），面板的宽度、收起和窗口变了重新放；页面停用时量不到，激活后再放。
    // 页面给的面板一直是同一个元素，展开、收起只改它的宽度，靠尺寸监听；只在开着时监听，元素没换时不重建监听
    const placement = shallowRef<RequestPopoverPlacement | null>(null);
    const pageActive = usePageActive();
    const panel = computed(() => (open.value ? props.panel() : null));
    const area = computed(() => (open.value ? props.area() : null));
    const place = () => {
      const chip = root.value;
      if (!open.value || !chip?.isConnected) {
        return;
      }
      placement.value = requestPopoverPlacement({
        panel: panel.value?.getBoundingClientRect() ?? null,
        area: area.value?.getBoundingClientRect() ?? {
          left: 0,
          top: 0,
          right: window.innerWidth,
          bottom: window.innerHeight
        },
        barTop: chip.getBoundingClientRect().top,
        viewport: { height: window.innerHeight }
      });
    };
    watch([open, pageActive, panel, area], place, { immediate: true, flush: 'post' });
    useResizeObserver(panel, place);
    useResizeObserver(area, place);
    useEventListener(window, 'resize', place);

    // 按钮的宽度由叠在同一格里、看不见的"转圈 99%"撑出，内容居中；明细开着时不提示
    const renderChip = (): VNode | null => {
      const current = summary.value;
      if (current.kind === 'hidden') {
        return null;
      }
      return (
        <ElTooltip {...MAP_TOOLTIP_PROPS} content={requestStatusTip(current)} placement="top" disabled={open.value}>
          <button
            type="button"
            class={[styles.chip, styles[current.kind]]}
            aria-label={requestStatusText(current)}
            aria-expanded={open.value}
            aria-haspopup="dialog"
            data-request-chip={current.kind}
            onClick={() => (open.value = !open.value)}
          >
            <span class={styles.content}>{statusContent(current)}</span>
            <span class={[styles.content, styles.sample]} aria-hidden="true">
              <ElIcon size={14}>
                <Loading />
              </ElIcon>
              <span>99%</span>
            </span>
          </button>
        </ElTooltip>
      );
    };

    // 带着上一轮失败、还在加载的项在加载中、有失败两组里都有：行的 key 带上组名
    const renderRow = (group: string, item: RequestItem, { text, progress, tone, waited }: RequestRowText) => {
      const selectable = props.selectable(item.key);
      const failedModel = item.kind === 'model' && item.failed > 0;
      return (
        <li
          key={`${group}:${item.key}`}
          class={[styles.row, selectable && styles.selectable]}
          title={selectable ? '在图层列表中选中' : undefined}
          data-request-row={item.key}
          onClick={(event: MouseEvent) => {
            // 点在行的空白处也选中；名称、重试是按钮，自己处理
            if (selectable && !(event.target instanceof Element && event.target.closest('button'))) {
              emit('select', item.key);
            }
          }}
        >
          <SvgIcon class={styles.icon} name={item.icon} size={16} />
          {selectable ? (
            // 能选的行，名称是按钮：键盘能到达，回车、空格选中；行本身保持列表项，"重试"不套在里面（2026-11-15 审查）
            <button
              type="button"
              class={[styles.name, styles.nameButton]}
              data-request-select
              onClick={() => emit('select', item.key)}
            >
              {item.name}
            </button>
          ) : (
            <span class={styles.name}>{item.name}</span>
          )}
          <span
            class={[styles.state, tone === 'slow' && styles.slow, tone === 'error' && styles.error]}
            title={item.kind === 'detail' ? DETAIL_HINT : undefined}
          >
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

    const renderGroup = (
      title: string,
      items: readonly RequestItem[],
      rowText: (item: RequestItem, now: number) => RequestRowText
    ) =>
      items.length === 0
        ? []
        : [
            <li key={`group:${title}`} class={styles.group}>
              {title}
            </li>,
            ...items.map(item => renderRow(title, item, rowText(item, props.status.now.value)))
          ];

    const renderPopover = () => {
      const { loading, failed, done } = groups.value;
      const box = placement.value;
      // 量好之前先不显示：放好的位置在同一轮渲染里就到，看不到闪动
      const style = box
        ? { left: `${box.left}px`, bottom: `${box.bottom}px`, width: `${box.width}px`, maxHeight: `${box.maxHeight}px` }
        : { visibility: 'hidden' as const };
      return (
        <div class={styles.popover} style={style} role="dialog" aria-label="数据加载" data-request-popover>
          <div class={styles.head}>
            <strong>数据加载</strong>
            <button type="button" class={styles.close} aria-label="关闭" onClick={() => (open.value = false)}>
              <SvgIcon name="close" size={16} />
            </button>
          </div>
          <ul class={styles.list}>
            {renderGroup('加载中', loading, requestRowText)}
            {renderGroup('有失败', failed, failedRowText)}
            {renderGroup('已完成', done, requestRowText)}
            {loading.length + failed.length + done.length === 0 && (
              <li class={styles.empty}>当前视野没有要加载的数据</li>
            )}
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
