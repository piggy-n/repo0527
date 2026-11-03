import { LatestController } from '@yzt/utils';
import { computed, type ComputedRef, onScopeDispose, type Ref, ref, shallowRef, watch } from 'vue';
import { REGION_NODE } from '../compose/board';
import { blankOf, buildSteps, scopeSummary } from '../compose/build';
import { type Composition, missingConditions, withScope } from '../compose/composition';
import { type ConditionConflict, conflictsAfterEdit } from '../compose/conflicts';
import { blockerText, canRun, type ComposeGuide, composeGuide, type DialogueLine, knownConditions } from '../compose/guide';
import {
  areaPrompt,
  conflictsAfterReply,
  describeComposition,
  findIndicators,
  type ParsedPrompt,
  parsePrompt,
  PROMPT_EXAMPLES,
  randomPrompt,
  randomScopeReply
} from '../compose/prompt';
import { type ScopeArea, scopeCityCodes, type SimulationScope } from '../model/scope';
import { interpretCommand, isFullInstruction, isStartWord, scopeAction } from '../run/commands';
import type { CompositionOwner } from './useComposition';

/**
 * 发送的结果：输入框是空的、认不出是什么、开始配置、已回复在引导卡上，
 * 或者要上传、绘制范围（由对话栏打开文件选择和弹窗）
 */
export type SendOutcome = 'empty' | 'unrecognized' | 'sent' | 'replied' | 'upload' | 'draw';

/** AI 按指令编排的进度：编排图只显示已经出现的节点 */
export interface BuildState {
  /** 已经出现的节点（编排图的节点键） */
  readonly revealed: ReadonlySet<string>;
  /** 最新出现的节点：闪一下、滚到看得见；还在理解指令时为 null */
  readonly latest: string | null;
  /** AI 在做的事 */
  readonly message: string;
  /** 编排完成，即将开始推演 */
  readonly launching: boolean;
}

/** AI 计算指令的拥有者：输入框的文字、占位的示例、发送后逐个节点配置、等用户补充时的引导；面板和编排图只显示和调用 */
export interface PromptComposer {
  readonly text: Readonly<Ref<string>>;
  /** 输入框空着时占位显示的一句完整示例；等用户补充范围时是回复的示例，正在用自定义范围时写出它的名称 */
  readonly example: Readonly<Ref<string>>;
  /** 按指令配置的进度；没在配置时为 null */
  readonly building: Readonly<Ref<BuildState | null>>;
  readonly sending: ComputedRef<boolean>;
  /** 引导卡的内容；没在等用户时为 null */
  readonly guide: ComputedRef<ComposeGuide | null>;
  /** 还要用户确认的冲突：编排图标为待确认，有冲突时不能开始 */
  readonly conflicts: Readonly<Ref<readonly ConditionConflict[]>>;
  /** 对话发起的配置：没有范围时标"待补充"，纯手动配置时还是原来的占位 */
  readonly asking: ComputedRef<boolean>;
  /** 计算之前的对话：开始计算时接到时间线的最前面 */
  readonly dialogue: Readonly<Ref<readonly DialogueLine[]>>;
  /** 用户输入 */
  setText(text: string): void;
  /** 把示例填进输入框（Tab） */
  fillExample(): void;
  /** 换一批：换成随机组合的一句示例（一定有社区卫生服务设施覆盖率，不和当前的重复），清空输入框让它显示出来 */
  refresh(): void;
  /** 发送输入框里的话；传了 words 时发送这句（引导卡上的选项） */
  send(words?: string): SendOutcome;
  /** 点选城市、弹窗确定后补上范围：一步完成，说过要计算且这样就齐了时自动继续 */
  supplyScope(scope: SimulationScope, words: string): void;
  /** 开始计算：先做执行校验，缺条件或有冲突时不开始，交给引导卡 */
  start(): void;
  /** 计算阶段移除了范围：回到条件配置，标为待补充，补齐后自动继续 */
  awaitScope(said: readonly string[]): void;
}

export interface PromptComposerOptions {
  /** 换示例用的随机数，测试固定它 */
  readonly random?: () => number;
  /** 配置完成：页面接着开始计算 */
  readonly onComposed?: () => void;
}

// 理解指令、出现每个节点、配置完成到开始计算的间隔（毫秒）
const THINK_MS = 900;
const STEP_MS = 450;
const LAUNCH_MS = 1000;

