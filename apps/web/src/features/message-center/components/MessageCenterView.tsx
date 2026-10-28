import { ArrowLeft, Close } from '@element-plus/icons-vue';
import { MxPanel, MxTitle } from '@yzt/ui';
import { ElBadge, ElButton, ElOption, ElSelect } from 'element-plus';
import { defineComponent, nextTick, type PropType, ref, useId, watch } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import type { Message, MessageCategory } from '../api';
import type { MessageCenterModel, ReadFilter } from '../composables/useMessageCenter';
import { actionLabel, categoryLabels, messageTarget, type MessageTarget } from '../presentation';
import { MessageList } from './MessageList';
import styles from './message-center.module.scss';

// 预览与正式页面共用组件，数据和操作由各自拥有者提供
export type MessageViewModel = Omit<MessageCenterModel, 'refresh'> & { refresh: () => Promise<unknown> };
const readFilters: { value: ReadFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'unread', label: '未读' },
  { value: 'read', label: '已读' }
];

export const MessageCenterView = defineComponent({
  name: 'MessageCenterView',
  props: {
    model: { type: Object as PropType<MessageViewModel>, required: true },
    headerBottom: { type: Number, required: true },
    navigate: { type: Function as PropType<(target: MessageTarget) => Promise<boolean>>, required: true },
    unavailable: { type: String, default: '' }
  },
  setup(props) {
    const panelId = `message-center-${useId()}`;
    const panel = ref<HTMLElement>();
    const trigger = ref<HTMLButtonElement>();
    const scrollArea = ref<HTMLElement>();
    const navigating = ref(false);
    const loadingReadAll = useDelayedFlag(() => props.model.readingAll.value);
    const refreshing = useDelayedFlag(() => props.model.refreshing.value);

    // 浏览器负责 Esc、外部点击和触发按钮切换；会话或路由也可主动关闭
    watch(
      () => props.model.open.value,
      value => {
        if (!value) {
          panel.value?.hidePopover();
        }
      }
    );
    watch(
      () => [props.model.readFilter.value, props.model.category.value, props.model.selectedId.value],
      async () => {
        await nextTick();
        scrollArea.value?.scrollTo({ top: 0 });
      }
    );

    function close() {
      panel.value?.hidePopover();
      props.model.open.value = false;
      trigger.value?.focus();
    }

    async function openRelated() {
      const message = props.model.selected.value;
      if (!message || props.unavailable || navigating.value) {
        return;
      }
      navigating.value = true;
      try {
        if (await props.navigate(messageTarget(message))) {
          close();
        }
      } finally {
        navigating.value = false;
      }
    }

    function renderFilters() {
      const model = props.model;
      return (
        <div class={styles.filters}>
          <div class={styles.readFilters} role="group" aria-label="已读状态">
            {readFilters.map(item => (
              <button
                type="button"
                key={item.value}
                class={[styles.filter, model.readFilter.value === item.value && styles.filterActive]}
                aria-pressed={model.readFilter.value === item.value}
                onClick={() => (model.readFilter.value = item.value)}
              >
                {item.label}
                {item.value === 'unread' && model.unreadCount.value > 0 && <span>{model.unreadCount.value}</span>}
              </button>
            ))}
          </div>
          <ElSelect
            size="small"
            aria-label="消息类型"
            teleported={false}
            modelValue={model.category.value}
            onUpdate:modelValue={(value: MessageCategory | 'all') => (model.category.value = value)}
          >
            <ElOption value="all" label="全部类型" />
            {Object.entries(categoryLabels).map(([value, label]) => (
              <ElOption key={value} value={value} label={label} />
            ))}
          </ElSelect>
        </div>
      );
    }

    function renderContent() {
      const model = props.model;
      const message = model.selected.value;
      if (message) {
        return (
          <article class={styles.detail}>
            <h3>{message.title}</h3>
            <div class={styles.meta}>
              <span>{categoryLabels[message.category]}</span>
              <time>{message.createTime}</time>
            </div>
            <p>{message.content}</p>
          </article>
        );
      }
      return (
        <>
          {model.failed.value && model.messages.value.length > 0 && (
            <div class={styles.notice} role="alert">
              刷新失败，当前显示上次的消息
              <ElButton link type="primary" onClick={model.refresh}>
                重试
              </ElButton>
            </div>
          )}
          <MessageList
            messages={model.visible.value}
            loading={model.loading.value}
            failed={model.failed.value && model.messages.value.length === 0}
            empty={model.messages.value.length === 0}
            onSelect={model.select}
            onRetry={model.refresh}
          />
        </>
      );
    }

    function readState(message: Message): string {
      if (props.unavailable) {
        return props.unavailable;
      }
      if (message.isRead) {
        return '已读';
      }
      return props.model.isReading(message.msgId) ? '正在标记已读' : '未读';
    }

    function renderFooter() {
      const model = props.model;
      const message = model.selected.value;
      if (message) {
        return (
          <div class={styles.footer}>
            <span class={styles.hint}>{readState(message)}</span>
            <ElButton type="primary" disabled={Boolean(props.unavailable) || navigating.value} onClick={openRelated}>
              {actionLabel(message)}
            </ElButton>
          </div>
        );
      }
      return (
        <div class={styles.footer}>
          <span class={styles.hint}>
            {model.loading.value ? '正在加载消息' : `共 ${model.filtered.value.length} 条消息`}
          </span>
          {model.limit.value < model.filtered.value.length ? (
            <ElButton link type="primary" onClick={() => (model.limit.value += 20)}>
              加载更多
            </ElButton>
          ) : (
            <span class={styles.hint}>{refreshing.value ? '正在刷新' : '按时间倒序'}</span>
          )}
        </div>
      );
    }

    return () => {
      const model = props.model;
      const message = model.selected.value;
      // 详情里显示这一条的写入错误，列表里显示全部已读的错误
      const notice = message ? model.selectedError.value : model.allError.value;
      return (
        <>
          <button
            ref={trigger}
            type="button"
            class={[styles.bell, model.open.value && styles.bellActive]}
            aria-label={`消息中心，${model.unreadCount.value} 条未读`}
            aria-expanded={model.open.value}
            aria-haspopup="dialog"
            aria-controls={panelId}
            popovertarget={panelId}
          >
            <ElBadge value={model.unreadCount.value} hidden={!model.unreadCount.value} max={99}>
              <SvgIcon name="notification-bell" size={20} />
            </ElBadge>
          </button>
          <div
            ref={panel}
            id={panelId}
            popover="auto"
            role="dialog"
            aria-label="消息中心"
            class={[styles.popover, message && styles.detailPopover]}
            style={{ '--message-header-bottom': `${props.headerBottom}px` }}
            onToggle={event => {
              if (event instanceof ToggleEvent) {
                model.open.value = event.newState === 'open';
              }
            }}
          >
            <MxPanel headerTone="muted" flush>
              {{
                header: () => (
                  <div class={styles.heading}>
                    {message && (
                      <ElButton
                        link
                        icon={ArrowLeft}
                        aria-label="返回消息列表"
                        onClick={() => (model.selectedId.value = undefined)}
                      />
                    )}
                    <MxTitle level="panel">{message ? '消息详情' : '消息中心'}</MxTitle>
                  </div>
                ),
                actions: () => [
                  !message && (
                    <ElButton
                      link
                      type="primary"
                      disabled={!model.canReadAll.value}
                      loading={loadingReadAll.value}
                      onClick={model.readAll}
                    >
                      全部已读
                    </ElButton>
                  ),
                  <ElButton link icon={Close} aria-label="关闭消息中心" onClick={close} />
                ],
                subheader: () => (
                  <>
                    {!message && renderFilters()}
                    {notice && (
                      <div class={styles.notice} role="alert">
                        {notice}
                        <ElButton
                          link
                          type="primary"
                          disabled={model.readingAll.value || Boolean(message && model.isReading(message.msgId))}
                          onClick={() => (message ? model.read(message.msgId) : model.readAll())}
                        >
                          重试
                        </ElButton>
                      </div>
                    )}
                  </>
                ),
                default: () => <div ref={scrollArea} class={styles.scrollArea}>{renderContent()}</div>,
                footer: renderFooter
              }}
            </MxPanel>
          </div>
        </>
      );
    };
  }
});
