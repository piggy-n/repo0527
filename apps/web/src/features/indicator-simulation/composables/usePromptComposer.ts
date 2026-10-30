import { LatestController } from '@yzt/utils';
import { computed, type ComputedRef, onScopeDispose, type Ref, ref, shallowRef, watch } from 'vue';
import { buildSteps } from '../compose/build';
import { type Composition, emptyComposition } from '../compose/composition';
import { describeComposition, parsePrompt, PROMPT_EXAMPLES, randomPrompt } from '../compose/prompt';
import type { CompositionOwner } from './useComposition';

/** 发送的结果：输入框是空的、认不出指标、开始编排 */
export type SendOutcome = 'empty' | 'unrecognized' | 'sent';

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

/** AI 计算指令的拥有者：输入框的文字、占位的示例、发送后逐个节点配置；面板和编排图只显示和调用 */
export interface PromptComposer {
  readonly text: Readonly<Ref<string>>;
  /** 输入框空着时占位显示的一句完整示例 */
  readonly example: Readonly<Ref<string>>;
  /** 按指令配置的进度；没在配置时为 null */
  readonly building: Readonly<Ref<BuildState | null>>;
  readonly sending: ComputedRef<boolean>;
  /** 用户输入 */
  setText(text: string): void;
  /** 把示例填进输入框（Tab） */
  fillExample(): void;
  /** 换一批：换成随机组合的一句示例（一定有社区卫生服务设施覆盖率，不和当前的重复），清空输入框让它显示出来 */
  refresh(): void;
  send(): SendOutcome;
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

/**
 * AI 计算指令：不接大模型，按规则解析（compose/prompt.ts）。打开页面时输入框是空的、占位显示第一条示例，编排也是空的；
 * 发送后编排图先清空，"理解指令"一会儿，再按 buildSteps 逐个出现节点，完成后交给页面开始计算。
 * 手动改编排会停下正在进行的配置（也不再自动计算）；输入框里还是上次发送或自动生成的描述时，
 * 改写成当前编排的描述，用户自己改过文字后不再改写
 */
export function usePromptComposer(composition: CompositionOwner, options: PromptComposerOptions = {}): PromptComposer {
  const { random = Math.random, onComposed } = options;
  const text = ref('');
  const example = ref(PROMPT_EXAMPLES[0] ?? '');
  const building = shallowRef<BuildState | null>(null);
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

  // 同步侦听：在改编排的同一刻知道是不是自己改的
  watch(
    () => composition.state.value,
    state => {
      if (writing) {
        return;
      }
      stopBuilding();
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

  const build = async (target: Composition) => {
    const signal = buildRun.next();
    write(emptyComposition());
    building.value = { revealed: new Set(), latest: null, message: 'AI 正在理解指令…', launching: false };
    if (!(await pause(THINK_MS, signal))) {
      return;
    }
    const revealed = new Set<string>();
    const steps = buildSteps(target);
    for (const [index, step] of steps.entries()) {
      write(step.composition);
      revealed.add(step.node);
      const last = index === steps.length - 1;
      building.value = { revealed: new Set(revealed), latest: step.node, message: step.message, launching: last };
      // oxlint-disable-next-line no-await-in-loop -- 节点一个一个出现，每个之间要等
      if (!(await pause(last ? LAUNCH_MS : STEP_MS, signal))) {
        return;
      }
    }
    synced = true;
    onComposed?.();
    building.value = null;
  };

  const setText = (value: string) => {
    synced = false;
    text.value = value;
  };

  return {
    text,
    example,
    building,
    sending: computed(() => building.value !== null),
    setText,
    fillExample: () => setText(example.value),
    refresh: () => {
      example.value = randomPrompt(random, [example.value]);
      setText('');
    },
    send: () => {
      if (text.value.trim() === '') {
        return 'empty';
      }
      const parsed = parsePrompt(text.value);
      if (!parsed) {
        return 'unrecognized';
      }
      void build(parsed);
      return 'sent';
    }
  };
}
