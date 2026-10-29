import { abortReason, LatestController } from '@yzt/utils';
import { createNanoEvents, type Unsubscribe } from 'nanoevents';
import type { Calculator, YearResult } from '../model/calculator';
import { simulationIndicator } from '../model/indicators';
import { changedParams, defaultParams, type ParamKey, type SimulationConditions, type SimulationParams } from '../model/params';
import { type Clock, PausableClock, systemClock } from './clock';
import {
  downstream,
  PARAM_STEP,
  PLANNING_DURATION,
  RERUN_DELAY,
  restartStep,
  stepDefinition,
  type StepDefinition,
  type StepId,
  STEPS
} from './steps';

/** 整个推演：空闲、规划步骤、执行中、完成、出错 */
export type EngineStatus = 'idle' | 'planning' | 'running' | 'done' | 'failed';

/** 步骤：等待、进行、完成、沿用上一轮的结果、受干预影响待重算 */
export type StepStatus = 'waiting' | 'running' | 'done' | 'reused' | 'stale';

export interface StepState {
  readonly status: StepStatus;
  /** 这一步用过人工干预的参数 */
  readonly human: boolean;
}

export interface SimulationVersion {
  readonly index: number;
  /** v1、v2… */
  readonly label: string;
  readonly params: SimulationParams;
  readonly result: Readonly<Record<number, YearResult>>;
  /** 基于哪一版调整；第一版为 null，基准是开始推演时的参数 */
  readonly baseIndex: number | null;
  readonly baseParams: SimulationParams;
  /** 相对基准改了哪些参数项 */
  readonly changes: readonly ParamKey[];
}

/** 引擎的状态快照：每次变化整体替换，revision 加一 */
export interface EngineState {
  readonly revision: number;
  readonly status: EngineStatus;
  /** 页面停用、打开人工干预时暂停，和 status 互不影响 */
  readonly paused: boolean;
  readonly conditions: SimulationConditions | null;
  /** 这一轮的参数，推演中的干预会改它 */
  readonly params: SimulationParams;
  /** 这一轮的基准：开始时的参数，或结果阶段干预时基于的版本 */
  readonly baseParams: SimulationParams;
  readonly baseIndex: number | null;
  readonly steps: Readonly<Record<StepId, StepState>>;
  /** 干预后从哪一步重算；第一轮为 null */
  readonly restart: StepId | null;
  /** 引起这一轮重算的干预：改之前的参数和改了的参数项；第一轮为 null */
  readonly adjustment: { readonly from: SimulationParams; readonly changes: readonly ParamKey[] } | null;
  readonly versions: readonly SimulationVersion[];
  /** status 为 failed 时的错误 */
  readonly error: unknown;
}

/** 干预的结果：参数没变；保存到还没执行的步骤；从某一步重算 */
export type ApplyOutcome = 'unchanged' | 'saved' | 'rerun';

/** 一次干预会怎样处理：结果、从哪一步起生效或重算、改了哪些参数项、结果阶段基于哪一版 */
export interface ApplyPlan {
  readonly outcome: ApplyOutcome;
  readonly restart: StepId | null;
  readonly changes: readonly ParamKey[];
  readonly baseIndex: number | null;
}

/** 引擎用到的计算 */
export type EngineCalculator = Pick<Calculator, 'compute'>;

export interface EngineOptions {
  readonly calculator: EngineCalculator;
  /** 默认用系统时间；测试注入手动推进的时钟 */
  readonly clock?: Clock;
}

interface EngineEvents {
  change: (state: EngineState) => void;
}

type Patch = Partial<Omit<EngineState, 'revision'>>;

// 开始过的步骤在界面上已经出现，受影响时显示为待更新；没开始的仍是等待
const started = (status: StepStatus): boolean => status !== 'waiting';

const LEVELS = [...new Set(STEPS.map(step => step.level))];

function mapSteps(state: (id: StepId) => StepState): Record<StepId, StepState> {
  // fromEntries 的键是 STEPS 的全部 id
  return Object.fromEntries(STEPS.map(({ id }) => [id, state(id)])) as Record<StepId, StepState>;
}

function initialState(paused: boolean): Omit<EngineState, 'revision'> {
  const params = defaultParams();
  return {
    status: 'idle',
    paused,
    conditions: null,
    params,
    baseParams: params,
    baseIndex: null,
    steps: mapSteps(() => ({ status: 'waiting', human: false })),
    restart: null,
    adjustment: null,
    versions: [],
    error: null
  };
}

/** 还没开始推演时的状态 */
export function idleEngineState(): EngineState {
  return { ...initialState(false), revision: 0 };
}

