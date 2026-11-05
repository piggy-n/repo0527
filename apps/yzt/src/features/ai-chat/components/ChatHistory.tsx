import { ChatLineRound, Clock, Delete, Search } from '@element-plus/icons-vue';
import { ElButton, ElIcon, ElInput, ElSkeleton, ElSkeletonItem } from 'element-plus';
import { computed, defineComponent, type PropType, ref } from 'vue';
import type { AiSession } from '../api';
import { formatSeconds } from '../chat-result';
import { historySections, historyTime, sessionTitle } from '../history';
import styles from './ChatHistory.module.scss';

const SKELETON_COUNT = 5;

function renderSkeleton() {
  return (
    <div class={styles.list} aria-busy="true">
      {Array.from({ length: SKELETON_COUNT }, (_, index) => (
        <div key={index} class={styles.skeleton}>
          <ElSkeleton animated>
            {{
              template: () => [
                <ElSkeletonItem variant="text" class={styles.skeletonTitle} />,
                <ElSkeletonItem variant="text" class={styles.skeletonMeta} />
              ]
            }}
          </ElSkeleton>
        </div>
      ))}
    </div>
  );
}

// 空列表与加载失败：图标、说明和一个操作
function renderState(title: string, detail: string, action: () => void, actionText: string) {
  return (
    <div class={styles.state}>
      <span class={styles.stateIcon}>
        <ElIcon>
          <Clock />
        </ElIcon>
      </span>
      <strong class={styles.stateTitle}>{title}</strong>
      <p class={styles.stateDetail}>{detail}</p>
      <ElButton type="primary" onClick={action}>
        {actionText}
      </ElButton>
    </div>
  );
}

/** 历史对话：按标题搜索，按今天、昨天、更早分组；加载中显示骨架，失败时可以重试 */
export const ChatHistory = defineComponent({
  name: 'ChatHistory',
  props: {
    /** 还没加载到时为 undefined */
    sessions: { type: Array as PropType<readonly AiSession[]>, default: undefined },
    loading: { type: Boolean, required: true },
    failed: { type: Boolean, required: true },
    currentId: { type: String, required: true },
    /** 正在打开的对话 */
    openingId: { type: String as PropType<string | null>, default: null },
    isRemoving: { type: Function as PropType<(sessionId: string) => boolean>, required: true }
  },
  emits: {
    open: (sessionId: string) => typeof sessionId === 'string',
    remove: (sessionId: string) => typeof sessionId === 'string',
    retry: () => true,
    newSession: () => true
  },
  setup(props, { emit }) {
    const keyword = ref('');
    // 分组按打开历史时的日期；停留跨过零点时不重新分组
    const now = new Date();
    const sections = computed(() => historySections(props.sessions ?? [], keyword.value, now));

    const renderSession = (session: AiSession) => {
      const id = session.session_id;
      const removing = props.isRemoving(id);
      const busy = removing || props.openingId === id;
      return (
        <li key={id} class={[styles.card, id === props.currentId && styles.current, busy && styles.busy]}>
          <button
            type="button"
            class={styles.open}
            disabled={busy}
            aria-current={id === props.currentId ? 'true' : undefined}
            onClick={() => emit('open', id)}
          >
            <span class={styles.title}>{sessionTitle(session)}</span>
            <span class={styles.meta}>
              <span class={styles.metaItem}>
                <ElIcon>
                  <ChatLineRound />
                </ElIcon>
                {session.message_count} 条消息
                {session.duration_ms !== undefined && session.duration_ms > 0 && (
                  <span class={styles.duration}>{formatSeconds(session.duration_ms)}</span>
                )}
              </span>
              <span class={styles.metaItem}>
                <ElIcon>
                  <Clock />
                </ElIcon>
                {historyTime(session.last_time, now)}
              </span>
            </span>
          </button>
          <ElButton
            class={styles.remove}
            link
            icon={Delete}
            loading={removing}
            disabled={busy}
            aria-label={`删除"${sessionTitle(session)}"`}
            onClick={() => emit('remove', id)}
          />
        </li>
      );
    };

    const renderContent = () => {
      if (props.sessions === undefined) {
        if (props.failed) {
          return renderState('历史对话加载失败', '请稍后重试', () => emit('retry'), '重试');
        }
        return props.loading ? renderSkeleton() : null;
      }
      if (props.sessions.length === 0) {
        return renderState(
          '暂无历史对话',
          '开始一次新的空间查询后，这里会自动保存历史记录',
          () => emit('newSession'),
          '新对话'
        );
      }
      if (sections.value.length === 0) {
        return <p class={styles.noMatch}>没有找到相关的历史对话</p>;
      }
      return (
        <div class={styles.list}>
          {sections.value.map(section => (
            <section key={section.label} class={styles.section} aria-label={section.label}>
              <h4 class={styles.sectionLabel}>{section.label}</h4>
              <ul class={styles.cards}>{section.sessions.map(renderSession)}</ul>
            </section>
          ))}
        </div>
      );
    };

    return () => (
      <div class={styles.root}>
        <ElInput
          class={styles.search}
          modelValue={keyword.value}
          onUpdate:modelValue={(value: string) => (keyword.value = value)}
          prefixIcon={Search}
          placeholder="搜索历史对话"
          clearable
        />
        {renderContent()}
      </div>
    );
  }
});
