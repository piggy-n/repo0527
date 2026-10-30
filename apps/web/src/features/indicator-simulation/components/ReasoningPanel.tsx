import { ArrowDown, ArrowRight, Back, View } from '@element-plus/icons-vue';
import { useRafFn, useResizeObserver } from '@vueuse/core';
import { MxPanel } from '@yzt/ui';
import { ElButton, ElIcon } from 'element-plus';
import { computed, defineComponent, type PropType, ref, shallowRef, watch } from 'vue';
import { ChatAvatar } from '@/shared/chat-avatar/ChatAvatar';
import type { LogEntry, ReasoningLog } from '../composables/useReasoningLog';
import type { SimulationRun } from '../composables/useSimulationRun';
import { STEP_GROUPS, type StepGroupId } from '../engine/steps';
import { lineTimings, typedChars } from '../flow/frame';
import type { FlowPlan } from '../flow/plan';
import { plainText, type Rich } from '../run/narrative';
import styles from './ReasoningPanel.module.scss';
import { RichText } from './RichText';

// AI 回复先想一会儿，再每个字这么多毫秒地打出来
const REPLY_THINK_MS = 600;
const REPLY_MS = 18;
// 思考时的提示每隔这么久换一句：每步开始想的时候能换一次
const HINT_MS = 550;

// 每一步开始思考时的动态提示，按经过的时间轮换
const THINKING: Readonly<Record<StepGroupId, readonly string[]>> = {
  parse: ['正在理解指令', '正在拆分年份、范围和指标', '正在规划计算路线'],
  prep: ['正在连接人口库', '正在载入设施图层', '正在读取国土变更调查'],
  qc: ['正在核对区县字段', '正在检查设施坐标'],
  spatial: ['正在生成服务范围', '正在叠加住宅用地'],
  compute: ['正在逐区县计算', '正在汇总到市和全省'],
  report: ['正在汇总各项指标', '正在归纳结论']
};
// 离底部不到这么多像素算在底部：新内容出现时跟着滚
const STICKY = 24;

const groupIndex = (group: StepGroupId) => STEP_GROUPS.findIndex(item => item.id === group);

// 打出的几句：正在打的一句末尾有光标；live 时两句之间的停顿也留在最后一句末尾
const renderLines = (lines: readonly { text: Rich; typed: number; typing: boolean }[], live = false) =>
  lines.map((line, index) => (
    <p key={index} class={styles.line}>
      <RichText text={line.text} limit={line.typed} />
      {(line.typing || (live && index === lines.length - 1)) && <span class={styles.caret} />}
    </p>
  ));

// 思考中：跳动的三个点和一句轮换的提示
const renderThinking = (hint: string) => (
  <p key="thinking" class={styles.thinking}>
    <span class={styles.dots} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
    <span class={styles.hint}>{hint}…</span>
  </p>
);

/**
 * AI计算：思维链、打字和对话在一条时间线上。进行中的一步按进度逐字打出，完成后收成一行摘要（点开看全文）；
 * 用户的话靠右、右侧是"我"的头像，AI 的回复以机器人头像开头、逐字出现；新内容出现时跟着滚到底，
 * 用户往上翻时不跟，可以点"回到最新"。计算完成后底部固定"查看结果"和"调整条件"
 */