function assertConditions({ years, cityCodes, indicatorIds }: SimulationConditions): void {
  if (years.length === 0 || cityCodes.length === 0 || indicatorIds.length === 0) {
    throw new Error('推演条件不完整：年度、监测范围、监测指标都至少要有一项');
  }
  for (const id of indicatorIds) {
    simulationIndicator(id);
  }
}

/** 推演引擎：步骤的先后与并行、干预后的失效与复用、版本；时间来自注入的时钟，动效只按状态演出 */
export class SimulationEngine implements Disposable {
  readonly #calculator: EngineCalculator;
  readonly #clock: PausableClock;
  readonly #emitter = createNanoEvents<EngineEvents>();
  readonly #runs = new LatestController();
  // 进行中的步骤从什么时候开始（时钟暂停时不走），用来算进度
  readonly #started = new Map<StepId, number>();
  #state: EngineState = idleEngineState();
  #disposed = false;

  constructor({ calculator, clock = systemClock }: EngineOptions) {
    this.#calculator = calculator;
    this.#clock = new PausableClock(clock);
  }

  get state(): EngineState {
    return this.#state;
  }

  on<K extends keyof EngineEvents>(event: K, callback: EngineEvents[K]): Unsubscribe {
    this.#assertAlive();
    return this.#emitter.on(event, callback);
  }

