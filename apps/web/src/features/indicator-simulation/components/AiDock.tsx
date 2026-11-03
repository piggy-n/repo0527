import { Promotion, RefreshRight } from '@element-plus/icons-vue';
import { ElButton, ElMessage } from 'element-plus';
import { computed, defineComponent, type PropType, ref } from 'vue';
import { ChatAvatar } from '@/shared/chat-avatar/ChatAvatar';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import type { CompositionOwner } from '../composables/useComposition';
import type { PromptComposer } from '../composables/usePromptComposer';
import type { RunConversation } from '../composables/useRunConversation';
import type { ScopeEditor } from '../composables/useScopeEditor';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { citiesScope } from '../model/scope';
import { areaBrief } from '../scope/area-tree';
import { AreaFilePicker } from './AreaFilePicker';
import { AreaThumbnail } from './AreaThumbnail';
import { ComposeGuideCard } from './ComposeGuideCard';
import styles from './AiDock.module.scss';


// 点框内的空白处也是要输入：文字下面的一行没有内容的地方不该点了没反应
const focusText = (event: MouseEvent) => {
  const { target, currentTarget } = event;
  if (target instanceof Element && !target.closest('button, textarea') && currentTarget instanceof HTMLElement) {
    currentTarget.querySelector('textarea')?.focus();
  }
};

/**
 * 页面底部的 AI 对话栏：条件配置时写计算指令（发送后 AI 逐个节点配置），等用户补充时输入框上方是引导卡（ADR 0129），用着的范围也在上方，
 * 框内左边是文字和上传范围，右边上下是"换一批"和发送；计算和结果阶段对计算说话，上方是按当前条件给的快捷说法，框内是文字、上传范围和发送；
 * 看结果时左侧没有时间线，AI 的回复写在输入框下面。
 * 输入框空着时占位显示一句完整的示例，按 Tab 填进来；回车发送（输入法选字时不算），Shift + 回车换行，
 * 输入框随内容（空着时随示例）长到三行
 */
