import { ArrowDown, ArrowLeft, ArrowUp, Clock, Delete, FullScreen, Plus, Position } from '@element-plus/icons-vue';
import { MxPanel, MxSplitLayout, MxTitle } from '@yzt/ui';
import { geoIdentity, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import {
  ElButton,
  ElDialog,
  ElInput,
  ElMessage,
  ElOption,
  ElSelect
} from 'element-plus';
import { computed, defineComponent, onScopeDispose, ref } from 'vue';
import cityBoundaries from '@/shared/map/boundary/data/jiangsu-city.json';
import { ChatMessages } from './ChatMessages';
import { answer, examples, type PreviewMessage, results } from './preview-data';
import { ResultPreview } from './ResultPreview';
import styles from './preview.module.scss';

// 原型只绘制仓库内的本地区划示意，不挂载地图引擎，不访问瓦片服务
const boundaries = cityBoundaries as GeoPermissibleObjects;
const path = geoPath(geoIdentity().reflectY(true).fitExtent([[40, 20], [560, 380]], boundaries));

/** AI 对话交互预览：保留旧版布局与操作，不调用 AI 服务 */
export const DevAiChatPage = defineComponent({
  name: 'DevAiChatPage',
  setup() {
    const messages = ref<PreviewMessage[]>([]);
    const input = ref('');
    const pending = ref(false);
    const failed = ref(false);
    const scene = ref<'success' | 'error'>('success');
    const history = ref(false);
    const historyKeyword = ref('');
    const sessions = ref(examples.slice(0, 3));
    const deletion = ref<string>();
    const hasResult = ref(false);
    const resultOpen = ref(true);
    const maximized = ref(false);
    const selectedCity = ref('南京市');
    const timer = ref<ReturnType<typeof setTimeout>>();
    const filteredSessions = computed(() => sessions.value.filter(title => title.includes(historyKeyword.value)));

    // 停止与卸载共用清理，避免切走后演示消息继续增长
    function stop() {
      clearTimeout(timer.value);
      timer.value = undefined;
      pending.value = false;
    }
    onScopeDispose(stop);

    function newConversation() {
      stop();
      messages.value = [];
      hasResult.value = false;
      failed.value = false;
      history.value = false;
      input.value = '';
      maximized.value = false;
    }

    function send(text = input.value) {
      if (pending.value || !text.trim()) {
        return;
      }
      failed.value = false;
      input.value = '';
      messages.value.push({ role: 'user', text: text.trim() }, { role: 'assistant', text: '' });
      pending.value = true;
      let length = 0;
      // 分段追加只模拟界面状态，正式流式协议在鉴权及接口确认后接入
      const append = () => {
        if (scene.value === 'error') {
          failed.value = true;
          stop();
          return;
        }
        length += 8;
        const message = messages.value.at(-1);
        if (message) {
          message.text = answer.slice(0, length);
        }
        if (length >= answer.length) {
          stop();
          hasResult.value = true;
          resultOpen.value = true;
          return;
        }
        timer.value = setTimeout(append, 120);
      };
      timer.value = setTimeout(append, 250);
    }

    function openSession(title: string) {
      stop();
      messages.value = [{ role: 'user', text: title }, { role: 'assistant', text: answer }];
      hasResult.value = true;
      resultOpen.value = true;
      history.value = false;
      failed.value = false;
    }

    function renderHistory() {
      return (
        <div class={styles.history}>
          <ElInput
            placeholder="搜索历史对话"
            modelValue={historyKeyword.value}
            onUpdate:modelValue={(value: string) => (historyKeyword.value = value)}
            clearable
          />
          <span class={styles.hint}>演示记录</span>
          {filteredSessions.value.map(title => (
            <div class={styles.historyItem} key={title}>
              <button type="button" onClick={() => openSession(title)}>
                <strong>{title}</strong>
                <span class={styles.hint}>1 轮对话 · 固定示例</span>
              </button>
              <ElButton link icon={Delete} aria-label={`删除${title}`} onClick={() => (deletion.value = title)} />
            </div>
          ))}
          {!filteredSessions.value.length && <p class={styles.hint}>暂无符合条件的历史对话</p>}
        </div>
      );
    }

    function renderComposer() {
      return (
        <div class={styles.composer}>
          <div class={styles.composeActions}>
            <ElInput
              type="textarea"
              rows={2}
              resize="none"
              placeholder="询问空间查询或统计信息"
              modelValue={input.value}
              onUpdate:modelValue={(value: string) => (input.value = value)}
              onKeydown={event => {
                if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            {pending.value ? (
              <ElButton onClick={stop}>停止</ElButton>
            ) : (
              <span title="发送">
                <ElButton
                  type="primary"
                  icon={Position}
                  aria-label="发送"
                  disabled={!input.value.trim()}
                  onClick={() => send()}
                />
              </span>
            )}
          </div>
          <span class={styles.hint}>Enter 发送 · Shift+Enter 换行</span>
        </div>
      );
    }

    function renderMap() {
      return (
        <div class={[styles.map, maximized.value && styles.mapCompact]}>
          <span class={styles.mapCaption}>江苏省行政区划 · 本地边界示意</span>
          <svg viewBox="0 0 600 400" role="img" aria-label="江苏省行政区划示意图">
            {cityBoundaries.features.map((feature, index) => (
              <path
                key={`${feature.properties.code}-${index}`}
                d={path(feature as GeoPermissibleObjects) ?? ''}
                class={feature.properties.name === selectedCity.value && hasResult.value ? styles.activeRegion : ''}
              >
                <title>{feature.properties.name}</title>
              </path>
            ))}
          </svg>
          {hasResult.value && (
            <div class={styles.mapSelection}>
              <span>查看区域</span>
              <ElSelect
                aria-label="查看区域"
                modelValue={selectedCity.value}
                onUpdate:modelValue={(value: string) => (selectedCity.value = value)}
              >
                {results.map(row => <ElOption value={row.name} label={row.name} />)}
              </ElSelect>
            </div>
          )}
        </div>
      );
    }

    return () => (
      <div class={styles.page}>
        <header class={styles.previewHeader}>
          <span>AI 对话 · 交互预览（固定数据，不连接 AI 服务）</span>
          <ElSelect
            aria-label="回答演示状态"
            modelValue={scene.value}
            onUpdate:modelValue={(value: 'success' | 'error') => (scene.value = value)}
          >
            <ElOption value="success" label="回答成功" />
            <ElOption value="error" label="连接失败" />
          </ElSelect>
        </header>
        <div class={styles.workspace}>
          <MxSplitLayout asideLabel="AI 对话">
            {{
              aside: () => (
                <MxPanel headerTone="muted" flush>
                  {{
                    header: () => (
                      <div class={styles.chatHeading}>
                        {history.value && (
                          <ElButton
                            link
                            icon={ArrowLeft}
                            aria-label="返回对话"
                            onClick={() => (history.value = false)}
                          />
                        )}
                        <div class={styles.chatHeadingCopy}>
                          <MxTitle level="panel">{history.value ? '历史对话' : '空间查询助手'}</MxTitle>
                          {!history.value && <span class={styles.hint}>自然资源 GIS 智能查询</span>}
                        </div>
                      </div>
                    ),
                    actions: () => [
                      !history.value && (
                        <span title="历史对话">
                          <ElButton
                            link
                            icon={Clock}
                            aria-label="历史对话"
                            onClick={() => (history.value = true)}
                          />
                        </span>
                      ),
                      <span title="新对话">
                        <ElButton link icon={Plus} aria-label="新对话" onClick={newConversation} />
                      </span>
                    ],
                    default: () => history.value ? renderHistory() : (
                      <ChatMessages
                        messages={messages.value}
                        pending={pending.value}
                        failed={failed.value}
                        onSend={send}
                        onRetry={() => {
                          scene.value = 'success';
                          send(messages.value.at(-2)?.text ?? examples[0]);
                        }}
                      />
                    ),
                    footer: () => !history.value && renderComposer()
                  }}
                </MxPanel>
              ),
              default: () => (
                <div class={styles.main}>
                  {renderMap()}
                  <div
                    class={[
                      styles.results,
                      (!hasResult.value || !resultOpen.value) && styles.collapsed,
                      maximized.value && styles.maximized
                    ]}
                  >
                    <MxPanel title="AI 查询结果" headerTone="muted" flush>
                      {{
                        actions: () => hasResult.value ? [
                          <ElButton link type="primary" onClick={() => ElMessage.info('导出入口演示，正式实现复用公共下载能力')}>
                            导出 Excel
                          </ElButton>,
                          resultOpen.value && (
                            <ElButton
                              link
                              icon={FullScreen}
                              aria-label={maximized.value ? '恢复结果区域' : '放大结果区域'}
                              onClick={() => {
                                maximized.value = !maximized.value;
                                resultOpen.value = true;
                              }}
                            />
                          ),
                          <ElButton
                            link
                            icon={resultOpen.value ? ArrowDown : ArrowUp}
                            aria-label={resultOpen.value ? '收起结果' : '展开结果'}
                            onClick={() => {
                              resultOpen.value = !resultOpen.value;
                              maximized.value = false;
                            }}
                          />
                        ] : [],
                        default: () => hasResult.value && resultOpen.value && <ResultPreview />
                      }}
                    </MxPanel>
                  </div>
                </div>
              )
            }}
          </MxSplitLayout>
        </div>
        <ElDialog
          class="dialog-panel-header"
          modelValue={deletion.value !== undefined}
          title="删除对话"
          width="min(420px, calc(100vw - 32px))"
          onUpdate:modelValue={(open: boolean) => {
            if (!open) {
              deletion.value = undefined;
            }
          }}
        >
          {{
            header: () => <MxTitle level="panel">删除对话</MxTitle>,
            default: () => <p>确定删除“{deletion.value}”吗？此处只删除演示记录。</p>,
            footer: () => [
              <ElButton onClick={() => (deletion.value = undefined)}>取消</ElButton>,
              <ElButton
                type="danger"
                onClick={() => {
                  sessions.value = sessions.value.filter(title => title !== deletion.value);
                  deletion.value = undefined;
                }}
              >
                删除
              </ElButton>
            ]
          }}
        </ElDialog>
      </div>
    );
  }
});