  /** 按条件和参数开始推演；进行中的推演和已有的版本都作废 */
  start(conditions: SimulationConditions, params: SimulationParams): void {
    this.#assertAlive();
    assertConditions(conditions);
    const signal = this.#runs.next();
    this.#started.clear();
    this.#set({
      ...initialState(this.#state.paused),
      status: 'planning',
      conditions,
      params,
      baseParams: params
    });
    this.#launch(this.#run(conditions, new Set(STEPS.map(({ id }) => id)), PLANNING_DURATION, signal), signal);
  }

  /** 停止推演，回到空闲；暂停不受影响 */
  stop(): void {
    this.#assertAlive();
    this.#runs.abort();
    this.#started.clear();
    this.#set(initialState(this.#state.paused));
  }

  /** 暂停推演，返回解除这一次暂停的函数；几处同时暂停时，全部解除才继续 */
  pause(): () => void {
    this.#assertAlive();
    const release = this.#clock.pause();
    this.#syncPaused();
    return () => {
      release();
      if (!this.#disposed) {
        this.#syncPaused();
      }
    };
  }

  /**
   * 人工干预：推演中基于当前参数调整，还没执行的步骤直接保存，否则从改动的步骤重算；
   * 完成后基于某一版（默认最新一版）调整，重算出新的版本
   */
  apply(next: SimulationParams, options: { readonly baseIndex?: number } = {}): ApplyOutcome {
    const plan = this.planApply(next, options);
    const marked = { params: next, steps: this.#marked(plan.changes) };
    switch (plan.outcome) {
      case 'unchanged':
        return 'unchanged';
      case 'saved':
        this.#set(marked);
        return 'saved';
      case 'rerun':
        break;
    }
    const base = plan.baseIndex === null ? undefined : this.#state.versions[plan.baseIndex];
    this.#rerun(plan.restart, marked, base ? { baseParams: base.params, baseIndex: base.index } : {});
    return 'rerun';
  }

  /** 干预会怎样处理，不改状态：界面据此写按钮和说明；规则见 apply */
  planApply(next: SimulationParams, options: { readonly baseIndex?: number } = {}): ApplyPlan {
    this.#assertAlive();
    const { status, params, versions, steps } = this.#state;
    if (status === 'done') {
      const baseIndex = options.baseIndex ?? versions.length - 1;
      const base = versions[baseIndex];
      if (base === undefined) {
        throw new Error(`没有第 ${baseIndex} 个版本`);
      }
      const changes = changedParams(base.params, next);
      // 版本记录相对所基于版本的改动；哪些步骤能复用要和上一轮实际用的参数比
      const restart = restartStep(changedParams(params, next));
      return { outcome: changes.length === 0 ? 'unchanged' : 'rerun', restart, changes, baseIndex };
    }
    if (status !== 'planning' && status !== 'running') {
      throw new Error('推演没有在进行');
    }
    if (options.baseIndex !== undefined) {
      throw new Error('推演进行中只能基于当前参数调整');
    }
    const changes = changedParams(params, next);
    const restart = restartStep(changes);
    const plan = (outcome: ApplyOutcome): ApplyPlan => ({ outcome, restart, changes, baseIndex: null });
    if (restart === null) {
      return plan('unchanged');
    }
    const restartStatus = steps[restart].status;
    return plan(restartStatus === 'waiting' || restartStatus === 'stale' ? 'saved' : 'rerun');
  }

  /** 步骤的进度 0～1，按时钟实时计算：等待中、待更新为 0，完成、复用为 1 */
  progress(id: StepId): number {
    const { status } = this.#state.steps[id];
    if (status === 'done' || status === 'reused') {
      return 1;
    }
    const startedAt = this.#started.get(id);
    if (startedAt === undefined || status === 'waiting' || status === 'stale') {
      return 0;
    }
    return Math.min(1, (this.#clock.now() - startedAt) / stepDefinition(id).duration);
  }

  [Symbol.dispose](): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#runs[Symbol.dispose]();
    this.#emitter.events = {};
  }

  // 改动的参数项所属的步骤标为人工
  #marked(changes: readonly ParamKey[]): EngineState['steps'] {
    const ids = new Set(changes.map(key => PARAM_STEP[key]));
    const { steps } = this.#state;
    return mapSteps(id => (ids.has(id) ? { ...steps[id], human: true } : steps[id]));
  }

  // 作废进行中的这一轮，从 restart 和它的下游、以及还没完成的步骤重算，其余沿用
  #rerun(restart: StepId | null, patch: Pick<EngineState, 'params' | 'steps'>, base: Patch): void {
    const conditions = this.#state.conditions;
    if (!conditions) {
      throw new Error('推演没有开始');
    }
    const signal = this.#runs.next();
    const affected = restart === null ? new Set<StepId>() : downstream(restart);
    for (const { id } of STEPS) {
      const { status } = patch.steps[id];
      if (status !== 'done' && status !== 'reused') {
        affected.add(id);
      }
    }
    for (const id of affected) {
      this.#started.delete(id);
    }
    const from = this.#state.params;
    this.#set({
      ...base,
      ...patch,
      status: 'running',
      restart,
      adjustment: { from, changes: changedParams(from, patch.params) },
      steps: mapSteps(id => {
        const step = patch.steps[id];
        if (!affected.has(id)) {
          return { ...step, status: 'reused' };
        }
        return { ...step, status: started(step.status) ? 'stale' : 'waiting' };
      })
    });
    this.#launch(this.#run(conditions, affected, RERUN_DELAY, signal), signal);
  }

  async #run(
    conditions: SimulationConditions,
    steps: ReadonlySet<StepId>,
    delay: number,
    signal: AbortSignal
  ): Promise<void> {
    await this.#sleep(delay, signal);
    if (this.#state.status === 'planning') {
      this.#set({ status: 'running' });
    }
    // 同一层并行，上一层全部完成才开始下一层
    for (const level of LEVELS) {
      const group = STEPS.filter(step => step.level === level && steps.has(step.id));
      // oxlint-disable-next-line no-await-in-loop -- 层与层之间按顺序执行
      await Promise.all(group.map(step => this.#execute(step, signal)));
      if (signal.aborted) {
        throw abortReason(signal);
      }
    }
    const { params, baseParams, baseIndex, versions } = this.#state;
    const version: SimulationVersion = {
      index: versions.length,
      label: `v${versions.length + 1}`,
      params,
      result: this.#calculator.compute(conditions, params),
      baseIndex,
      baseParams,
      changes: changedParams(baseParams, params)
    };
    this.#set({ status: 'done', versions: [...versions, version] });
  }

  async #execute(step: StepDefinition, signal: AbortSignal): Promise<void> {
    this.#started.set(step.id, this.#clock.now());
    this.#setStep(step.id, 'running');
    await this.#sleep(step.duration, signal);
    this.#started.delete(step.id);
    this.#setStep(step.id, 'done');
  }

  // 等待返回后再确认一次没有作废：到期和中止可能发生在同一轮里
  async #sleep(ms: number, signal: AbortSignal): Promise<void> {
    await this.#clock.sleep(ms, signal);
    if (signal.aborted) {
      throw abortReason(signal);
    }
  }

  #launch(run: Promise<void>, signal: AbortSignal): void {
    run.catch((error: unknown) => {
      if (signal.aborted || this.#disposed) {
        return;
      }
      this.#runs.abort();
      this.#set({ status: 'failed', error });
    });
  }

  #setStep(id: StepId, status: StepStatus): void {
    this.#set({ steps: { ...this.#state.steps, [id]: { ...this.#state.steps[id], status } } });
  }

  #syncPaused(): void {
    if (this.#state.paused !== this.#clock.paused) {
      this.#set({ paused: this.#clock.paused });
    }
  }

  #set(patch: Patch): void {
    this.#state = { ...this.#state, ...patch, revision: this.#state.revision + 1 };
    this.#emitter.emit('change', this.#state);
  }

  #assertAlive(): void {
    if (this.#disposed) {
      throw new Error('推演引擎已释放');
    }
  }
}
