import { computed, type ComputedRef, type Ref, ref, shallowRef } from 'vue';
import { missingConditions, rememberedScopes, withArea } from '../compose/composition';
import { STEP_GROUPS } from '../engine/steps';
import type { ResultSelection, RunView } from '../result/result-view';
import { areaLabel, type ScopeArea } from '../model/scope';
import { interpretView, viewSuggestions } from '../result/view-commands';
import { commandSuggestions, interpretCommand, scopeAction } from '../run/commands';
import type { CompositionOwner } from './useComposition';
import type { ReasoningLog } from './useReasoningLog';
import type { SimulationRun } from './useSimulationRun';
import type { UserPause } from './useUserPause';

/**
 * 发送的结果：输入框是空的、停止了推演（界面回到条件编排）、移除了范围（回到条件配置等补充）、其余都已回复在时间线上；
 * upload、draw 由对话栏打开文件选择和弹窗
 */
export type ConversationOutcome = 'empty' | 'stopped' | 'scope-removed' | 'replied' | 'upload' | 'draw';

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
  /** 输入框空着时占位显示的一句完整说法：快捷说法里第一条不是暂停、停止这类控制的 */
  readonly example: ComputedRef<string>;
  /** 把示例填进输入框（Tab） */
  fillExample(): void;
  /** 看结果时左侧没有时间线：上一句看结果的回复，对话栏写在输入框下面；看流程图时为 null */
  readonly reply: ComputedRef<string | null>;
  /** 发送输入框里的话；传了 text 时发送这句（快捷说法） */
  send(text?: string): ConversationOutcome;
  /** 弹窗里确定了新的自定义范围：从条件解析重算（ADR 0129） */
  applyArea(area: ScopeArea): void;
}

export interface RunConversationHooks {
  /** 范围被移除：计算没法继续，页面回到条件配置等补充；说明这句话改了什么 */
  readonly onScopeRemoved?: (said: readonly string[]) => void;
}

const HINT = '未能识别该指令，可尝试：暂停、继续、停止；改成旧规程、相交即算、人口增加 10%；加上苏州市、移除范围、去掉人均公园绿地。';
// 推演完成后还能看结果
const DONE_HINT =
  '未能识别该指令。查看结果可尝试：看南京市、看 2025 年、回看计算流程；调整条件可尝试：改成旧规程、相交即算、加上苏州市、移除范围、去掉人均公园绿地。';

// 控制计算的快捷说法：太短，不拿来做占位的示例
const CONTROLS: ReadonlySet<string> = new Set(['暂停', '继续', '停止计算', '调整条件', '回看计算流程', '绘制范围', '移除范围']);

const groupName = (step: string | null) =>
  STEP_GROUPS.find(group => group.steps.some(item => item === step))?.name ?? '条件解析';

/**
 * 推演中的对话（按规则理解，run/commands.ts）：暂停、继续、停止；改参数时按引擎的规则保存或从受影响的步骤重算，
 * 改年度、范围、指标时从条件解析重算；有改动时先解除用户的暂停。条件编排同步成新的条件，停止后回到编排时就是它。
 * 范围被移除时停止计算，回到条件配置等补充；要上传或绘制新范围时打开弹窗（ADR 0129）。
 * 推演完成后先看是不是看结果的说法（result/view-commands.ts）：只换结果的选择和主区的视图，不重新推演
 */
