import { computed, type ComputedRef, type Ref, shallowRef, watch } from 'vue';
import type { SimulationVersion } from '../engine/engine';
import type { SimulationParams } from '../model/params';
import {
  type Comparison,
  comparisonOf,
  initialSelection,
  type MapColoring,
  mapColoring,
  previewChanges,
  type ResultSelection,
  type ResultSummary,
  resultSummary
} from '../result/result-view';
import type { SimulationRun } from './useSimulationRun';

/** 结果阶段的拥有者：看哪一版、和谁比、哪项指标和年度、地图着色，以及人工干预的预览 */
export interface SimulationResult {
  readonly selection: Readonly<Ref<ResultSelection | null>>;
  readonly version: ComputedRef<SimulationVersion | null>;
  readonly comparison: ComputedRef<Comparison | null>;
  readonly summary: ComputedRef<ResultSummary | null>;
  readonly coloring: ComputedRef<MapColoring | null>;
  /** 预览中达标状态会变的区县 */
  readonly preview: Readonly<Ref<ReadonlySet<string>>>;
  /** 改选择；不合法的值抛错，对比的一方不能是正在看的一版（改成标准口径） */
  readonly select: (patch: Partial<Omit<ResultSelection, 'viewIndex'>>) => void;
  /** 看另一版：对比改成它所基于的版本 */
  readonly viewVersion: (index: number) => void;
  /** 人工干预的草稿；null 是关掉预览 */
  readonly setPreview: (draft: SimulationParams | null) => void;
}

const EMPTY: ReadonlySet<string> = new Set();

export function useSimulationResult(run: SimulationRun): SimulationResult {
  const state = run.state;
  const selection = shallowRef<ResultSelection | null>(null);
  const preview = shallowRef<ReadonlySet<string>>(EMPTY);
  const conditions = computed(() => state.value.conditions);
  const versions = computed(() => state.value.versions);

  // 新的一版生成后看它；回到空闲时清空
  watch(
    () => versions.value.length,
    () => {
      selection.value = initialSelection(state.value);
      preview.value = EMPTY;
    }
  );

  const version = computed(() => (selection.value ? (versions.value[selection.value.viewIndex] ?? null) : null));
  const comparison = computed(() => {
    const calculator = run.calculator.value;
    if (!calculator || !conditions.value || !selection.value) {
      return null;
    }
    return comparisonOf(calculator, conditions.value, versions.value, selection.value.compare);
  });
  const summary = computed(() => {
    const calculator = run.calculator.value;
    const current = selection.value;
    if (!calculator || !conditions.value || !current || !version.value || !comparison.value) {
      return null;
    }
    return resultSummary(calculator, conditions.value, version.value, comparison.value, current.indicatorId, current.year);
  });
  const coloring = computed(() => {
    const calculator = run.calculator.value;
    if (!calculator || !conditions.value || !selection.value || !version.value || !comparison.value) {
      return null;
    }
    return mapColoring(calculator, conditions.value, selection.value, version.value, comparison.value);
  });

  const requireSelection = (): ResultSelection => {
    if (!selection.value) {
      throw new Error('还没有推演结果');
    }
    return selection.value;
  };

  const select: SimulationResult['select'] = patch => {
    const current = requireSelection();
    const next = { ...current, ...patch };
    const { indicatorIds = [], years = [] } = conditions.value ?? {};
    if (!indicatorIds.includes(next.indicatorId) || !years.includes(next.year)) {
      throw new Error(`没有指标 ${next.indicatorId} 或年度 ${next.year}`);
    }
    if (next.compare !== 'default' && versions.value[next.compare] === undefined) {
      throw new Error(`没有第 ${next.compare} 个版本`);
    }
    selection.value = next.compare === next.viewIndex ? { ...next, compare: 'default' } : next;
  };

  return {
    selection,
    version,
    comparison,
    summary,
    coloring,
    preview,
    select,
    viewVersion: index => {
      const target = versions.value[index];
      if (!target) {
        throw new Error(`没有第 ${index} 个版本`);
      }
      selection.value = { ...requireSelection(), viewIndex: index, compare: target.baseIndex ?? 'default' };
    },
    setPreview: draft => {
      const calculator = run.calculator.value;
      const current = selection.value;
      if (!draft || !calculator || !conditions.value || !current || !version.value) {
        preview.value = EMPTY;
        return;
      }
      preview.value = previewChanges(calculator, conditions.value, version.value.params, draft, current.indicatorId, current.year);
    }
  };
}
