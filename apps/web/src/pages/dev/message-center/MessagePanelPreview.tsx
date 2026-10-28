import { MxTitle } from '@yzt/ui';
import { useInfiniteScroll } from '@vueuse/core';
import { ElButton, ElOption, ElRadioButton, ElRadioGroup, ElSelect, ElSkeleton, ElTag } from 'element-plus';
import { defineComponent, type PropType, ref, watch } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { type MessageAction, messageAction, messageTime } from './message-display';
import styles from './preview.module.scss';
import { CATEGORY_LABELS, type MessageCategory, type MessageSample } from './samples';
import { type CategoryFilter, DEMO_NOW, type MessageDemo, type ReadFilter } from './useMessageDemo';

const CATEGORY_TAGS: Record<MessageCategory, 'warning' | 'primary' | 'info'> = {
  approval: 'warning',
  resource: 'primary',
  table: 'info'
};

const CATEGORY_OPTIONS: [CategoryFilter, string][] = [
  ['all', '全部类型'],
  ...(Object.entries(CATEGORY_LABELS) as [MessageCategory, string][])
];

// 标题行：类型、标题（过长省略）、时间（悬停看完整时间）
function renderHead(message: MessageSample) {
  return (
    <div class={styles.messageHead}>
      <ElTag size="small" type={CATEGORY_TAGS[message.category]}>
        {CATEGORY_LABELS[message.category]}
      </ElTag>
      <strong class={styles.messageTitle}>{message.title}</strong>
      <time class={styles.messageTime} datetime={message.createdAt} title={message.createdAt}>
        {messageTime(message.createdAt, DEMO_NOW)}
      </time>
    </div>
  );
}

