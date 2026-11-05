import type { MapTool, StyleGroup, ViewBounds } from '@mx/map-core';
import type { MapContext } from '@mx/map-vue';
import { LatestController } from '@mx/utils';
import type { MultiPolygon, Polygon } from 'geojson';
import { computed, type ComputedRef, onScopeDispose, type Ref, ref, type ShallowRef, shallowRef } from 'vue';
import { type AreaAnalyzer, createAreaAnalyzer } from '@/shared/map/area/area-analyzer';
import type { AreaCoverage, RegionShape } from '@/shared/map/area/area-coverage';
import type { AreaFileResult, AreaFormat } from '@/shared/map/area/area-file';
import { type AreaCheck, type AreaProblem, polygonsOf, vertexCount } from '@/shared/map/area/area-geometry';
import type { DrawnShape } from '@/shared/map/draw/shape-draw';
import { type ShapeDraw, useShapeDraw } from '@/shared/map/draw/useShapeDraw';
import { type ShapeEdit, useShapeEdit } from '@/shared/map/draw/useShapeEdit';
import { JIANGSU_BOUNDS } from '@/shared/map/jiangsu';
import { polygonBounds } from '@/shared/map/region/region-geometry';
import type { DistrictAtlas } from '../model/districts';
import { createScopeArea, type ScopeArea } from '../model/scope';
import { areaSummary, type CoverageTree, coverageNotices, coverageTree, problemText } from '../scope/area-tree';
import { areaGroup, areaShape, coverGroup, coverPieces, districtEdges } from '../scope/scope-style';
import type { SimulationModel } from './useSimulationModel';

/** 怎样打开范围弹窗：只是看看、上传了文件、要绘制、编辑已有的范围 */
export type ScopeIntent = 'choose' | 'upload' | 'draw' | 'edit';

/** 弹窗里的范围：上传的或画的，已经整理成有效的面 */
export interface ScopeDraft {
  readonly geometry: MultiPolygon;
  readonly outline: MultiPolygon;
  readonly source: 'upload' | 'draw';
  readonly file: { readonly name: string; readonly format: AreaFormat } | null;
  readonly vertices: number;
  /** 读文件、整理时做过的处理（如简化、修正了交叉的边）：不影响使用，收在说明的提示里 */
  readonly notices: readonly string[];
}

export type StepState = 'waiting' | 'running' | 'done';

/** 分析的一步 */
export interface AnalysisStep {
  readonly label: string;
  readonly state: StepState;
}

/** AI 范围分析：分步的进度，完成后的覆盖、摘要和提示；不能用时写给用户的话和具体原因，出错时可以重试 */
export type ScopeAnalysis =
  | { readonly status: 'empty' }
  | { readonly status: 'running'; readonly steps: readonly AnalysisStep[] }
  | {
      readonly status: 'done';
      readonly steps: readonly AnalysisStep[];
      readonly coverage: AreaCoverage;
      readonly tree: CoverageTree;
      readonly summary: string;
      readonly notices: readonly string[];
      /** 范围内估算的七普常住人口（万人）：部分覆盖的区县按面积占比折算 */
      readonly population: number;
    }
  | {
      readonly status: 'failed';
      readonly message: string;
      /** 具体的技术原因：不直接显示，用户想看时再看 */
      readonly detail: string | null;
      /** 分析出错（不是文件或范围本身的问题）时可以重试 */
      readonly retryable: boolean;
    };

/** 逐点编辑的节点上限：再多时拖动、渲染手柄都吃力，重新绘制或上传更合适 */
export const EDIT_VERTEX_LIMIT = 1000;

/** 每一步至少显示这么久（毫秒）：分析很快时也看得清在做什么 */
const STEP_MS = 360;

/** 换范围、画完时平滑移过去（毫秒）；打开弹窗时不带动画（ADR 0131） */
const FIT_MS = 600;

export interface ScopeEditorOptions {
  readonly model: Readonly<Ref<SimulationModel>>;
  /** 换上自定义范围（确定时） */
  readonly onConfirm: (area: ScopeArea) => void;
  /** 弹窗的默认视角按钮：没有范围时回到全省 */
  readonly goToDefaultView: () => void;
  /** 测试注入 */
  readonly analyzer?: AreaAnalyzer;
  /** 测试注入：每一步至少显示多久（毫秒），默认 STEP_MS */
  readonly stepMs?: number;
}