const HINT = '未能识别，可以直接说范围（南京市、全省）、年份、指标（加上人均公园绿地）或参数（按旧规程）';

// 等一段时间；中止时提前结束，调用方返回后再看信号
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

// 等一段时间，返回 false 是被作废了。减少动画时也等：逐个出现是演示的内容，不是动效
async function pause(ms: number, signal: AbortSignal): Promise<boolean> {
  await wait(ms, signal);
  return !signal.aborted;
}

// 引导卡开头的话：改了什么合成一句"已调整"；已经写着"已……"的（如已移除）单独一句
const saidLines = (said: readonly string[]): string[] => {
  const adjusted = said.filter(line => !line.startsWith('已'));
  return [...(adjusted.length > 0 ? [`已调整：${adjusted.join('；')}`] : []), ...said.filter(line => line.startsWith('已'))];
};

const isBlank = ({ conditions }: Composition) =>
  conditions.years.length === 0 && conditions.indicatorIds.length === 0 && scopeCityCodes(conditions.scope).length === 0;

/**
 * AI 计算指令：不接大模型，按规则解析（compose/prompt.ts）。打开页面时输入框是空的、占位显示第一条示例，编排也是空的；
 * 发送后编排图先清空，"理解指令"一会儿，再按 buildSteps 逐个出现节点，完成后交给页面开始计算。
 * 条件不全或有冲突时停在配置阶段（ADR 0129）：引导卡问用户，这期间说的话只改说到的条件；回复、点选项、弹窗确定补齐后自动继续，
 * 手动在条件库里点选不自动开始（可能还要多选）。
 * 手动改编排会停下正在进行的配置（也不再自动计算）；输入框里还是上次发送或自动生成的描述时，
 * 改写成当前编排的描述，用户自己改过文字后不再改写
 */