/** 弹框的内容：标题栏、筛选、消息列表；列表与详情的两种写法由演示选项切换 */
export const MessagePanelPreview = defineComponent({
  name: 'MessagePanelPreview',
  props: {
    demo: { type: Object as PropType<MessageDemo>, required: true }
  },
  emits: {
    navigate: () => true
  },
  setup(props, { emit }) {
    const demo = props.demo;
    const list = ref<HTMLElement>();

    // 滚到距底部 120 以内时接着显示下一批
    useInfiniteScroll(list, demo.loadMore, { distance: 120, canLoadMore: () => demo.hasMore.value });

    // 换了筛选条件，回到列表顶部
    watch(
      () => [demo.readFilter.value, demo.category.value],
      () => {
        list.value?.scrollTo({ top: 0 });
      }
    );

    function go(message: MessageSample, action: MessageAction) {
      demo.navigate(message, action);
      emit('navigate');
    }

    function renderAction(message: MessageSample, block = false) {
      const action = messageAction(message, demo.role.value);
      if (!action) {
        return null;
      }
      if (!action.available) {
        if (demo.unavailableAction.value === 'hidden') {
          return null;
        }
        return (
          <div class={styles.messageActions}>
            <ElButton link type="primary" disabled>
              {action.label}
            </ElButton>
            <span class={styles.unavailable}>数据下载页面迁移后可用</span>
          </div>
        );
      }
      return (
        <div class={styles.messageActions}>
          <ElButton
            link={!block}
            type="primary"
            onClick={(event: MouseEvent) => {
              event.stopPropagation();
              go(message, action);
            }}
          >
            {action.label}
          </ElButton>
        </div>
      );
    }

    // A：正文完整显示，点一行标为已读，业务按钮在行内
    function renderInlineRow(message: MessageSample) {
      const markRead = () => void demo.markRead(message);
      return (
        <article
          key={message.id}
          class={[styles.message, !message.read && styles.unread]}
          tabindex={0}
          aria-label={`${message.read ? '' : '未读，'}${message.title}`}
          onClick={markRead}
          onKeydown={(event: KeyboardEvent) => {
            if (event.key === 'Enter' && event.target === event.currentTarget) {
              markRead();
            }
          }}
        >
          <span class={styles.dot} />
          <div class={styles.messageMain}>
            {renderHead(message)}
            <p class={styles.messageContent}>{message.content}</p>
            {renderAction(message)}
          </div>
        </article>
      );
    }

    // B：列表只有一行摘要，点开在弹框里看详情
    function renderDrillRow(message: MessageSample) {
      return (
        <button
          key={message.id}
          type="button"
          class={[styles.message, styles.messageButton, !message.read && styles.unread]}
          onClick={() => demo.select(message)}
        >
          <span class={styles.dot} />
          <div class={styles.messageMain}>
            {renderHead(message)}
            <p class={[styles.messageContent, styles.ellipsis]}>{message.content}</p>
          </div>
        </button>
      );
    }

    function renderDetail(message: MessageSample) {
      return (
        <div class={styles.detail}>
          <button type="button" class={styles.back} onClick={demo.back}>
            <SvgIcon name="arrow-left" size={12} />
            返回列表
          </button>
          {renderHead(message)}
          <p class={styles.detailContent}>{message.content}</p>
          {renderAction(message, true)}
        </div>
      );
    }

    function renderFilters() {
      return (
        <div class={styles.filters}>
          <ElRadioGroup
            size="small"
            modelValue={demo.readFilter.value}
            onUpdate:modelValue={(value: string | number | boolean | undefined) => {
              demo.setFilter(value === 'unread' ? 'unread' : 'all', demo.category.value);
            }}
          >
            {(['all', 'unread'] as ReadFilter[]).map(value => (
              <ElRadioButton key={value} value={value}>
                {value === 'all' ? '全部' : '未读'}
              </ElRadioButton>
            ))}
          </ElRadioGroup>
          <ElSelect
            size="small"
            class={styles.category}
            modelValue={demo.category.value}
            onUpdate:modelValue={(value: CategoryFilter) => demo.setFilter(demo.readFilter.value, value)}
            aria-label="消息类型"
          >
            {CATEGORY_OPTIONS.map(([value, label]) => (
              <ElOption key={value} value={value} label={label} />
            ))}
          </ElSelect>
        </div>
      );
    }

    function renderListBody() {
      const scene = demo.listScene.value;
      if (scene === 'loading') {
        return (
          <div class={styles.listState}>
            <ElSkeleton rows={5} animated />
          </div>
        );
      }
      if (scene === 'error') {
        return (
          <div class={[styles.listState, styles.listMessage]}>
            加载失败
            <ElButton link type="primary" onClick={() => (demo.listScene.value = 'normal')}>
              重试
            </ElButton>
          </div>
        );
      }
      if (demo.visible.value.length === 0) {
        const text = demo.readFilter.value === 'unread' ? '没有未读消息' : '暂无消息';
        return <div class={[styles.listState, styles.listMessage]}>{text}</div>;
      }
      const renderRow = demo.detailStyle.value === 'inline' ? renderInlineRow : renderDrillRow;
      return [
        ...demo.visible.value.map(renderRow),
        <p class={styles.listEnd}>{demo.hasMore.value ? '继续滚动显示更多' : `共 ${demo.filteredCount.value} 条`}</p>
      ];
    }

    // 详情盖在列表上面：弹框高度不变，返回后列表的滚动位置还在
    function renderBody() {
      const selected = demo.detailStyle.value === 'drill' ? demo.selected.value : undefined;
      return (
        <div class={styles.body}>
          <div class={[styles.listView, selected && styles.covered]} inert={Boolean(selected)}>
            {renderFilters()}
            <div ref={list} class={styles.list}>
              {renderListBody()}
            </div>
          </div>
          {selected && <div class={styles.detailLayer}>{renderDetail(selected)}</div>}
        </div>
      );
    }

    return () => (
      <div class={styles.panel}>
        <header class={styles.panelHeader}>
          <MxTitle level="panel" description={demo.unreadCount.value > 0 ? `${demo.unreadCount.value} 条未读` : undefined}>
            消息
          </MxTitle>
          <ElButton
            link
            type="primary"
            disabled={!demo.anyUnread.value}
            loading={demo.readingAll.value}
            onClick={() => void demo.markAllRead()}
          >
            全部已读
          </ElButton>
        </header>
        {renderBody()}
      </div>
    );
  }
});
