import { computed, type ComputedRef, type Ref, ref, shallowRef } from 'vue';
import { STEP_GROUPS } from '../engine/steps';
import type { ResultSelection, RunView } from '../result/result-view';
import { interpretView, viewSuggestions } from '../result/view-commands';
import { commandSuggestions, interpretCommand } from '../run/commands';
import type { CompositionOwner } from './useComposition';
import type { ReasoningLog } from './useReasoningLog';
import type { SimulationRun } from './useSimulationRun';
import type { UserPause } from './useUserPause';

/** 发送的结果：输入框是空的、停止了推演（界面回到条件编排）、其余都已回复在时间线上 */
export type ConversationOutcome = 'empty' | 'stopped' | 'replied';

/** 看结果用的：结果的选择、主区在看流程还是结果 */
export interface ResultViewer {
  readonly selection: Readonly<Ref<ResultSelection | null>>;
  readonly view: Readonly<Ref<RunView>>;
  select(patch: Partial<ResultSelection>): void;
  show(view: RunView): void;
}

/** 推演中的对话：推演和结果阶段底部对话栏用它；说的话和 AI 的回复都记在时间线上 */
export interface RunConversation {
  readonly text: Readonly<Ref<string>>;
  setText(text: string): void;
  /** 推演进行中、已暂停、已完成：对话栏的提示和快捷说法按它变 */
  readonly phase: ComputedRef<'running' | 'paused' | 'done'>;
  readonly suggestions: ComputedRef<readonly string[]>;
  /** 看结果时左侧没有时间线：上一句看结果的回复，对话栏写在输入框下面；看流程图时为 null */
  readonly reply: ComputedRef<string | null>;
  /** 发送输入框里的话；传了 text 时发送这句（快捷说法） */
  send(text?: string): ConversationOutcome;
}

const HINT = '没听懂这句话。可以说：暂停、继续、停止；改成旧规程、相交即算、人口增加 10%、公园绿地覆盖率目标 75；加上苏州市、去掉人均公园绿地。';
// 推演完成后还能看结果
const DONE_HINT = '没听懂这句话。看结果可以说：看南京市、按达标着色、看 2025 年、回看推演流程；改推演可以说：改成旧规程、相交即算、加上苏州市、去掉人均公园绿地。';

const groupName = (step: string | null) => STEP_GROUPS.find(group => group.steps.some(item => item === step))?.name ?? '条件解析';

/**
 * 推演中的对话（按规则理解，run/commands.ts）：暂停、继续、停止；改参数时按引擎的规则保存或从受影响的步骤重算，
 * 改年度、范围、指标时从条件解析重算；有改动时先解除用户的暂停。条件编排同步成新的条件，停止后回到编排时就是它。
 * 推演完成后先看是不是看结果的说法（result/view-commands.ts）：只换结果的选择和主区的视图，不重新推演
 */
export function useRunConversation(
  run: SimulationRun,
  composition: CompositionOwner,
  userPause: UserPause,
  log: ReasoningLog,
  viewer: ResultViewer
): RunConversation {
  const text = ref('');
  const lastReply = shallowRef<string | null>(null);
  const state = run.state;
  const phase = computed(() => (state.value.status === 'done' ? 'done' : userPause.paused.value ? 'paused' : 'running'));
  const current = () => {
    const { conditions, params } = state.value;
    if (!conditions) {
      throw new Error('推演没有开始');
    }
    return { conditions, params };
  };

  // AI 的回复记在时间线上，也留一份给看结果时的对话栏
  const say = (words: string) => {
    log.ai(words);
    lastReply.value = words;
  };

  const send = (said?: string): ConversationOutcome => {
    const input = (said ?? text.value).trim();
    if (input === '') {
      return 'empty';
    }
    if (said === undefined) {
      text.value = '';
    }
    log.user(input);
    lastReply.value = null;
    const view = phase.value === 'done' && viewer.selection.value ? interpretView(input, current().conditions) : null;
    if (view) {
      viewer.select(view.patch);
      viewer.show(view.show);
      say(view.reply);
      return 'replied';
    }
    const command = interpretCommand(input, current());
    switch (command.kind) {
      case 'stop':
        run.stop();
        return 'stopped';
      case 'pause':
        if (phase.value === 'done') {
          say('推演已经完成了。直接说要改什么，我会在这一版的基础上重新推演。');
        } else {
          say(userPause.pause() ? '已暂停。说"继续"接着推演，也可以先改参数或范围。' : '推演已经暂停了。');
        }
        return 'replied';
      case 'resume':
        say(userPause.resume() ? '继续推演。' : '推演没有暂停。');
        return 'replied';
      case 'none':
        say(command.notes.length > 0 ? `${command.notes.join('；')}，推演没有变化。` : phase.value === 'done' ? DONE_HINT : HINT);
        return 'replied';
      case 'change':
        break;
    }
    // 改了就重新推演、回到流程图，回复只记在时间线上
    userPause.resume();
    composition.replace(command.composition);
    const head = `好的，${command.said.join('；')}。`;
    const notes = command.notes.length > 0 ? `（${command.notes.join('；')}）` : '';
    if (command.conditionsChanged) {
      run.restart(command.composition);
      log.ai(`${head}从「条件解析」重算。${notes}`);
      return 'replied';
    }
    // 从哪一步起生效：保存时引擎不记重算的起点，先问一遍
    const { restart } = run.planApply(command.composition.params);
    const outcome = run.apply(command.composition.params);
    const reused = STEP_GROUPS.findIndex(group => group.name === groupName(restart));
    const tail =
      outcome === 'saved'
        ? `「${groupName(restart)}」还没执行，执行到时按新的设置。`
        : `从「${groupName(restart)}」重算${reused > 0 ? `，前 ${reused} 步复用` : ''}。`;
    log.ai(`${head}${tail}${notes}`);
    return 'replied';
  };

  return {
    text,
    setText: value => {
      text.value = value;
    },
    phase,
    // 看结果时先给看结果的说法，再给两条改参数的
    suggestions: computed(() => {
      const { conditions } = state.value;
      if (!conditions) {
        return [];
      }
      const list = commandSuggestions(current(), phase.value);
      const selection = viewer.selection.value;
      return phase.value === 'done' && viewer.view.value === 'result' && selection
        ? [...viewSuggestions(conditions, selection), ...list.slice(0, 2)]
        : list;
    }),
    reply: computed(() => (viewer.view.value === 'result' ? lastReply.value : null)),
    send
  };
}
