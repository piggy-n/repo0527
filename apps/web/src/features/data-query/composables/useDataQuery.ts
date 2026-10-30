import type { StyleGroup } from '@yzt/map-core';
import type { MapContext } from '@yzt/map-vue';
import { computed, type ComputedRef, readonly, type Ref, ref } from 'vue';
import { appConfig } from '@/shared/config/app-config';
import type { RegionBoundaryLoader } from '@/shared/map/region/region-geometry';
import { previewGroup, PROVINCE_CODE, queryTileBase } from '../result-layers';
import type { QueryLayer, QueryTopic } from '../topics';
import { type AdvancedForm, useAdvancedForm } from './useAdvancedForm';
import { type AttributeForm, type FormCheck, useAttributeForm } from './useAttributeForm';
import { type NaturalLanguage, useNaturalLanguage } from './useNaturalLanguage';
import { type QueryExport, useQueryExport } from './useQueryExport';
import { type QueryResult, useQueryResult } from './useQueryResult';
import { type SpatialForm, useSpatialForm } from './useSpatialForm';

/** 查询面板的四个页签：高级查询从旧页面的单独按钮并入，排在空间查询之后（ADR 0104） */
export type QueryTab = 'attribute' | 'spatial' | 'advanced' | 'natural';

export const QUERY_TABS: readonly { readonly id: QueryTab; readonly label: string }[] = [
  { id: 'attribute', label: '属性查询' },
  { id: 'spatial', label: '空间查询' },
  { id: 'advanced', label: '高级查询' },
  { id: 'natural', label: '自然语言查询' }
];

/** 面板上显示的页签：高级查询暂时隐藏（2026-10-30），表单、提交和导出的逻辑都保留，去掉过滤即恢复 */
export const SHOWN_QUERY_TABS = QUERY_TABS.filter(item => item.id !== 'advanced');

/** 点"查询"（或画完范围自动查询）的结果，页面据此提示 */
export type SubmitResult =
  | { readonly kind: 'submitted' }
  | { readonly kind: 'invalid'; readonly reason: string }
  /** 画完了范围，还没选图层 */
  | { readonly kind: 'drawn' }
  /** 自然语言没有匹配的规则 */
  | { readonly kind: 'unrecognized' }
  /** 自然语言的解析被作废（切页签、重置、卸载） */
  | { readonly kind: 'canceled' };

export interface DataQueryOptions {
  readonly topic: QueryTopic;
  readonly map: Pick<
    MapContext,
    'beginCameraOperation' | 'useCamera' | 'view' | 'pointer' | 'activeTool' | 'activateTool' | 'releaseTool'
  >;
  /** 画完范围后自动查询的结果（同旧页面：已选图层时直接查询） */
  readonly onDrawSubmit?: (result: SubmitResult) => void;
  /** 测试时传入 */
  readonly loader?: RegionBoundaryLoader;
}

/** 一个专题的数据查询：四个页签的表单、查询结果和导出，在页面的 setup 中调用 */
export interface DataQuery {
  readonly topic: QueryTopic;
  readonly tab: Readonly<Ref<QueryTab>>;
  readonly attribute: AttributeForm;
  readonly spatial: SpatialForm;
  readonly advanced: AdvancedForm;
  /** 建设中的专题没有 */
  readonly natural: NaturalLanguage | null;
  readonly result: QueryResult;
  readonly exporter: QueryExport;
  /** 查询按钮转圈：自然语言在解析，或者刚提交的查询还没有结果 */
  readonly busy: ComputedRef<boolean>;
  /** 切页签：属性和自然语言查询共用结果，其余切换清掉结果；离开空间查询时结束绘制、清掉画的范围（同旧页面） */
  readonly changeTab: (tab: QueryTab) => void;
  readonly submit: () => Promise<SubmitResult>;
  /** 重置当前页签的表单并清掉结果；自然语言的重置同时重置属性查询（同旧页面） */
  readonly reset: () => void;
  /** 绑定到 query-preview 分组：当前页签选的图层，自然语言查询不预览 */
  readonly derivePreview: () => StyleGroup;
}

