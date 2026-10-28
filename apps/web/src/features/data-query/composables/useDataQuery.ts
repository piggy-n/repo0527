import { computed, ref, type Ref, shallowRef, watch } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import { useDownloads } from '@/shared/file-transfer/useDownloads';
import { findRegion } from '@/shared/map/region/region-catalog';
import { downloadQuery, type QueryRecord } from '../api';
import { advancedConditions, buildConditions, matchNatural, regionName } from '../conditions';
import { NATURAL_RULES, PAGE_SIZE, QUERY_LAYERS } from '../config';
import { useDataQueries } from '../queries';
import type {
  ExportFormat,
  FieldValue,
  QueryCondition,
  QueryMode,
  QueryModule,
  QueryScope,
  QuerySnapshot,
  SpatialMethod
} from '../types';
import type { QueryDrawing } from './useQueryDrawing';

// 快照身份只用作查询缓存的 key，用递增的序号：普通 HTTP 的内网没有 crypto.randomUUID
let snapshotCount = 0;

function scopeLabel(scope: QueryScope): string {
  if (scope.kind === 'region') {
    return regionName(scope.code);
  }
  return scope.kind === 'shp' ? scope.file.name : '所选范围';
}

/** 编辑条件和执行快照分离，翻页、导出与地图始终使用同一轮查询参数 */
export function useDataQuery(module: Ref<QueryModule>, drawing: Pick<QueryDrawing, 'geometry' | 'stop' | 'clear'>) {
  const layers = computed(() => QUERY_LAYERS[module.value]);
  const layerCode = ref(layers.value[0]?.code ?? '');
  const layer = computed(() => layers.value.find(item => item.code === layerCode.value));
  const mode = ref<QueryMode>('attribute');
  const region = ref('320000');
  const conditions = ref<QueryCondition[]>([]);
  const relation = ref<'AND' | 'OR'>('AND');
  const advanced = ref('');
  const natural = ref('');
  const method = ref<SpatialMethod>('rectangle');
  const file = shallowRef<File | null>(null);
  const error = ref('');
  const formOpen = ref(true);
  const resultOpen = ref(false);
  const maximized = ref(false);
  const page = ref(1);
  // 分页元信息保留到本次查询结束，翻页失败时仍可回到其他页
  const total = ref(0);
  const submitted = shallowRef<QuerySnapshot | null>(null);
  const selected = shallowRef<QueryRecord | null>(null);
  const downloads = useDownloads(downloadQuery);
  const queries = useDataQueries(submitted, page);
  const loading = useDelayedFlag(() => submitted.value !== null && queries.pageQuery.isFetching.value);
  const busy = computed(() => submitted.value !== null && queries.pageQuery.isFetching.value);
  const signature = computed(() => JSON.stringify([
    layerCode.value,
    mode.value,
    region.value,
    conditions.value,
    relation.value,
    advanced.value,
    natural.value,
    method.value,
    drawing.geometry.value,
    file.value?.name,
    file.value?.lastModified,
    file.value?.size
  ]));
  const changed = computed(() => {
    const snapshot = submitted.value;
    return snapshot !== null && (snapshot.signature !== signature.value ||
      (snapshot.scope.kind === 'shp' && snapshot.scope.file !== file.value));
  });
  const summary = computed(() => {
    const request = submitted.value;
    return request ? `${request.layer.label} · ${scopeLabel(request.scope)}` : '';
  });
  const expression = computed(() => {
    if (!layer.value) {
      return '';
    }
    try {
      return buildConditions(layer.value, conditions.value, relation.value);
    } catch {
      return '条件未完整，请检查后查询';
    }
  });
  const examples = computed(() => NATURAL_RULES[module.value]);

  function clearResults() {
    submitted.value = null;
    selected.value = null;
    page.value = 1;
    total.value = 0;
    resultOpen.value = false;
    maximized.value = false;
    error.value = '';
  }

  function initialValue(code: string): FieldValue {
    const field = layer.value?.fields.find(item => item.code === code);
    const value = field?.initial;
    if (field?.type === 'multipleSelect') {
      return Array.isArray(value) ? [...value] : [];
    }
    return Array.isArray(value) ? value[0] ?? '' : value ?? '';
  }

  function addCondition(code: string) {
    const field = layer.value?.fields.find(item => item.code === code);
    if (!field || conditions.value.some(item => item.code === code)) {
      return;
    }
    conditions.value.push({ code, value: initialValue(code), operator: field.operators?.[0] ?? '=' });
  }

  function reset() {
    clearResults();
    drawing.clear();
    conditions.value = [];
    for (const field of layer.value?.fields ?? []) {
      if (field.shown) {
        addCondition(field.code);
      }
    }
    relation.value = 'AND';
    region.value = '320000';
    advanced.value = '';
    natural.value = '';
    file.value = null;
  }

  function search(): boolean {
    // 先作废上一轮，再做可能失败的准备，错误条件不能继续导出旧结果
    clearResults();
    drawing.stop();
    try {
      let target = layer.value;
      let regionCode = region.value;
      let filter = '';
      if (mode.value === 'natural') {
        const rule = matchNatural(module.value, natural.value);
        target = layers.value.find(item => item.code === rule.layerCode);
        regionCode = rule.region;
        filter = rule.conditions;
      }
      if (!target) {
        throw new Error('请选择查询图层');
      }
      if (regionCode !== '320000' && !findRegion(regionCode)) {
        throw new Error('请选择有效的行政区划');
      }
      if (mode.value === 'attribute') {
        filter = buildConditions(target, conditions.value, relation.value);
      } else if (mode.value === 'advanced') {
        filter = advancedConditions(advanced.value);
      }
      let scope: QueryScope = { kind: 'region', code: regionCode };
      if (mode.value === 'spatial') {
        if (method.value === 'shp') {
          if (!file.value || !/\.(shp|zip)$/i.test(file.value.name) || file.value.size === 0) {
            throw new Error('请选择非空的 SHP 或 ZIP 文件');
          }
          scope = { kind: 'shp', file: file.value };
        } else {
          if (!drawing.geometry.value) {
            throw new Error('请先在地图上绘制查询范围');
          }
          scope = { kind: 'geometry', geometry: drawing.geometry.value };
        }
      }
      snapshotCount += 1;
      submitted.value = {
        id: String(snapshotCount),
        layer: target,
        mode: mode.value,
        conditions: filter,
        scope,
        signature: signature.value
      };
      resultOpen.value = true;
      return true;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '查询条件不完整';
      return false;
    }
  }

  function exportResults(formats: readonly ExportFormat[]) {
    const snapshot = submitted.value;
    if (!snapshot || !queries.result.value?.total || !formats.length) {
      return;
    }
    void downloads.start({
      id: `${snapshot.id}:${formats.join(',')}`,
      name: `${snapshot.layer.label}查询结果`,
      snapshot,
      formats
    });
  }

  watch(layerCode, reset, { immediate: true });
  watch(module, () => {
    mode.value = 'attribute';
    layerCode.value = layers.value[0]?.code ?? '';
    reset();
  });
  watch(mode, () => {
    clearResults();
    drawing.clear();
  });
  watch(method, () => {
    drawing.clear();
    file.value = null;
  });
  watch(page, () => (selected.value = null));
  watch([queries.result, queries.pageQuery.isFetching], ([result, fetching]) => {
    if (result && !fetching) {
      total.value = result.total;
      page.value = Math.min(page.value, Math.max(1, Math.ceil(result.total / PAGE_SIZE)));
    }
  });

  return {
    layers,
    layer,
    layerCode,
    mode,
    region,
    conditions,
    relation,
    advanced,
    natural,
    method,
    file,
    error,
    formOpen,
    resultOpen,
    maximized,
    page,
    total,
    submitted,
    selected,
    downloads,
    loading,
    busy,
    changed,
    summary,
    expression,
    examples,
    ...queries,
    reset,
    search,
    addCondition,
    exportResults
  };
}

export type DataQuery = ReturnType<typeof useDataQuery>;