export function useRunConversation(
  run: SimulationRun,
  composition: CompositionOwner,
  userPause: UserPause,
  log: ReasoningLog,
  viewer: ResultViewer,
  hooks: RunConversationHooks = {}
): RunConversation {
  const text = ref('');
  const lastReply = shallowRef<string | null>(null);
  const state = run.state;
  const phase = computed(() =>
    state.value.status === 'done' ? 'done' : userPause.paused.value ? 'paused' : 'running'
  );
  // 条件和参数以计算为准；记下的另一种范围（如上传的自定义范围）在条件配置的拥有者里
  const current = () => {
    const { conditions, params } = state.value;
    if (!conditions) {
      throw new Error('计算没有开始');
    }
    return { conditions, params, scopes: rememberedScopes(composition.state.value) };
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
    const action = scopeAction(input);
    if (action === 'draw') {
      // 只记在时间线上：取消后不该留在结果页的输入框下面
      log.ai(phase.value === 'done' ? '已打开地图绘制；确定后将从「条件解析」重新计算。' : '已打开地图绘制，计算暂停；确定后将从「条件解析」重新计算，取消后继续。');
    }
    if (action) {
      return action;
    }
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
          say('计算已完成。请说明需要调整的内容，将在当前版本基础上重新计算。');
        } else {
          say(userPause.pause() ? '已暂停。输入"继续"恢复计算，也可先调整参数或范围。' : '计算已处于暂停状态。');
        }
        return 'replied';
      case 'resume':
        say(userPause.resume() ? '继续计算。' : '计算未暂停。');
        return 'replied';
      case 'conflict':
        say(`${command.conflicts[0]?.question ?? ''}计算条件未变化。`);
        return 'replied';
      case 'none':
        if (command.notes.length > 0) {
          say(`${command.notes.join('；')}，计算条件未变化。`);
        } else {
          say(phase.value === 'done' ? DONE_HINT : HINT);
        }
        return 'replied';
      case 'change':
        break;
    }
    // 改了就重新推演、回到流程图，回复只记在时间线上
    userPause.resume();
    composition.replace(command.composition);
    // 执行校验：范围没了就不能重算，回到条件配置，其余条件保留
    if (missingConditions(command.composition.conditions).length > 0) {
      const stopping = phase.value !== 'done';
      run.stop();
      hooks.onScopeRemoved?.([...command.said, stopping ? '计算已停止，其他条件已保留' : '其他条件已保留']);
      return 'scope-removed';
    }
    const head = `已调整：${command.said.join('；')}。`;
    const notes = command.notes.length > 0 ? `（${command.notes.join('；')}）` : '';
    if (command.conditionsChanged) {
      run.restart(command.composition);
      log.ai(`${head}将从「条件解析」重新计算。${notes}`);
      return 'replied';
    }
    // 从哪一步起生效：保存时引擎不记重算的起点，先问一遍
    const { restart } = run.planApply(command.composition.params);
    const outcome = run.apply(command.composition.params);
    const reused = STEP_GROUPS.findIndex(group => group.name === groupName(restart));
    const tail =
      outcome === 'saved'
        ? `「${groupName(restart)}」尚未执行，执行时将采用新设置。`
        : `将从「${groupName(restart)}」重新计算${reused > 0 ? `，前 ${reused} 步沿用已有结果` : ''}。`;
    log.ai(`${head}${tail}${notes}`);
    return 'replied';
  };

  // 看结果时先给看结果的说法，再给两条改参数的
  const suggestions = computed(() => {
    const { conditions } = state.value;
    if (!conditions) {
      return [];
    }
    const list = commandSuggestions(current(), phase.value);
    const selection = viewer.selection.value;
    return phase.value === 'done' && viewer.view.value === 'result' && selection
      ? [...viewSuggestions(conditions, selection), ...list.slice(0, 2), '绘制范围', '移除范围']
      : list;
  });
  const example = computed(() => suggestions.value.find(words => !CONTROLS.has(words)) ?? suggestions.value[0] ?? '');

  return {
    text,
    setText: value => {
      text.value = value;
    },
    phase,
    suggestions,
    example,
    fillExample: () => {
      text.value = example.value;
    },
    reply: computed(() => (viewer.view.value === 'result' ? lastReply.value : null)),
    send,
    applyArea: area => {
      const next = withArea(current(), area);
      lastReply.value = null;
      log.user(`${area.source === 'upload' ? '上传' : '绘制'}范围「${area.name}」`);
      userPause.resume();
      composition.replace(next);
      run.restart(next);
      log.ai(`已调整：范围改为${areaLabel(area)}，涉及 ${area.coverage.covers.length} 个区县。将从「条件解析」重新计算。`);
    }
  };
}
