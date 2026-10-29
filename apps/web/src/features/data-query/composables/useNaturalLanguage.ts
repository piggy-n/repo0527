import { LatestController } from '@yzt/utils';
import { getCurrentScope, onScopeDispose, readonly, type Ref, ref } from 'vue';
import { matchNaturalRule } from '../conditions';
import type { NaturalLanguageConfig, NaturalLanguageRule } from '../topics';

/** 模拟"AI 解析"的等待，同旧页面 */
export const PARSE_DELAY = 2000;

/** 一次解析的结果：被作废（下一次解析、cancel、作用域销毁）或者解析完；没有匹配的规则时 rule 为 null */
export type ParseResult =
  | { readonly kind: 'canceled' }
  | { readonly kind: 'parsed'; readonly rule: NaturalLanguageRule | null };

/** 自然语言查询：仍是旧页面的模拟解析，按预设规则回填属性查询（见 docs/modules/data-query.md） */
export interface NaturalLanguage {
  readonly text: Readonly<Ref<string>>;
  readonly parsing: Readonly<Ref<boolean>>;
  /** 当前的文字解析成功过：这时面板可以显示 SQL */
  readonly parsed: Readonly<Ref<boolean>>;
  readonly setText: (text: string) => void;
  /** "换一组"：依次换成下一条示例 */
  readonly nextExample: () => void;
  /** 等待后按规则匹配；作废表示成结果，不抛错 */
  readonly parse: () => Promise<ParseResult>;
  readonly cancel: () => void;
  /** 回到第一条示例 */
  readonly reset: () => void;
}

// 可中止的等待：中止时提前结束，由调用方检查信号
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

export function useNaturalLanguage(config: NaturalLanguageConfig): NaturalLanguage {
  if (!getCurrentScope()) {
    throw new Error('useNaturalLanguage 只能在组件的 setup 或 effectScope 中调用');
  }
  const text = ref(config.examples[0] ?? '');
  // 下一次"换一组"换成第几条
  let next = 1;
  const parsing = ref(false);
  const parsed = ref(false);
  const parses = new LatestController();
  onScopeDispose(() => parses[Symbol.dispose]());

  const cancel = () => {
    parses.abort();
    parsing.value = false;
  };

  return {
    text: readonly(text),
    parsing: readonly(parsing),
    parsed: readonly(parsed),
    setText: value => {
      text.value = value;
      parsed.value = false;
    },
    nextExample: () => {
      const { examples } = config;
      text.value = examples[next % examples.length] ?? '';
      next = (next + 1) % examples.length;
      parsed.value = false;
    },
    parse: async () => {
      const signal = parses.next();
      parsing.value = true;
      parsed.value = false;
      await wait(PARSE_DELAY, signal);
      // 被作废时状态归作废它的一方（下一次解析或 cancel）
      if (signal.aborted) {
        return { kind: 'canceled' };
      }
      parsing.value = false;
      const rule = matchNaturalRule(text.value, config.rules) ?? null;
      parsed.value = rule !== null;
      return { kind: 'parsed', rule };
    },
    cancel,
    reset: () => {
      cancel();
      text.value = config.examples[0] ?? '';
      next = 1;
      parsed.value = false;
    }
  };
}