/** 打开弹窗时带上的：编辑时是现有的范围，上传时是文件 */
export interface ScopeStartInput {
  readonly area?: ScopeArea | null;
  readonly files?: readonly File[];
}

/** 范围弹窗的拥有者：弹窗、条件库、对话栏只显示和调用 */
export interface ScopeEditor {
  readonly open: Readonly<Ref<boolean>>;
  readonly draft: Readonly<ShallowRef<ScopeDraft | null>>;
  readonly analysis: Readonly<ShallowRef<ScopeAnalysis>>;
  /** 范围的名称：默认是文件名或"绘制范围"，用户改过后不再自动改 */
  readonly name: Readonly<Ref<string>>;
  readonly busy: ComputedRef<boolean>;
  readonly canUndo: ComputedRef<boolean>;
  /** 节点不超过 EDIT_VERTEX_LIMIT 时可以逐点编辑 */
  readonly canEdit: ComputedRef<boolean>;
  readonly canConfirm: ComputedRef<boolean>;
  /** 列表上悬停的区县：地图上描出来 */
  readonly hovered: Readonly<Ref<string | null>>;
  readonly draw: ShapeDraw;
  readonly edit: ShapeEdit;
  /** 交给 registerTools：框选、多边形、逐点编辑 */
  readonly tools: Readonly<Record<string, MapTool>>;
  /** 打开弹窗；编辑时带上现有的范围，上传时带上文件 */
  readonly start: (intent: ScopeIntent, input?: ScopeStartInput) => void;
  /** 弹窗的画布放好后定位：有范围时看整个范围，没有时看全省；不带动画，不从上一次的位置飞过去（ADR 0131） */
  readonly frame: () => void;
  readonly upload: (files: readonly File[]) => void;
  readonly setName: (name: string) => void;
  readonly undo: () => void;
  readonly clear: () => void;
  readonly retry: () => void;
  readonly hover: (code: string | null) => void;
  /** 地图移到这个区县 */
  readonly focusDistrict: (code: string) => void;
  /** 弹窗的默认视角：有范围时看整个范围，没有时看全省 */
  readonly overview: () => void;
  /** 确定：用这个范围，关上弹窗 */
  readonly confirm: () => void;
  /** 取消：丢掉草稿，关上弹窗 */
  readonly cancel: () => void;
  readonly deriveCover: () => StyleGroup;
  readonly deriveArea: () => StyleGroup;
}

interface Snapshot {
  readonly draft: ScopeDraft | null;
  readonly analysis: ScopeAnalysis;
  readonly name: string;
}

// 重新分析时用到的输入：重试按它再来一次
type Input =
  | { readonly kind: 'files'; readonly files: readonly File[] }
  | {
      readonly kind: 'shape';
      readonly geometry: MultiPolygon;
      readonly source: 'draw' | 'edit';
      readonly base: ScopeDraft | null;
    };

