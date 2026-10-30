import { MxPanel } from '@yzt/ui';
import { useInfiniteScroll } from '@vueuse/core';
import { ElButton, ElOption, ElRadioButton, ElRadioGroup, ElSelect, ElSkeleton, ElTag } from 'element-plus';
import { defineComponent, type PropType, ref, watch } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import type { Message, MessageCategory } from '../api';
import type { MessageCenter } from '../composables/useMessageCenter';
import type { CategoryFilter, ReadFilter } from '../composables/useMessageFilters';
import { CATEGORY_LABELS, messageLink, messageTime, type MessageTarget } from '../display';
import styles from './MessagePanel.module.scss';

const CATEGORY_TAGS: Record<MessageCategory, 'warning' | 'primary' | 'info'> = {
  approval: 'warning',
  resource: 'primary',
  table: 'info'
};

const CATEGORY_OPTIONS: [CategoryFilter, string][] = [
  ['all', '全部类型'],
  ...(Object.entries(CATEGORY_LABELS) as [MessageCategory, string][])
];

const READ_OPTIONS: [ReadFilter, string][] = [
  ['all', '全部'],
  ['unread', '未读']
];

const isReadFilter = (value: unknown): value is ReadFilter => value === 'all' || value === 'unread';

/** 消息弹框的内容：浅灰标题栏（未读数、全部已读）、固定的筛选、滚动的消息列表（ADR 0093） */
export const MessagePanel = defineComponent({
  name: 'MessagePanel',
  props: {
    center: { type: Object as PropType<MessageCenter>, required: true },
    // 目标暂时去不了时返回原因：按钮禁用，旁边显示原因；由 app 按角色决定
    unavailableReason: {
      type: Function as PropType<(target: MessageTarget) => string | null>,
      default: () => null
    }
  },
  emits: {
    // 点了业务按钮：消息已提交已读，由 app 关闭弹框并跳转
    open: (_target: MessageTarget) => true
  },
  setup(props, { emit }) {
    const center = props.center;
    const list = ref<HTMLElement>();
    const showSkeleton = useDelayedFlag(() => center.initialLoading.value);

    // 滚到距底部 120 以内时接着显示下一批
    useInfiniteScroll(list, center.loadMore, { distance: 120, canLoadMore: () => center.hasMore.value });

    // 换了筛选条件，回到列表顶部
    watch([center.readFilter, center.category], () => {
      if (list.value) {
        list.value.scrollTop = 0;
      }
    });

    // 业务按钮在时间下方、右对齐；暂时去不了时按钮禁用，原因写在按钮下方
    function renderLink(message: Message) {
      const link = messageLink(message);
      if (!link) {
        return null;
      }
      const reason = props.unavailableReason(link.target);
      return [
        <ElButton
          key="link"
          class={styles.action}
          link
          type="primary"
          size="small"
          disabled={reason !== null}
          onClick={() => {
            // 点击还会冒泡到整行，同一条只提交一次
            void center.markRead(message);
            emit('open', link.target);
          }}
        >
          {link.label}
        </ElButton>,
        reason !== null && (
          <span key="reason" class={styles.unavailable}>
            {reason}
          </span>
        )
      ];
    }

    // 一条消息一张卡片：未读点、标题（放不下时省略）、类型、时间（悬停看完整时间），下面是完整正文和业务按钮；
    // 未读白底浅蓝描边，已读浅灰底、文字变淡（同旧项目）。点一下标为已读
    function renderMessage(message: Message, now: Date) {
      const markRead = () => void center.markRead(message);
      return (
        <article
          key={message.id}
          class={[styles.message, message.read ? styles.read : styles.unread]}
          tabindex={0}
          aria-label={`${message.read ? '' : '未读，'}${message.title}`}
          aria-busy={center.isReading(message.id)}
          onClick={markRead}
          onKeydown={(event: KeyboardEvent) => {
            if (event.key === 'Enter') {
              markRead();
            }
          }}
        >
          <span class={styles.dot} />
          <div class={styles.head}>
            <strong class={styles.title} title={message.title}>
              {message.title}
            </strong>
            <ElTag class="tag-mini" type={CATEGORY_TAGS[message.category]}>
              {CATEGORY_LABELS[message.category]}
            </ElTag>
          </div>
          <time class={styles.time} datetime={message.createdAt} title={message.createdAt}>
            {messageTime(message.createdAt, now)}
          </time>
          <p class={styles.content}>{message.content}</p>
          {renderLink(message)}
        </article>
      );
    }

    function renderFilters() {
      return (
        <div class={styles.filters}>
          <ElRadioGroup
            size="small"
            modelValue={center.readFilter.value}
            onUpdate:modelValue={(value: string | number | boolean | undefined) => {
              if (isReadFilter(value)) {
                center.setReadFilter(value);
              }
            }}
          >
            {READ_OPTIONS.map(([value, label]) => (
              <ElRadioButton key={value} value={value}>
                {label}
              </ElRadioButton>
            ))}
          </ElRadioGroup>
          <ElSelect
            size="small"
            class={styles.category}
            modelValue={center.category.value}
            onUpdate:modelValue={(value: CategoryFilter) => center.setCategory(value)}
            aria-label="消息类型"
          >
            {CATEGORY_OPTIONS.map(([value, label]) => (
              <ElOption key={value} value={value} label={label} />
            ))}
          </ElSelect>
        </div>
      );
    }

    function renderList() {
      if (center.initialLoading.value) {
        // 骨架屏出现之前留空
        return showSkeleton.value ? <ElSkeleton class={styles.state} rows={5} animated /> : null;
      }
      if (center.loadFailed.value) {
        return (
          <div class={[styles.state, styles.notice]}>
            加载失败
            <ElButton link type="primary" onClick={center.retry}>
              重试
            </ElButton>
          </div>
        );
      }
      if (center.filteredCount.value === 0) {
        const text = center.readFilter.value === 'unread' ? '没有未读消息' : '暂无消息';
        return <div class={[styles.state, styles.notice]}>{text}</div>;
      }
      // 时间按渲染时的"今天"显示；弹框每次打开都会取一次列表、重新渲染
      const now = new Date();
      return [
        ...center.visible.value.map(message => renderMessage(message, now)),
        <p class={styles.end}>{center.hasMore.value ? '继续滚动显示更多' : `共 ${center.filteredCount.value} 条`}</p>
      ];
    }

    return () => {
      const unread = center.unreadCount.value;
      return (
        <MxPanel
          class={styles.panel}
          title="消息"
          description={unread > 0 ? `${unread} 条未读` : undefined}
          headerTone="muted"
          flush
        >
          {{
            actions: () => [
              <ElButton
                link
                type="primary"
                disabled={!center.canReadAll.value}
                loading={center.readingAll.value}
                onClick={() => void center.markAllRead()}
              >
                全部已读
              </ElButton>
            ],
            subheader: () => [renderFilters()],
            default: () => [
              <div ref={list} class={styles.list} aria-label="消息列表">
                {renderList()}
              </div>
            ]
          }}
        </MxPanel>
      );
    };
  }
});
