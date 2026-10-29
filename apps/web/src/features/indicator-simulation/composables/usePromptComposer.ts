import { LatestController } from '@yzt/utils';
import { computed, type ComputedRef, onScopeDispose, type Ref, ref, shallowRef, watch } from 'vue';
import { buildSteps } from '../compose/build';
import { type Composition, emptyComposition } from '../compose/composition';
import { describeComposition, parsePrompt, PROMPT_EXAMPLES } from '../compose/prompt';
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

/** AI 推演指令的拥有者：输入框的文字、换示例、发送后逐个节点编排；面板和编排图只显示和调用 */
export interface PromptComposer {
  readonly text: Readonly<Ref<string>>;
  /** 正在逐字打出换上的示例 */
  readonly typing: Readonly<Ref<boolean>>;
  /** 按指令编排的进度；没在编排时为 null */
  readonly building: Readonly<Ref<BuildState | null>>;
  readonly sending: ComputedRef<boolean>;
  /** 用户输入 */
  setText(text: string): void;
  /** 随机换成另外两条示例中的一条，只换文字，发送后才编排 */
  refresh(): void;
  send(): SendOutcome;
}

export interface PromptComposerOptions {
  /** 换示例用的随机数，测试固定它 */
  readonly random?: () => number;
  /** 减少动画：换上的示例直接出现，不逐字打出；编排仍然一个节点一个节点地出现，只是节点本身不做动效 */
  readonly still?: () => boolean;
  /** 编排完成：页面接着开始推演 */
  readonly onComposed?: () => void;
}

// 打字每个字、理解指令、出现每个节点、编排完成到开始推演的间隔（毫秒）
const TYPE_MS = 20;
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
 * AI 推演指令：不接大模型，按规则解析（compose/prompt.ts）。打开页面时输入框里是第一条示例、编排是空的；
 * 发送后编排图先清空，"理解指令"一会儿，再按 buildSteps 逐个出现节点，完成后交给页面开始推演。
 * 手动改编排会停下正在进行的编排（也不再自动推演）；输入框里还是上次发送或自动生成的描述时，
 * 改写成当前编排的描述，用户自己改过文字后不再改写
 */
export function usePromptComposer(composition: CompositionOwner, options: PromptComposerOptions = {}): PromptComposer {
  const { random = Math.random, still = () => false, onComposed } = options;
  const text = ref(PROMPT_EXAMPLES[0] ?? '');
  const typing = ref(false);
  const building = shallowRef<BuildState | null>(null);
  let example = 0;
  // 输入框里是不是当前编排的描述
  let synced = false;
  // 这里自己在改编排：侦听里据此区分手动修改
  let writing = false;
  const typeRun = new LatestController();
  const buildRun = new LatestController();
  onScopeDispose(() => {
    typeRun[Symbol.dispose]();
    buildRun[Symbol.dispose]();
  });

  const write = (next: Composition) => {
    writing = true;
    try {
      composition.replace(next);
    } finally {
      writing = false;
    }
  };

  const stopTyping = () => {
    typeRun.abort();
    typing.value = false;
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
      stopTyping();
      text.value = description;
    },
    { flush: 'sync' }
  );

  const typeOut = async (target: string) => {
    const signal = typeRun.next();
    if (still()) {
      typing.value = false;
      text.value = target;
      return;
    }
    typing.value = true;
    for (let length = 1; length <= target.length; length++) {
      text.value = target.slice(0, length);
      // oxlint-disable-next-line no-await-in-loop -- 逐字打出，每个字之间要等
      await wait(TYPE_MS, signal);
      if (signal.aborted) {
        return;
      }
    }
    typing.value = false;
  };

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

  return {
    text,
    typing,
    building,
    sending: computed(() => building.value !== null),
    setText: value => {
      stopTyping();
      synced = false;
      text.value = value;
    },
    refresh: () => {
      const others = PROMPT_EXAMPLES.map((_, index) => index).filter(index => index !== example);
      example = others[Math.min(others.length - 1, Math.floor(random() * others.length))] ?? 0;
      synced = false;
      void typeOut(PROMPT_EXAMPLES[example] ?? '');
    },
    send: () => {
      // 示例还没打完就发送：按整句发送
      if (typing.value) {
        stopTyping();
        text.value = PROMPT_EXAMPLES[example] ?? text.value;
      }
      if (text.value.trim() === '') {
        return 'empty';
      }
      const parsed = parsePrompt(text.value);
      if (!parsed) {
        return 'unrecognized';
      }
      stopTyping();
      void build(parsed);
      return 'sent';
    }
  };
}