const geometryBounds = (geometry: Polygon | MultiPolygon): ViewBounds => polygonBounds(polygonsOf(geometry));

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>(resolve => {
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

const isAbort = (error: unknown) =>
  (error instanceof DOMException || error instanceof Error) && error.name === 'AbortError';

/**
 * 范围弹窗（ADR 0121、0131）：上传、绘制、逐点编辑都在 Worker 里整理、与 95 个区县求交；新的一次作废还没完成的分析。
 * 分析按步骤显示进度，读不了、在省外等原因写进分析，不弹提示；确定后才交给条件
 */
export function useScopeEditor(
  map: Pick<
    MapContext,
    'useCamera' | 'view' | 'pointer' | 'activeTool' | 'activateTool' | 'releaseTool' | 'runCameraOperation'
  >,
  options: ScopeEditorOptions
): ScopeEditor {
  const analyzer = options.analyzer ?? createAreaAnalyzer();
  const stepMs = options.stepMs ?? STEP_MS;
  const runs = new LatestController();
  onScopeDispose(() => {
    runs[Symbol.dispose]();
    if (!options.analyzer) {
      analyzer[Symbol.dispose]();
    }
  });

  const open = ref(false);
  const draft = shallowRef<ScopeDraft | null>(null);
  const analysis = shallowRef<ScopeAnalysis>({ status: 'empty' });
  const name = ref('');
  let nameEdited = false;
  const history = shallowRef<readonly Snapshot[]>([]);
  const hovered = ref<string | null>(null);
  let lastInput: Input | null = null;

  const atlasOf = (): DistrictAtlas | null => {
    const model = options.model.value;
    return model.status === 'ready' ? model.calculator.atlas : null;
  };
  // 范围内的人口：同计算时的折算（ADR 0121）
  const populationOf = (coverage: AreaCoverage): number => {
    const model = options.model.value;
    if (model.status !== 'ready') {
      return 0;
    }
    const { calculator } = model;
    return coverage.covers.reduce((sum, cover) => {
      const share = cover.relation === 'full' ? 1 : cover.ratio;
      return sum + calculator.districtPopulation(calculator.atlas.get(cover.code)) * share;
    }, 0);
  };
  let regionCache: { atlas: DistrictAtlas; regions: readonly RegionShape[] } | null = null;
  const regionsOf = (atlas: DistrictAtlas): readonly RegionShape[] => {
    if (regionCache?.atlas !== atlas) {
      const regions = atlas.all.map(district => ({ code: district.code, geometry: district.geometry }));
      regionCache = { atlas, regions };
    }
    return regionCache.regions;
  };

  const snapshot = (): Snapshot => ({ draft: draft.value, analysis: analysis.value, name: name.value });
  // 记下改动前的样子，撤销时回去；分析中途的不算
  const remember = (before: Snapshot) => {
    if (before.draft || before.analysis.status === 'done') {
      history.value = [...history.value, before];
    }
  };

  const fitTo = (geometry: MultiPolygon, duration = FIT_MS) => {
    map.runCameraOperation(camera => camera.fitBounds(geometryBounds(geometry), { maxZoom: 13, duration }));
  };
  const coverOf = (code: string) => {
    const current = analysis.value;
    return current.status === 'done' ? current.coverage.covers.find(cover => cover.code === code) : undefined;
  };

  const draw = useShapeDraw(map, { onComplete: shape => onDrawn(shape) });
  const edit = useShapeEdit(map, {
    geometry: () => (analysis.value.status === 'running' ? null : (draft.value?.geometry ?? null)),
    onChange: next => {
      void analyze({ kind: 'shape', geometry: next, source: 'edit', base: draft.value });
    }
  });

  // 一步一步地推进：每一步至少显示 stepMs
  const stepper = (labels: readonly string[], signal: AbortSignal) => {
    let index = 0;
    const stateAt = (at: number): StepState => {
      if (at < index) {
        return 'done';
      }
      return at === index ? 'running' : 'waiting';
    };
    const stepsNow = (): readonly AnalysisStep[] => labels.map((label, at) => ({ label, state: stateAt(at) }));
    const show = () => {
      if (!signal.aborted) {
        analysis.value = { status: 'running', steps: stepsNow() };
      }
    };
    show();
    return {
      get steps(): readonly AnalysisStep[] {
        return stepsNow();
      },
      /** 完成当前这一步，开始下一步；返回 false 表示已被作废 */
      async next(): Promise<boolean> {
        await wait(stepMs, signal);
        if (signal.aborted) {
          return false;
        }
        index += 1;
        show();
        return true;
      },
      /** 文件或范围本身的问题：写给用户的话按类型给，原话留作具体原因 */
      reject(problem: AreaProblem) {
        if (!signal.aborted) {
          analysis.value = {
            status: 'failed',
            message: problemText(problem.code),
            detail: problem.message,
            retryable: false
          };
        }
      },
      /** 分析本身没做成：可以重试 */
      fail(message: string) {
        if (!signal.aborted) {
          analysis.value = { status: 'failed', message, detail: null, retryable: true };
        }
      }
    };
  };

  // 读文件或整理画的范围，得到草稿；不能用时写进分析，返回 null
  async function prepare(input: Input, signal: AbortSignal, progress: ReturnType<typeof stepper>) {
    if (input.kind === 'files') {
      const read: AreaFileResult = await analyzer.read(input.files, signal);
      if (signal.aborted) {
        return null;
      }
      if (!read.ok) {
        progress.reject(read.problem);
        return null;
      }
      const file = input.files.find(item => /\.(zip|shp|geojson|json)$/i.test(item.name)) ?? input.files[0];
      const fileName = file?.name ?? '';
      const next: ScopeDraft = {
        geometry: read.area.geometry,
        outline: read.area.outline,
        source: 'upload',
        file: { name: fileName, format: read.format },
        vertices: read.area.vertices,
        notices: read.area.notices
      };
      if (!(await progress.next())) {
        return null;
      }
      if (!(await progress.next())) {
        return null;
      }
      return next;
    }
    const checked: AreaCheck = await analyzer.prepare(input.geometry.coordinates, signal);
    if (signal.aborted) {
      return null;
    }
    if (!checked.ok) {
      progress.reject(checked.problem);
      return null;
    }
    const next: ScopeDraft = {
      geometry: checked.area.geometry,
      outline: checked.area.outline,
      source: input.source === 'edit' && input.base ? input.base.source : 'draw',
      file: input.source === 'edit' && input.base ? input.base.file : null,
      vertices: checked.area.vertices,
      notices: checked.area.notices
    };
    if (!(await progress.next())) {
      return null;
    }
    return next;
  }

  const labelsOf = (input: Input): string[] => {
    const cover = ['叠加行政区边界', '统计覆盖情况'];
    if (input.kind === 'files') {
      const first = input.files[0]?.name ?? '';
      const more = input.files.length > 1 ? ` 等 ${input.files.length} 个文件` : '';
      return [`读取文件：${first}${more}`, '整理范围', ...cover];
    }
    return [input.source === 'edit' ? '整理修改后的范围' : '整理绘制的范围', ...cover];
  };

  // 分析一次：读或整理 → 求交 → 完成；新的一次作废这一次。不能用时也记下之前的样子，撤销就回到上一个范围
  async function analyze(input: Input) {
    const before = snapshot();
    const signal = runs.next();
    lastInput = input;
    hovered.value = null;
    const progress = stepper(labelsOf(input), signal);
    try {
      const next = await prepare(input, signal, progress);
      if (!next) {
        if (!signal.aborted) {
          remember(before);
        }
        return;
      }
      remember(before);
      draft.value = next;
      if (!nameEdited) {
        name.value = next.file ? next.file.name.replace(/\.[^.]+$/, '') : '绘制范围';
      }
      if (input.kind === 'files' || input.source === 'draw') {
        // 还没有范围时从全省飞过去没有信息量，直接定位；换范围、画完时平滑移过去，看得出前后的关系
        fitTo(next.geometry, input.kind === 'files' && !before.draft ? 0 : FIT_MS);
      }
      const atlas = atlasOf();
      if (!atlas) {
        progress.fail('区县数据还没有加载好，请稍后重试');
        return;
      }
      const covered = await analyzer.cover(next.geometry, regionsOf(atlas), '江苏省', signal);
      if (signal.aborted) {
        return;
      }
      if (!covered.ok) {
        progress.reject(covered.problem);
        return;
      }
      const tree = coverageTree(covered.coverage, atlas);
      if (!(await progress.next())) {
        return;
      }
      await wait(stepMs, signal);
      if (signal.aborted) {
        return;
      }
      const steps = progress.steps.map(step => (step.state === 'running' ? { ...step, state: 'done' as const } : step));
      analysis.value = {
        status: 'done',
        steps,
        coverage: covered.coverage,
        tree,
        summary: areaSummary(tree),
        notices: coverageNotices(covered.coverage),
        population: populationOf(covered.coverage)
      };
    } catch (error) {
      if (!signal.aborted && !isAbort(error)) {
        progress.fail('分析没有完成，请重试；多次失败时换一个文件或重新绘制');
      }
    }
  }

  function onDrawn(shape: DrawnShape) {
    draw.clear();
    const geometry: MultiPolygon = { type: 'MultiPolygon', coordinates: [shape.polygon.coordinates] };
    void analyze({ kind: 'shape', geometry, source: 'draw', base: null });
  }

  const reset = () => {
    runs.abort();
    draw.stop();
    draw.clear();
    edit.stop();
    draft.value = null;
    analysis.value = { status: 'empty' };
    history.value = [];
    hovered.value = null;
    lastInput = null;
    name.value = '';
    nameEdited = false;
  };

  // 编辑已有的范围：直接用它的分析，不重算
  const restore = (area: ScopeArea) => {
    const atlas = atlasOf();
    if (!atlas) {
      return;
    }
    draft.value = {
      geometry: area.geometry,
      outline: area.outline,
      source: area.source,
      file: area.file,
      vertices: vertexCount(area.geometry),
      notices: []
    };
    const tree = coverageTree(area.coverage, atlas);
    analysis.value = {
      status: 'done',
      steps: [],
      coverage: area.coverage,
      tree,
      summary: areaSummary(tree),
      notices: coverageNotices(area.coverage),
      population: populationOf(area.coverage)
    };
    name.value = area.name;
    nameEdited = true;
  };

  const edgesData = computed(() => {
    const atlas = atlasOf();
    return open.value && atlas ? districtEdges(atlas.all.map(district => district.geometry)) : null;
  });
  const piecesData = computed(() => {
    const current = analysis.value;
    return current.status === 'done' ? coverPieces(current.coverage.covers) : null;
  });
  // 遮罩随范围缓存：悬停时不重算，数据源也不重新加载
  const shapeData = computed(() => (open.value && draft.value ? areaShape(draft.value.geometry) : null));

  return {
    open,
    draft,
    analysis,
    name,
    busy: computed(() => analysis.value.status === 'running'),
    canUndo: computed(() => history.value.length > 0),
    canEdit: computed(() => draft.value !== null && draft.value.vertices <= EDIT_VERTEX_LIMIT),
    canConfirm: computed(() => draft.value !== null && analysis.value.status === 'done' && name.value.trim() !== ''),
    hovered,
    draw,
    edit,
    tools: { ...draw.tools, ...edit.tools },
    start: (intent, input = {}) => {
      reset();
      open.value = true;
      const { area = null, files } = input;
      if (area) {
        restore(area);
      }
      if (files && files.length > 0) {
        void analyze({ kind: 'files', files });
      } else if (intent === 'draw') {
        draw.toggle('polygon');
      }
    },
    frame: () => {
      const shape = draft.value;
      map.runCameraOperation(camera => {
        if (shape) {
          camera.fitBounds(geometryBounds(shape.geometry), { maxZoom: 13, duration: 0 });
        } else {
          camera.fitBounds(JIANGSU_BOUNDS, { duration: 0, pitch: 0 });
        }
      });
    },
    upload: files => {
      if (files.length > 0) {
        draw.stop();
        edit.stop();
        void analyze({ kind: 'files', files });
      }
    },
    setName: value => {
      nameEdited = true;
      name.value = value;
    },
    undo: () => {
      const last = history.value.at(-1);
      if (!last) {
        return;
      }
      runs.abort();
      history.value = history.value.slice(0, -1);
      draft.value = last.draft;
      analysis.value = last.analysis.status === 'running' ? { status: 'empty' } : last.analysis;
      if (!nameEdited) {
        name.value = last.name;
      }
      if (!last.draft) {
        edit.stop();
      }
    },
    clear: () => {
      if (!draft.value && analysis.value.status === 'empty') {
        return;
      }
      runs.abort();
      remember(snapshot());
      edit.stop();
      draft.value = null;
      analysis.value = { status: 'empty' };
    },
    retry: () => {
      if (lastInput) {
        void analyze(lastInput);
      }
    },
    hover: code => {
      hovered.value = code;
    },
    focusDistrict: code => {
      const cover = coverOf(code);
      if (cover) {
        const bounds = geometryBounds(cover.geometry);
        map.runCameraOperation(camera => camera.fitBounds(bounds, { maxZoom: 12, duration: FIT_MS }));
      }
    },
    overview: () => {
      const shape = draft.value;
      if (shape) {
        fitTo(shape.geometry);
      } else {
        options.goToDefaultView();
      }
    },
    confirm: () => {
      const atlas = atlasOf();
      const current = analysis.value;
      const shape = draft.value;
      if (!atlas || !shape || current.status !== 'done' || name.value.trim() === '') {
        return;
      }
      const area = createScopeArea(atlas, {
        name: name.value.trim(),
        source: shape.source,
        file: shape.file,
        geometry: shape.geometry,
        outline: shape.outline,
        coverage: current.coverage
      });
      reset();
      open.value = false;
      options.onConfirm(area);
    },
    cancel: () => {
      reset();
      open.value = false;
    },
    deriveCover: () => coverGroup(edgesData.value, piecesData.value),
    deriveArea: () => {
      const code = hovered.value;
      // 只高亮区县在范围内的部分：Worker 求交时已经算好（ADR 0131）
      return areaGroup(shapeData.value, open.value && code ? (coverOf(code)?.geometry ?? null) : null);
    }
  };
}
