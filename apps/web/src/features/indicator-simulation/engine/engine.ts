import { abortReason, LatestController } from '@yzt/utils';
import { createNanoEvents, type Unsubscribe } from 'nanoevents';
import type { Calculator, YearResult } from '../model/calculator';
import type { District } from '../model/districts';
import { simulationIndicator } from '../model/indicators';
import {
  changedParams,
  defaultParams,
  type MissingTreatment,
  type ParamKey,
  type SimulationConditions,
  type SimulationParams
} from '../model/params';
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

/** 整个推演：空闲、规划步骤、执行中、等人确认、完成、出错 */
export type EngineStatus = 'idle' | 'planning' | 'running' | 'checkpoint' | 'done' | 'failed';

/** 步骤：等待、进行、等人确认、完成、沿用上一轮的结果、受干预影响待重算 */
export type StepStatus = 'waiting' | 'running' | 'checkpoint' | 'done' | 'reused' | 'stale';

export interface StepState {
  readonly status: StepStatus;
  /** 这一步用过人工确认或干预的参数 */
  readonly human: boolean;
}

/** 会停下来等人确认的步骤 */
export type CheckpointStep = 'qc' | 'spatial';

export interface MissingPopulation {
  readonly district: District;
  /** 按趋势插补的人口（万人） */
  readonly imputed: number;
}

/** 等人确认的内容：数据核查问缺失人口怎么处理，空间分析确认参数（参数见状态的 params） */
export type Checkpoint =
  | { readonly step: 'qc'; readonly year: number; readonly missing: readonly MissingPopulation[] }
  | { readonly step: 'spatial' };

export type CheckpointDecision =
  | { readonly step: 'qc'; readonly missing: MissingTreatment }
  | { readonly step: 'spatial' };

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
  /** 这一轮的参数，推演中的确认和干预会改它 */
  readonly params: SimulationParams;
  /** 这一轮的基准：开始时的参数，或结果阶段干预时基于的版本 */
  readonly baseParams: SimulationParams;
  readonly baseIndex: number | null;
  readonly steps: Readonly<Record<StepId, StepState>>;
  /** 干预后从哪一步重算；第一轮为 null */
  readonly restart: StepId | null;
  readonly checkpoint: Checkpoint | null;
  /** 确认点已经由人决定过（确认或干预过它的参数），之后不再停下来问 */
  readonly decided: Readonly<Record<CheckpointStep, boolean>>;
  readonly versions: readonly SimulationVersion[];
  /** status 为 failed 时的错误 */
  readonly error: unknown;
}

/** 干预的结果：参数没变；保存到还没执行的步骤；作为当前确认点的决定；从某一步重算 */
export type ApplyOutcome = 'unchanged' | 'saved' | 'resolved' | 'rerun';

/** 引擎用到的计算 */
export type EngineCalculator = Pick<Calculator, 'missingDistricts' | 'imputedPopulation' | 'compute'>;

export interface EngineOptions {
  readonly calculator: EngineCalculator;
  /** 默认用系统时间；测试注入手动推进的时钟 */
  readonly clock?: Clock;
}

interface EngineEvents {
  change: (state: EngineState) => void;
}

interface Pending {
  readonly step: CheckpointStep;
  readonly resume: () => void;
}

type Patch = Partial<Omit<EngineState, 'revision'>>;

const isCheckpointStep = (id: StepId): id is CheckpointStep => id === 'qc' || id === 'spatial';

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
    checkpoint: null,
    decided: { qc: false, spatial: false },
    versions: [],
    error: null
  };
}

function assertConditions({ years, cityCodes, indicatorIds }: SimulationConditions): void {
  if (years.length === 0 || cityCodes.length === 0 || indicatorIds.length === 0) {
    throw new Error('推演条件不完整：年度、监测范围、监测指标都至少要有一项');
  }
  for (const id of indicatorIds) {
    simulationIndicator(id);
  }
}

