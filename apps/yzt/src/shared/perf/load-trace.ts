/** User Timing 里用到的部分；默认是全局的 performance，测试时换成记录调用的对象 */
export interface Timeline {
  mark(name: string): unknown;
  measure(name: string, startMark: string): unknown;
  clearMarks(name: string): void;
  clearMeasures(name: string): void;
}

/**
 * 一段加载过程的耗时标记（User Timing，DevTools 的 Performance 面板和实测脚本都读它，见 docs/modules/perf.md）。
 * begin 开始新的一轮并清掉上一轮；之后每个步骤只记第一次，记到最后一个步骤时这一轮结束；不在一轮里时什么也不记
 */
export class LoadTrace<const S extends string> {
  readonly #name: string;
  readonly #steps: readonly S[];
  readonly #timeline: Timeline;
  // 这一轮已经记下的步骤；不在一轮里时为 null
  #recorded: Set<S> | null = null;

  constructor(name: string, steps: readonly [S, ...S[]], timeline: Timeline = performance) {
    this.#name = name;
    this.#steps = steps;
    this.#timeline = timeline;
  }

  /** 是否在一轮里：还没开始或已经记完时为 false */
  get recording(): boolean {
    return this.#recorded !== null;
  }

  /** 标记名，也是从开始量起的 measure 名：`<名称>:<步骤>`，开始的标记是 `<名称>:start` */
  entryName(step: S | 'start'): string {
    return `${this.#name}:${step}`;
  }

  /** 开始新的一轮：清掉上一轮的标记，记下开始的时刻 */
  begin(): void {
    this.#recorded = new Set();
    this.#guard(() => {
      for (const name of [this.entryName('start'), ...this.#steps.map(step => this.entryName(step))]) {
        this.#timeline.clearMarks(name);
        this.#timeline.clearMeasures(name);
      }
      this.#timeline.mark(this.entryName('start'));
    });
  }

  /** 记下一个步骤，并量出从开始到现在的耗时 */
  mark(step: S): void {
    const recorded = this.#recorded;
    if (!recorded || recorded.has(step)) {
      return;
    }
    recorded.add(step);
    if (step === this.#steps.at(-1)) {
      this.#recorded = null;
    }
    const name = this.entryName(step);
    this.#guard(() => {
      this.#timeline.mark(name);
      this.#timeline.measure(name, this.entryName('start'));
    });
  }

  // 标记出错不能影响业务，例如别处清掉了开始的标记时 measure 会抛错
  #guard(action: () => void): void {
    try {
      action();
    } catch {
      // 只是少了一条耗时记录
    }
  }
}