const ATTRIBUTE_FAMILY: ReadonlySet<QueryTab> = new Set(['attribute', 'natural']);

export function useDataQuery({ topic, map, onDrawSubmit, loader }: DataQueryOptions): DataQuery {
  const tab = ref<QueryTab>('attribute');
  const attribute = useAttributeForm(topic);
  const advanced = useAdvancedForm(topic);
  const natural = topic.natural ? useNaturalLanguage(topic.natural) : null;
  const result = useQueryResult({ map, topic, ...(loader && { loader }) });
  const exporter = useQueryExport(result);
  const tileBase = queryTileBase(appConfig.apiBaseUrl, window.location.origin);

  const submitCheck = (check: FormCheck): SubmitResult => {
    if (!check.ok) {
      return { kind: 'invalid', reason: check.reason };
    }
    result.submit(check.request);
    return { kind: 'submitted' };
  };

  const spatial = useSpatialForm(map, topic, {
    // 开始画新的范围时，上一次空间查询的结果作废（同旧页面）
    onDrawStart: () => result.clear(),
    onDrawComplete: () => onDrawSubmit?.(spatial.layer.value ? submitCheck(spatial.check()) : { kind: 'drawn' })
  });

  const submitNatural = async (): Promise<SubmitResult> => {
    if (natural === null) {
      return { kind: 'invalid', reason: '该专题暂无可查询的图层' };
    }
    if (natural.text.value.trim() === '') {
      return { kind: 'invalid', reason: '请输入查询内容' };
    }
    const parsed = await natural.parse();
    if (parsed.kind === 'canceled') {
      return parsed;
    }
    if (parsed.rule === null) {
      return { kind: 'unrecognized' };
    }
    attribute.apply(parsed.rule);
    return submitCheck(attribute.check('natural'));
  };

  // 每个页签各自选的图层；自然语言查询不预览（同旧页面）
  const previewLayers: Readonly<Record<QueryTab, () => QueryLayer | null>> = {
    attribute: () => attribute.layer.value,
    spatial: () => spatial.layer.value,
    advanced: () => advanced.layer.value,
    natural: () => null
  };
  const previewLayer = computed(() => previewLayers[tab.value]());

  // 各页签的提交；高级查询的 SQL 里没写区划时，用属性查询选的，都没有时是全省（同旧页面）
  const submits: Readonly<Record<QueryTab, () => SubmitResult | Promise<SubmitResult>>> = {
    attribute: () => submitCheck(attribute.check('attribute')),
    spatial: () => submitCheck(spatial.check()),
    advanced: () => submitCheck(advanced.check(attribute.region.value ?? PROVINCE_CODE)),
    natural: submitNatural
  };

  const busy = computed(() => {
    const request = result.request.value;
    const origin = request?.kind === 'attribute' ? request.origin : 'spatial';
    const waiting = request !== null && result.initialLoading.value && origin === tab.value;
    return natural?.parsing.value === true || waiting;
  });

  return {
    topic,
    tab: readonly(tab),
    attribute,
    spatial,
    advanced,
    natural,
    result,
    exporter,
    busy,
    changeTab: next => {
      const previous = tab.value;
      if (next === previous) {
        return;
      }
      if (!(ATTRIBUTE_FAMILY.has(next) && ATTRIBUTE_FAMILY.has(previous))) {
        result.clear();
      }
      if (previous === 'natural') {
        natural?.cancel();
      }
      if (previous === 'spatial') {
        spatial.draw.stop();
        spatial.draw.clear();
      }
      tab.value = next;
    },
    submit: async () => submits[tab.value](),
    reset: () => {
      switch (tab.value) {
        case 'attribute':
          attribute.reset();
          break;
        case 'spatial':
          spatial.reset();
          break;
        case 'advanced':
          advanced.reset();
          break;
        case 'natural':
          natural?.reset();
          attribute.reset();
          break;
      }
      result.clear();
    },
    derivePreview: () => previewGroup(previewLayer.value, tileBase)
  };
}