export const AiDock = defineComponent({
  name: 'AiDock',
  props: {
    composer: { type: Object as PropType<PromptComposer>, required: true },
    /** 计算和结果阶段的对话；条件配置时为 null */
    conversation: { type: Object as PropType<RunConversation | null>, default: null },
    /** 可以上传自定义范围（ADR 0129 起计算和结果阶段也可以）；条件配置时用着的范围显示在输入框上方（ADR 0121） */
    scope: {
      type: Object as PropType<{ readonly composition: CompositionOwner; readonly editor: ScopeEditor } | null>,
      default: null
    }
  },
  setup(props) {
    const text = computed(() => (props.conversation ? props.conversation.text.value : props.composer.text.value));
    const example = computed(() =>
      props.conversation ? props.conversation.example.value : props.composer.example.value
    );
    const busy = computed(() => props.conversation === null && props.composer.sending.value);
    const filePicker = ref<{ open(): void } | null>(null);

    const say = (words?: string) => {
      const { conversation, composer, scope } = props;
      const outcome = conversation ? conversation.send(words) : composer.send(words);
      if (outcome === 'upload') {
        filePicker.value?.open();
      } else if (outcome === 'draw') {
        scope?.editor.start('draw');
      } else if (outcome === 'empty') {
        ElMessage.warning(conversation ? '请输入指令，按 Tab 键填入示例' : '请输入计算指令，按 Tab 键填入示例');
      } else if (outcome === 'unrecognized') {
        ElMessage.warning('未识别到监测指标，可点击"换一批"更换示例');
      } else if (outcome === 'stopped') {
        ElMessage.success('已停止计算，配置的条件已保留');
      }
    };

    // 引导卡上点选城市：一步完成
    const pickCities = (cityCodes: readonly string[]) => {
      const names = cityCodes.map(code => JIANGSU_CITIES.find(city => city.code === code)?.name ?? code);
      props.composer.supplyScope(citiesScope(cityCodes), names.join('、'));
    };

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!busy.value) {
          say();
        }
        return;
      }
      // 空着时 Tab 填入占位的示例；有字时照常移动焦点
      if (event.key === 'Tab' && !event.shiftKey && !event.isComposing && text.value === '' && !busy.value) {
        event.preventDefault();
        if (props.conversation) {
          props.conversation.fillExample();
        } else {
          props.composer.fillExample();
        }
      }
    };

    const onInput = (event: Event) => {
      if (!(event.target instanceof HTMLTextAreaElement)) {
        return;
      }
      if (props.conversation) {
        props.conversation.setText(event.target.value);
      } else {
        props.composer.setText(event.target.value);
      }
    };

    // 用着的自定义范围：像对话里的附件，点开编辑，叉是移除
    const renderAttachment = () => {
      const scope = props.scope;
      const current = scope?.composition.state.value.conditions.scope;
      if (props.conversation || !scope || current?.kind !== 'area' || !current.area) {
        return null;
      }
      const { area } = current;
      const brief = areaBrief(area);
      return (
        <div key="attachment" class={styles.attachment}>
          <button
            type="button"
            class={styles.attachmentOpen}
            title="编辑自定义范围"
            onClick={() => scope.editor.start('edit', { area })}
          >
            <AreaThumbnail outline={area.outline} size={32} />
            <span class={styles.attachmentText}>
              <b>{area.name}</b>
              <span>
                {brief.size} · {brief.where}
              </span>
            </span>
          </button>
          <button
            type="button"
            class={styles.attachmentRemove}
            aria-label="移除自定义范围"
            title="移除"
            onClick={() => scope.composition.setArea(null)}
          >
            <SvgIcon name="close" />
          </button>
        </div>
      );
    };

    return () => {
      const { conversation, composer, scope } = props;
      const sending = busy.value;
      const reply = conversation?.reply.value ?? null;
      const guide = conversation ? null : composer.guide.value;
      return (
        <footer class={styles.root} aria-label="AI 对话">
          {conversation && (
            <div key="suggestions" class={styles.suggestions} role="group" aria-label="快捷说法">
              {conversation.suggestions.value.map(words => (
                <button key={words} type="button" class={styles.suggestion} onClick={() => say(words)}>
                  {words}
                </button>
              ))}
            </div>
          )}
          <div key="inner" class={styles.inner}>
            {guide && (
              <ComposeGuideCard
                key="guide"
                guide={guide}
                onSay={words => say(words)}
                onUpload={files => scope?.editor.start('upload', { files })}
                onDraw={() => scope?.editor.start('draw')}
                onCities={pickCities}
                onStart={() => composer.start()}
              />
            )}
            {renderAttachment()}
            <div key="input" class={[styles.input, !conversation && styles.stacked]} onClick={focusText}>
              <div class={styles.grow} data-value={text.value || example.value}>
                <textarea
                  class={styles.textarea}
                  rows={1}
                  value={text.value}
                  readonly={sending}
                  placeholder={example.value}
                  aria-label={conversation ? '对计算说的话' : '计算指令'}
                  onInput={onInput}
                  onKeydown={onKeydown}
                />
              </div>
              {!conversation && (
                <ElButton
                  key="refresh"
                  class={styles.refresh}
                  link
                  icon={RefreshRight}
                  disabled={sending}
                  onClick={() => composer.refresh()}
                >
                  换一批
                </ElButton>
              )}
              {scope && (
                <AreaFilePicker ref={filePicker} key="upload" onPick={files => scope.editor.start('upload', { files })}>
                  {{
                    default: ({ open }: { readonly open: () => void }) => (
                      <ElButton class={styles.upload} link disabled={sending} onClick={open}>
                        <SvgIcon class={styles.uploadIcon} name="file-upload" />
                        上传范围
                      </ElButton>
                    )
                  }}
                </AreaFilePicker>
              )}
              <ElButton
                key="send"
                class={styles.send}
                type="primary"
                icon={Promotion}
                loading={sending}
                onClick={() => say()}
              >
                {sending ? '配置中' : '发送'}
              </ElButton>
            </div>
            {reply && (
              <p class={styles.reply} role="status">
                <ChatAvatar speaker="assistant" size={20} />
                {reply}
              </p>
            )}
          </div>
        </footer>
      );
    };
  }
});