export const ReasoningPanel = defineComponent({
  name: 'ReasoningPanel',
  props: {
    run: { type: Object as PropType<SimulationRun>, required: true },
    log: { type: Object as PropType<ReasoningLog>, required: true },
    plan: { type: Object as PropType<FlowPlan | null>, default: null }
  },
  emits: {
    /** 悬停在一步上：流程图里这一列高亮；离开时为 null */
    hover: (column: number | null) => column === null || typeof column === 'number',
    /** 计算完成后点"查看结果" */
    result: () => true,
    /** 计算完成后点"调整条件"：回到条件配置 */
    recompose: () => true
  },
  setup(props, { emit }) {
    const body = ref<HTMLElement>();
    const list = ref<HTMLElement>();
    const expanded = shallowRef<ReadonlySet<number>>(new Set());
    const sticky = ref(true);
    let autoTop = -1;
    // AI 回复的打字：只在还有没打完的回复时逐帧刷新
    const now = ref(performance.now());
    const typingReply = computed(() =>
      props.log.entries.value.some(
        entry => entry.kind === 'ai' && (now.value - entry.at - REPLY_THINK_MS) / REPLY_MS < entry.text.length
      )
    );
    const ticker = useRafFn(() => (now.value = performance.now()), { immediate: false });
    watch(
      () => props.log.entries.value,
      () => {
        now.value = performance.now();
      }
    );
    // 挂载时就可能有没打完的回复：看结果时说"回看计算流程"，回复先记上，面板随后才挂上
    watch(
      typingReply,
      typing => {
        if (typing) {
          ticker.resume();
        } else {
          ticker.pause();
        }
      },
      { immediate: true }
    );

    const state = props.run.state;
    const timings = computed(() => (props.plan ? lineTimings(props.plan) : []));
    const groupDone = (group: StepGroupId) =>
      (STEP_GROUPS[groupIndex(group)]?.steps ?? []).every(step =>
        ['done', 'reused'].includes(state.value.steps[step].status)
      );
    const doneCount = computed(() => STEP_GROUPS.filter(group => groupDone(group.id)).length);

    const scrollToEnd = () => {
      const element = body.value;
      if (element && sticky.value) {
        element.scrollTop = element.scrollHeight;
        autoTop = element.scrollTop;
      }
    };
    // 内容随打字和新消息变长时跟着滚：时间线画在 MxPanel 的插槽里，重画的是 MxPanel，这里的 onUpdated 不触发，按列表的尺寸变化跟
    useResizeObserver(list, scrollToEnd);

    const onScroll = () => {
      const element = body.value;
      // 自动滚到底引起的滚动不算
      if (!element || Math.abs(element.scrollTop - autoTop) < 2) {
        return;
      }
      sticky.value = element.scrollHeight - element.scrollTop - element.clientHeight < STICKY;
    };
    const toggle = (id: number) => {
      const next = new Set(expanded.value);
      if (!next.delete(id)) {
        next.add(id);
      }
      expanded.value = next;
    };

    // 这一步开始后经过的毫秒：数据准备三路并行，取走得最远的
    const elapsedOf = (group: StepGroupId) =>
      Math.max(
        ...(STEP_GROUPS[groupIndex(group)]?.steps ?? []).map(
          step => props.run.progress(step) * state.value.durations[step]
        )
      );

    // 一步正在打的话：所属步骤的进度换算成经过的毫秒
    const liveLines = (group: StepGroupId) => {
      const plan = props.plan;
      const steps = STEP_GROUPS[groupIndex(group)]?.steps ?? [];
      if (!plan) {
        return [];
      }
      return plan.lines.flatMap((line, index) => {
        const timing = timings.value[index];
        if (!steps.includes(line.step) || !timing) {
          return [];
        }
        const elapsed = props.run.progress(line.step) * state.value.durations[line.step];
        const typed = typedChars(timing, elapsed);
        return typed > 0 ? [{ text: line.text, typed, typing: typed < plainText(line.text).length }] : [];
      });
    };

    const renderStep = (entry: Extract<LogEntry, { kind: 'step' }>) => {
      const group = STEP_GROUPS[groupIndex(entry.group)];
      const frozen = entry.frozen;
      const done = frozen === null && groupDone(entry.group);
      const open = expanded.value.has(entry.id);
      let status: string;
      let className: string | undefined;
      if (frozen?.state === 'stopped') {
        status = '已中断';
        className = styles.stopped;
      } else if (frozen) {
        status = '已调整';
        className = styles.outdated;
      } else if (done) {
        status = '完成';
        className = styles.done;
      } else {
        status = state.value.paused ? '已暂停' : '进行中';
        className = styles.running;
      }
      const collapsible = frozen?.state === 'outdated' || done;
      let content = null;
      if (frozen?.state === 'outdated') {
        content = open
          ? renderLines(frozen.lines.map(text => ({ text, typed: Number.POSITIVE_INFINITY, typing: false })))
          : null;
      } else if (done) {
        content = open ? renderLines(liveLines(entry.group)) : null;
      } else if (frozen === null) {
        // 还没打出字时在思考：提示按经过的时间轮换
        const lines = liveLines(entry.group);
        const hints = THINKING[entry.group];
        content =
          lines.length > 0
            ? renderLines(lines, true)
            : renderThinking(hints[Math.floor(elapsedOf(entry.group) / HINT_MS) % hints.length] ?? '正在思考');
      }
      const summary = frozen ? frozen.summary : done ? (props.plan?.summaries[entry.group] ?? null) : null;
      return (
        <li
          key={entry.id}
          class={[styles.entry, styles.step, className]}
          onMouseenter={() => emit('hover', groupIndex(entry.group))}
          onMouseleave={() => emit('hover', null)}
        >
          <span class={styles.dot} />
          <button
            type="button"
            class={styles.head}
            disabled={!collapsible}
            aria-expanded={collapsible ? open : undefined}
            onClick={() => toggle(entry.id)}
          >
            <span class={styles.title}>{group?.name}</span>
            {entry.rerun && <span class={styles.badge}>重算</span>}
            <span class={styles.status}>{status}</span>
            {collapsible && <ElIcon class={styles.chevron}>{open ? <ArrowDown /> : <ArrowRight />}</ElIcon>}
          </button>
          {content && <div class={styles.text}>{content}</div>}
          {summary !== null && !open && <p class={styles.summary}>{summary}</p>}
        </li>
      );
    };

    const renderEntry = (entry: LogEntry) => {
      switch (entry.kind) {
        case 'user':
          return (
            <li key={entry.id} class={[styles.entry, styles.user]}>
              <div class={styles.bubble}>{entry.text}</div>
              <ChatAvatar speaker="user" size={24} />
            </li>
          );
        case 'ai': {
          const since = now.value - entry.at - REPLY_THINK_MS;
          const typed = Math.min(entry.text.length, Math.floor(since / REPLY_MS));
          return (
            <li key={entry.id} class={[styles.entry, styles.ai]}>
              <ChatAvatar class={styles.avatar} speaker="assistant" size={24} />
              {since < 0 ? (
                renderThinking('正在思考')
              ) : (
                <p class={styles.line}>
                  {entry.text.slice(0, typed)}
                  {typed < entry.text.length && <span class={styles.caret} />}
                </p>
              )}
            </li>
          );
        }
        case 'step':
          break;
      }
      return renderStep(entry);
    };

    // 下一步的虚影：最后一条进行中的步骤之后；还没有步骤在执行时（规划步骤、调整后等待重算）先显示在思考
    const ghost = () => {
      const { status, steps } = state.value;
      if (status !== 'planning' && status !== 'running') {
        return null;
      }
      const idle = STEP_GROUPS.every(group => group.steps.every(step => steps[step].status !== 'running'));
      const planning = idle && (
        <li key="planning" class={[styles.entry, styles.running]}>
          <span class={styles.dot} />
          {renderThinking(status === 'planning' ? '正在规划计算步骤' : '正在根据调整重新安排步骤')}
        </li>
      );
      const next = STEP_GROUPS.find(group =>
        group.steps.every(step => ['waiting', 'stale'].includes(state.value.steps[step].status))
      );
      return [
        planning,
        next && (
          <li key="ghost" class={[styles.entry, styles.ghost]}>
            <span class={styles.dot} />
            <div class={styles.head}>
              <span class={styles.title}>下一步 · {next.name}</span>
            </div>
          </li>
        )
      ];
    };

    // 计算完成后底部固定"查看结果"和"调整条件"
    const renderFooter = () => [
      <ElButton
        key="result"
        class={['button-xl', styles.action]}
        type="primary"
        icon={View}
        onClick={() => emit('result')}
      >
        查看结果
      </ElButton>,
      <ElButton key="recompose" class={['button-xl', styles.action]} icon={Back} onClick={() => emit('recompose')}>
        调整条件
      </ElButton>
    ];

    return () => {
      const done = state.value.status === 'done';
      return (
        <MxPanel class={styles.panel} title="AI计算" headerTone="muted" flush>
          {{
            actions: () => (
              <span class={styles.meta}>
                完成 {doneCount.value}/{STEP_GROUPS.length} 步
              </span>
            ),
            footer: done ? renderFooter : undefined,
            default: () => (
              <div class={styles.wrap}>
                <div ref={body} class={styles.body} onScroll={onScroll}>
                  <ol ref={list} class={styles.timeline}>
                    {props.log.entries.value.map(renderEntry)}
                    {ghost()}
                  </ol>
                </div>
                {!sticky.value && (
                  <ElButton
                    class={styles.latest}
                    size="small"
                    round
                    icon={ArrowDown}
                    onClick={() => {
                      sticky.value = true;
                      scrollToEnd();
                    }}
                  >
                    回到最新
                  </ElButton>
                )}
              </div>
            )
          }}
        </MxPanel>
      );
    };
  }
});