export function usePromptComposer(composition: CompositionOwner, options: PromptComposerOptions = {}): PromptComposer {
  const { random = Math.random, onComposed } = options;
  const text = ref('');
  const cityExample = ref(PROMPT_EXAMPLES[0] ?? '');
  const scopeExample = ref('南京市、苏州市');
  const area = computed(() => {
    const { scope } = composition.state.value.conditions;
    return scope.kind === 'area' ? scope.area : null;
  });
  const building = shallowRef<BuildState | null>(null);
  // 用户说过要计算：条件补齐后自动继续
  const intent = ref(false);
  // 引导卡显示着
  const guideOn = ref(false);
  const conflicts = shallowRef<readonly ConditionConflict[]>([]);
  // 引导卡开头的话：刚改了什么、没改的原因
  const said = shallowRef<readonly string[]>([]);
  // 刚移除的市：引导卡给"恢复"
  const removedCities = shallowRef<readonly string[]>([]);
  const dialogue = shallowRef<readonly DialogueLine[]>([]);
  // 不阻断的说明：开始计算时写进时间线
  let notes: readonly string[] = [];

  const missingScope = () => missingConditions(composition.state.value.conditions).includes('region');

  // 换一批换上的话记下是哪个范围的：换了范围就回到新范围的默认示例
  const areaPick = shallowRef<{ readonly area: ScopeArea; readonly text: string } | null>(null);
  const example = computed(() => {
    const [conflict] = conflicts.value;
    if (guideOn.value && conflict) {
      return conflict.options[0]?.say ?? '';
    }
    if (guideOn.value && missingScope()) {
      return scopeExample.value;
    }
    const current = area.value;
    if (!current) {
      return cityExample.value;
    }
    return areaPick.value?.area === current ? areaPick.value.text : areaPrompt(current);
  });
  // 输入框里是不是当前编排的描述
  let synced = false;
  // 这里自己在改编排：侦听里据此区分手动修改
  let writing = false;
  const buildRun = new LatestController();
  onScopeDispose(() => buildRun[Symbol.dispose]());

  const write = (next: Composition) => {
    writing = true;
    try {
      composition.replace(next);
    } finally {
      writing = false;
    }
  };

  const stopBuilding = () => {
    buildRun.abort();
    building.value = null;
  };

  const clearConversation = () => {
    intent.value = false;
    guideOn.value = false;
    conflicts.value = [];
    said.value = [];
    removedCities.value = [];
    dialogue.value = [];
    notes = [];
  };

  // 记下刚移除的市；范围有了就不用再恢复
  const noteRemoved = (before: Composition, after: Composition) => {
    const previous = before.conditions.scope;
    const next = after.conditions.scope;
    if (scopeCityCodes(next).length > 0) {
      removedCities.value = [];
    } else if (previous.kind === 'cities' && previous.cityCodes.length > 0) {
      removedCities.value = previous.cityCodes;
    }
  };

  // 同步侦听：在改编排的同一刻知道是不是自己改的
  watch(
    () => composition.state.value,
    (state, before) => {
      if (writing) {
        return;
      }
      const wasBuilding = building.value !== null;
      stopBuilding();
      if (wasBuilding || isBlank(state)) {
        clearConversation();
      } else {
        conflicts.value = conflictsAfterEdit(conflicts.value, before, state);
        said.value = [];
        noteRemoved(before, state);
      }
      if (!synced) {
        return;
      }
      // 条件不全（如重置）时留着原来的话，之后不再改写
      const description = describeComposition(state);
      if (description === '') {
        synced = false;
        return;
      }
      text.value = description;
    },
    { flush: 'sync' }
  );

  // 输入框里还是填进来的示例时跟着换，不留着上一个范围的话；用户改过的不动，按指令配置的中途不算
  watch(
    example,
    (next, previous) => {
      if (!writing && text.value === previous) {
        text.value = next;
      }
    },
    { flush: 'sync' }
  );

  const setText = (value: string) => {
    synced = false;
    text.value = value;
  };

  const tell = (line: DialogueLine) => {
    dialogue.value = [...dialogue.value, line];
  };

  // 交给页面开始计算：页面在回调里读对话，读完就清空
  const finish = () => {
    dialogue.value = [...dialogue.value, ...notes.map((note): DialogueLine => ({ speaker: 'ai', text: `${note}。` }))];
    onComposed?.();
    building.value = null;
    clearConversation();
  };

  // 等用户：输入框腾出来回复，这句话进对话记录
  const askUser = () => {
    building.value = null;
    guideOn.value = true;
    setText('');
    const { conditions } = composition.state.value;
    tell({ speaker: 'ai', text: `已识别 ${knownConditions(composition.state.value)}。${blockerText(conditions, conflicts.value)}。` });
  };

  const build = async ({ composition: target, conflicts: found, notes: parsedNotes, keptScope }: ParsedPrompt) => {
    const signal = buildRun.next();
    write(blankOf(target));
    guideOn.value = false;
    intent.value = true;
    said.value = [];
    removedCities.value = [];
    conflicts.value = found;
    notes = parsedNotes;
    building.value = { revealed: new Set(), latest: null, message: 'AI 正在理解指令…', launching: false };
    if (!(await pause(THINK_MS, signal))) {
      return;
    }
    const ready = canRun(target.conditions, found);
    const revealed = new Set<string>();
    const steps = buildSteps(target, { conflicts: found, keptScope });
    for (const [index, step] of steps.entries()) {
      write(step.composition);
      revealed.add(step.node);
      const last = index === steps.length - 1;
      building.value = { revealed: new Set(revealed), latest: step.node, message: step.message, launching: last && ready };
      // oxlint-disable-next-line no-await-in-loop -- 节点一个一个出现，每个之间要等
      if (!(await pause(last && ready ? LAUNCH_MS : STEP_MS, signal))) {
        return;
      }
    }
    if (!ready) {
      askUser();
      return;
    }
    synced = true;
    finish();
  };

  // 条件补齐：节点都已经在图上，写一句话，等一会儿开始计算
  const resume = async (line: string) => {
    const signal = buildRun.next();
    const target = composition.state.value;
    tell({ speaker: 'ai', text: `${line}，开始计算。` });
    guideOn.value = false;
    said.value = [];
    const revealed = new Set(buildSteps(target).map(step => step.node));
    building.value = { revealed, latest: REGION_NODE, message: `${line}，即将开始计算`, launching: true };
    if (!(await pause(LAUNCH_MS, signal))) {
      return;
    }
    setText(describeComposition(target));
    synced = true;
    finish();
  };

  // 跟进的一句话：只改说到的条件，其余不变；这句话补齐了条件、又说过要计算时自动继续
  const followUp = (input: string): SendOutcome => {
    const current = composition.state.value;
    const command = interpretCommand(input, current);
    const blockedBefore = !canRun(current.conditions, conflicts.value);
    const remaining = conflictsAfterReply(conflicts.value, input);
    const answered = remaining.length < conflicts.value.length;
    if (command.kind === 'none' && command.notes.length === 0 && !answered && !guideOn.value) {
      return 'unrecognized';
    }
    tell({ speaker: 'user', text: input });
    setText('');
    guideOn.value = true;
    conflicts.value = remaining;
    switch (command.kind) {
      case 'stop':
      case 'pause':
      case 'resume':
        said.value = ['还没有开始计算'];
        return 'replied';
      case 'conflict':
        said.value = [];
        conflicts.value = [
          ...remaining.filter(item => !command.conflicts.some(conflict => conflict.key === item.key)),
          ...command.conflicts
        ];
        return 'replied';
      case 'none':
        said.value = answered ? [] : command.notes.length > 0 ? command.notes : [HINT];
        break;
      case 'change':
        write(command.composition);
        noteRemoved(current, command.composition);
        said.value = [...saidLines(command.said), ...command.notes];
        break;
    }
    const next = composition.state.value;
    if (intent.value && blockedBefore && canRun(next.conditions, remaining)) {
      const filled = missingConditions(current.conditions).includes('region');
      const firstSaid = command.kind === 'change' ? command.said[0] : undefined;
      void resume(filled ? `已补充范围：${scopeSummary(next.conditions.scope)}` : (firstSaid ?? '条件已确认'));
    }
    return 'replied';
  };

  const check = (): boolean => {
    if (canRun(composition.state.value.conditions, conflicts.value)) {
      return true;
    }
    stopBuilding();
    guideOn.value = true;
    said.value = [];
    return false;
  };

  return {
    text,
    example,
    building,
    sending: computed(() => building.value !== null),
    guide: computed(() =>
      guideOn.value && building.value === null
        ? composeGuide(composition.state.value, {
            conflicts: conflicts.value,
            said: said.value,
            intent: intent.value,
            removedCities: removedCities.value
          })
        : null
    ),
    conflicts,
    asking: computed(() => intent.value || guideOn.value),
    dialogue,
    setText,
    fillExample: () => setText(example.value),
    refresh: () => {
      const current = area.value;
      if (guideOn.value && missingScope()) {
        scopeExample.value = randomScopeReply(random, scopeExample.value);
      } else if (current) {
        areaPick.value = { area: current, text: randomPrompt(random, [example.value], current) };
      } else {
        cityExample.value = randomPrompt(random, [cityExample.value]);
      }
      setText('');
    },
    send: words => {
      const input = (words ?? text.value).trim();
      if (input === '') {
        return 'empty';
      }
      const action = scopeAction(input);
      if (action) {
        setText('');
        return action;
      }
      if (isStartWord(input)) {
        setText('');
        if (check()) {
          stopBuilding();
          finish();
        }
        return 'replied';
      }
      const current = composition.state.value;
      // 编排是空的时候说指标就是一条指令，不用管有没有"加上"这类动词
      if (isFullInstruction(input) || (isBlank(current) && findIndicators(input.replace(/\s+/g, '')).length > 0)) {
        const parsed = parsePrompt(input, current);
        if (parsed.ok) {
          dialogue.value = [{ speaker: 'user', text: input }];
          void build(parsed);
          return 'sent';
        }
      }
      if (isBlank(current) && !guideOn.value) {
        return 'unrecognized';
      }
      return followUp(input);
    },
    supplyScope: (scope, words) => {
      const current = composition.state.value;
      const blockedBefore = !canRun(current.conditions, conflicts.value);
      const next = withScope(current, scope);
      write(next);
      conflicts.value = conflictsAfterEdit(conflicts.value, current, next);
      removedCities.value = [];
      tell({ speaker: 'user', text: words });
      const line = `已补充范围：${scopeSummary(scope)}`;
      if (intent.value && blockedBefore && canRun(next.conditions, conflicts.value)) {
        void resume(line);
        return;
      }
      said.value = [line];
      guideOn.value = true;
    },
    start: () => {
      if (check()) {
        stopBuilding();
        finish();
      }
    },
    awaitScope: lines => {
      stopBuilding();
      dialogue.value = [];
      conflicts.value = [];
      notes = [];
      intent.value = true;
      guideOn.value = true;
      said.value = lines;
      setText('');
    }
  };
}