/** 推演引擎：步骤的先后与并行、人工确认、干预后的失效与复用、版本；时间来自注入的时钟，动效只按状态演出 */
export class SimulationEngine implements Disposable {
  readonly #calculator: EngineCalculator;
  readonly #clock: PausableClock;
  readonly #emitter = createNanoEvents<EngineEvents>();
  readonly #runs = new LatestController();
  // 进行中的步骤累计了多久、最近一次从什么时候开始计时（等人确认时不计时），用来算进度
  readonly #timing = new Map<StepId, { elapsed: number; since: number | null }>();
  #pending: Pending | null = null;
  #state: EngineState = { ...initialState(false), revision: 0 };
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
    this.#pending = null;
    this.#timing.clear();
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
    this.#pending = null;
    this.#timing.clear();
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

  /** 对当前的确认点做出决定；没有这一步的确认点时抛错 */
  resolveCheckpoint(decision: CheckpointDecision): void {
    this.#assertAlive();
    const pending = this.#pending;
    if (!pending || pending.step !== decision.step) {
      throw new Error(`${decision.step} 没有在等待确认`);
    }
    const { params, steps, decided } = this.#state;
    this.#continue(pending, {
      params: decision.step === 'qc' ? { ...params, missing: decision.missing } : params,
      steps,
      decided
    });
  }

  /**
   * 人工干预：推演中基于当前参数调整，只能改还没执行的步骤或当前确认点，否则从改动的步骤重算；
   * 完成后基于某一版（默认最新一版）调整，重算出新的版本
   */
  apply(next: SimulationParams, options: { readonly baseIndex?: number } = {}): ApplyOutcome {
    this.#assertAlive();
    const { status, params, versions } = this.#state;
    if (status === 'done') {
      return this.#applyToResult(next, options.baseIndex ?? versions.length - 1);
    }
    if (status !== 'planning' && status !== 'running' && status !== 'checkpoint') {
      throw new Error('推演没有在进行');
    }
    if (options.baseIndex !== undefined) {
      throw new Error('推演进行中只能基于当前参数调整');
    }
    const changes = changedParams(params, next);
    const restart = restartStep(changes);
    if (restart === null) {
      return 'unchanged';
    }
    const marked = { params: next, ...this.#marked(changes) };
    const restartStatus = this.#state.steps[restart].status;
    if (restartStatus === 'waiting' || restartStatus === 'stale') {
      this.#set(marked);
      return 'saved';
    }
    if (this.#pending?.step === restart) {
      this.#continue(this.#pending, marked);
      return 'resolved';
    }
    this.#rerun(restart, marked, {});
    return 'rerun';
  }

  /** 步骤的进度 0～1，按时钟实时计算：等待中、待更新为 0，完成、复用为 1 */
  progress(id: StepId): number {
    const { status } = this.#state.steps[id];
    if (status === 'done' || status === 'reused') {
      return 1;
    }
    const timing = this.#timing.get(id);
    if (!timing || status === 'waiting' || status === 'stale') {
      return 0;
    }
    const elapsed = timing.elapsed + (timing.since === null ? 0 : this.#clock.now() - timing.since);
    return Math.min(1, elapsed / stepDefinition(id).duration);
  }

  [Symbol.dispose](): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#pending = null;
    this.#runs[Symbol.dispose]();
    this.#emitter.events = {};
  }

  #applyToResult(next: SimulationParams, baseIndex: number): ApplyOutcome {
    const base = this.#state.versions[baseIndex];
    if (base === undefined) {
      throw new Error(`没有第 ${baseIndex} 个版本`);
    }
    const changes = changedParams(base.params, next);
    if (changes.length === 0) {
      return 'unchanged';
    }
    // 版本记录相对所基于版本的改动；哪些步骤能复用要和上一轮实际用的参数比
    const restart = restartStep(changedParams(this.#state.params, next));
    this.#rerun(restart, { params: next, ...this.#marked(changes) }, { baseParams: base.params, baseIndex });
    return 'rerun';
  }

  // 改动的参数项所属的步骤标为人工；属于确认点的，确认点算作已决定
  #marked(changes: readonly ParamKey[]): Pick<EngineState, 'steps' | 'decided'> {
    const ids = new Set(changes.map(key => PARAM_STEP[key]));
    const { steps, decided } = this.#state;
    return {
      steps: mapSteps(id => (ids.has(id) ? { ...steps[id], human: true } : steps[id])),
      decided: { qc: decided.qc || ids.has('qc'), spatial: decided.spatial || ids.has('spatial') }
    };
  }

  // 作废进行中的这一轮，从 restart 和它的下游、以及还没完成的步骤重算，其余沿用
  #rerun(restart: StepId | null, patch: Pick<EngineState, 'params' | 'steps' | 'decided'>, base: Patch): void {
    const conditions = this.#state.conditions;
    if (!conditions) {
      throw new Error('推演没有开始');
    }
    const signal = this.#runs.next();
    this.#pending = null;
    const affected = restart === null ? new Set<StepId>() : downstream(restart);
    for (const { id } of STEPS) {
      const { status } = patch.steps[id];
      if (status !== 'done' && status !== 'reused') {
        affected.add(id);
      }
    }
    for (const id of affected) {
      this.#timing.delete(id);
    }
    this.#set({
      ...base,
      ...patch,
      status: 'running',
      restart,
      checkpoint: null,
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
      await Promise.all(group.map(step => this.#execute(step, conditions, signal)));
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

  async #execute(step: StepDefinition, conditions: SimulationConditions, signal: AbortSignal): Promise<void> {
    this.#timing.set(step.id, { elapsed: 0, since: this.#clock.now() });
    this.#setStep(step.id, 'running');
    let elapsed = 0;
    if (step.checkpointAt !== undefined && isCheckpointStep(step.id)) {
      await this.#sleep(step.checkpointAt, signal);
      elapsed = step.checkpointAt;
      const checkpoint = this.#checkpointOf(step.id, conditions);
      if (checkpoint) {
        await this.#confirm(step.id, checkpoint, elapsed, signal);
      }
    }
    await this.#sleep(step.duration - elapsed, signal);
    this.#timing.delete(step.id);
    this.#setStep(step.id, 'done');
  }

  #checkpointOf(id: CheckpointStep, conditions: SimulationConditions): Checkpoint | null {
    if (this.#state.decided[id]) {
      return null;
    }
    if (id === 'spatial') {
      // 只有覆盖率类指标用到服务半径
      const coverage = conditions.indicatorIds.some(item => simulationIndicator(item).model === 'coverage');
      return coverage ? { step: 'spatial' } : null;
    }
    const year = Math.max(...conditions.years);
    const districts = this.#calculator.missingDistricts(year, conditions.cityCodes);
    if (districts.length === 0) {
      return null;
    }
    const caliber = this.#state.params.popCaliber;
    return {
      step: 'qc',
      year,
      missing: districts.map(district => ({
        district,
        imputed: this.#calculator.imputedPopulation(district, year, caliber)
      }))
    };
  }

  // 停在确认点，等 resolveCheckpoint 或干预让它继续；停着的时候不计时
  #confirm(step: CheckpointStep, checkpoint: Checkpoint, elapsed: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(abortReason(signal));
      signal.addEventListener('abort', onAbort, { once: true });
      this.#pending = {
        step,
        resume: () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }
      };
      this.#timing.set(step, { elapsed, since: null });
      this.#set({
        status: 'checkpoint',
        checkpoint,
        steps: { ...this.#state.steps, [step]: { ...this.#state.steps[step], status: 'checkpoint' } }
      });
    });
  }

  #continue(pending: Pending, patch: Pick<EngineState, 'params' | 'steps' | 'decided'>): void {
    this.#pending = null;
    const timing = this.#timing.get(pending.step);
    if (timing) {
      timing.since = this.#clock.now();
    }
    this.#set({
      ...patch,
      status: 'running',
      checkpoint: null,
      decided: { ...patch.decided, [pending.step]: true },
      steps: { ...patch.steps, [pending.step]: { status: 'running', human: true } }
    });
    pending.resume();
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
      this.#pending = null;
      this.#set({ status: 'failed', checkpoint: null, error });
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
