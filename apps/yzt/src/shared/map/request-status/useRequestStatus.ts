import { computed, type ComputedRef, onScopeDispose, type Ref, shallowRef, watch } from 'vue';
import {
  ALL_REQUEST_KINDS,
  failedRequestKeys,
  type FailureMemory,
  INLINE_DELAY,
  isPending,
  type ModelPhase,
  modelRequestItem,
  nextFailureMemory,
  nextRequestDisplay,
  type RequestDisplay,
  type RequestItem,
  type RequestKinds,
  type RequestSource,
  withPreviousFailures
} from './request-status';

// 集合的内容一样：内容没变时还用原来的对象，用它的行不跟着重渲染
const sameKeys = (
  previous: ReadonlySet<string> | undefined,
  next: ReadonlySet<string>
): previous is ReadonlySet<string> => previous?.size === next.size && [...next].every(key => previous.has(key));

/** 时钟走一格的间隔（毫秒）：转圈、条目出现，条目留多久，等了几秒都按它刷新 */
const TICK = 250;

export interface RequestStatus {
  /** 明细里的各项，按来源的先后；还在加载的带着上一轮的失败（previousFailed） */
  readonly items: ComputedRef<readonly RequestItem[]>;
  /** 当前时间（同 performance.now）：有在加载的、条目显示着的时候每 250 毫秒走一格，空闲时不走 */
  readonly now: Readonly<Ref<number>>;
  /** 状态栏的条目这一次显示（用户 2026-11-22，合并显示）；没在显示时为 null */
  readonly display: Readonly<Ref<RequestDisplay | null>>;
  /** 显示着加载中的项（加载超过 0.4 秒），面板图层列表的行内转圈用同一份；关掉加载中时是空的 */
  readonly loadingKeys: ComputedRef<ReadonlySet<string>>;
  /** 有失败的项（hasFailure，留到下一轮结束），行内的"有瓦片加载失败"用同一份（ADR 0167）；关掉加载失败时是空的 */
  readonly failedKeys: ComputedRef<ReadonlySet<string>>;
  /** 显示哪几类：条目和明细按它过滤（ADR 0167） */
  readonly kinds: ComputedRef<RequestKinds>;
}

/**
 * 地图数据的请求状态（ADR 0158）：把页面给出的来源整理成明细的各项，模型按读索引的状态变化记下开始、结束的时间，
 * 读完以后接上渲染器统计的这一轮（modelRequestItem，ADR 0162）；记下每项上一轮的失败，留到下一轮结束（nextFailureMemory），
 * 和条目的这一次显示（nextRequestDisplay，用户 2026-11-22）；需要时让时钟走，状态栏的条目、明细、行内的转圈都按它判断
 */
export function useRequestStatus(
  sources: () => readonly RequestSource[],
  clock: () => number = () => performance.now(),
  shownKinds: () => RequestKinds = () => ALL_REQUEST_KINDS
): RequestStatus {
  const kinds = computed(shownKinds);
  const now = shallowRef(clock());
  const modelTimes = shallowRef<ReadonlyMap<string, ModelPhase>>(new Map());

  watch(
    () => sources().flatMap(source => (source.kind === 'model' ? [[source.key, source.state] as const] : [])),
    states => {
      const time = clock();
      const previous = modelTimes.value;
      modelTimes.value = new Map(
        states.map(([key, state]): [string, ModelPhase] => {
          const last = previous.get(key);
          if (last?.state === state) {
            return [key, last];
          }
          // 一开始就是就绪、失败的（切换维度前已经加载过）也从现在算，结束时间同开始
          return [
            key,
            state === 'loading'
              ? { state, startedAt: time, finishedAt: null }
              : { state, startedAt: last?.startedAt ?? time, finishedAt: time }
          ];
        })
      );
    },
    { immediate: true }
  );

  // 各项这一轮的加载，还没带上一轮的失败
  const rounds = computed((): RequestItem[] =>
    sources().map(source => {
      const { key, name, icon } = source;
      if (source.kind === 'tiles') {
        const { requested, loaded, failed, startedAt, finishedAt } = source.activity;
        return {
          key,
          kind: 'tiles',
          name,
          icon,
          requested,
          loaded,
          failed,
          previousFailed: 0,
          detail: null,
          startedAt,
          finishedAt
        };
      }
      // 状态变化的监听还没跑到时（同一轮里先读到）按现在算
      const phase = modelTimes.value.get(key) ?? {
        state: source.state,
        startedAt: now.value,
        finishedAt: source.state === 'loading' ? null : now.value
      };
      return modelRequestItem(source, phase, source.activity, now.value);
    })
  );

  // 每一次变化都记：一轮结束的样子只出现在两次变化之间，晚一拍再读就被下一轮盖掉了
  const failures = shallowRef<FailureMemory>(new Map());
  watch(rounds, list => (failures.value = nextFailureMemory(failures.value, list)), { immediate: true, flush: 'sync' });
  const items = computed(() => withPreviousFailures(rounds.value, failures.value));

  // 条目的这一次显示：随各项和时钟往下走
  const display = shallowRef<RequestDisplay | null>(null);
  watch(
    [items, now],
    ([list, time]) => {
      display.value = nextRequestDisplay(display.value, list, time);
    },
    { immediate: true, flush: 'sync' }
  );

  // 有在加载的、条目还显示着的时候让时钟走
  const ticking = computed(() => display.value !== null || items.value.some(isPending));
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    clearInterval(timer);
    timer = undefined;
  };
  watch(
    ticking,
    active => {
      if (active && timer === undefined) {
        now.value = clock();
        timer = setInterval(() => (now.value = clock()), TICK);
      } else if (!active) {
        stop();
      }
    },
    { immediate: true }
  );
  onScopeDispose(stop);

  // 集合的内容没变时还是同一个对象：时钟每走一格都会重算，用它的行不跟着重渲染
  const loadingKeys = computed((previous?: ReadonlySet<string>): ReadonlySet<string> => {
    const next = kinds.value.loading
      ? new Set(
          items.value.filter(item => isPending(item) && now.value - item.startedAt > INLINE_DELAY).map(item => item.key)
        )
      : new Set<string>();
    return sameKeys(previous, next) ? previous : next;
  });
  const failedKeys = computed((previous?: ReadonlySet<string>): ReadonlySet<string> => {
    const next = kinds.value.failed ? failedRequestKeys(items.value) : new Set<string>();
    return sameKeys(previous, next) ? previous : next;
  });

  return { items, now, display, loadingKeys, failedKeys, kinds };
}
