import { computed, type ComputedRef, onScopeDispose, type Ref, shallowRef, watch } from 'vue';
import { DONE_HOLD, isPending, type RequestItem, type RequestSource, SHOW_DELAY } from './request-status';

/** 时钟走一格的间隔（毫秒）：加载超过 0.4 秒才显示、"已加载完成"留 1.5 秒、等了几秒都按它刷新 */
const TICK = 250;

export interface RequestStatus {
  /** 明细里的各项，按来源的先后 */
  readonly items: ComputedRef<readonly RequestItem[]>;
  /** 当前时间（同 performance.now）：有在加载的、刚结束的时每 250 毫秒走一格，空闲时不走 */
  readonly now: Readonly<Ref<number>>;
  /** 显示着加载中的项（加载超过 0.4 秒），当前图层的行内转圈用同一份 */
  readonly loadingKeys: ComputedRef<ReadonlySet<string>>;
}

// 模型这一轮的时间：进入加载中时开始，就绪、失败时结束
interface ModelTimes {
  readonly state: 'loading' | 'ready' | 'failed';
  readonly startedAt: number;
  readonly finishedAt: number | null;
}

/**
 * 地图数据的请求状态（ADR 0158）：把页面给出的来源整理成明细的各项，模型按状态变化记下开始、结束的时间；
 * 需要时让时钟走，状态栏的条目、明细、行内的转圈都按它判断
 */
export function useRequestStatus(
  sources: () => readonly RequestSource[],
  clock: () => number = () => performance.now()
): RequestStatus {
  const now = shallowRef(clock());
  const modelTimes = shallowRef<ReadonlyMap<string, ModelTimes>>(new Map());

  watch(
    () => sources().flatMap(source => (source.kind === 'model' ? [[source.key, source.state] as const] : [])),
    states => {
      const time = clock();
      const previous = modelTimes.value;
      modelTimes.value = new Map(
        states.map(([key, state]): [string, ModelTimes] => {
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

  const items = computed((): RequestItem[] =>
    sources().map(source => {
      const { key, kind, name, icon } = source;
      if (source.kind === 'tiles') {
        const { requested, loaded, failed, startedAt, finishedAt } = source.activity;
        return { key, kind, name, icon, requested, loaded, failed, startedAt, finishedAt };
      }
      const times = modelTimes.value.get(key);
      return {
        key,
        kind,
        name,
        icon,
        requested: 0,
        loaded: source.state === 'ready' ? 1 : 0,
        failed: source.state === 'failed' ? 1 : 0,
        startedAt: times?.startedAt ?? now.value,
        finishedAt: source.state === 'loading' ? null : (times?.finishedAt ?? now.value)
      };
    })
  );

  // 有在加载的、刚结束不到 1.5 秒的时让时钟走
  const ticking = computed(() =>
    items.value.some(item => isPending(item) || now.value - (item.finishedAt ?? 0) < DONE_HOLD + TICK)
  );
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
    const next = new Set(
      items.value.filter(item => isPending(item) && now.value - item.startedAt > SHOW_DELAY).map(item => item.key)
    );
    return previous?.size === next.size && [...next].every(key => previous.has(key)) ? previous : next;
  });

  return { items, now, loadingKeys };
}
