import { useMapOverlay } from '@yzt/map-vue';
import { MxPanel, MxTitle } from '@yzt/ui';
import { ElButton, ElCascader, ElDatePicker, ElMessageBox, ElTooltip } from 'element-plus';
import { computed, defineComponent, onBeforeUnmount, type PropType, ref } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { districtsOf, JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import type { CalculationRequest } from '../calculation';
import type { IndicatorCalculation } from '../composables/useIndicatorCalculation';
import type { IndicatorConditions } from '../composables/useIndicatorConditions';
import type { IndicatorTree as IndicatorTreeOwner } from '../composables/useIndicatorTree';
import styles from './IndicatorPanel.module.scss';
import { IndicatorTree } from './IndicatorTree';

/** 左侧面板的两个页签：计算只算和看进度，展示选一个已完成的指标看成果 */
export type IndicatorTab = 'calculation' | 'result';

const TABS: readonly { readonly id: IndicatorTab; readonly label: string }[] = [
  { id: 'calculation', label: '指标计算' },
  { id: 'result', label: '指标展示' }
];

// 监测范围从市开始，可以只选市，也可以选到区县（同旧页面，没有全省）
const REGION_OPTIONS = JIANGSU_CITIES.map(city => ({
  value: city.code,
  label: city.name,
  children: districtsOf(city.code).map(district => ({ value: district.code, label: district.name }))
}));

const REGION_PROPS = { checkStrictly: true, expandTrigger: 'hover', emitPath: false } as const;

/**
 * 指标面板（左侧）：两个页签共用年份和监测范围，各有一棵指标树；计算页签底部是重置和开始计算。
 * 窄屏时让给右边由页面决定，收起与否由页面通过 collapsed 给出
 */
export const IndicatorPanel = defineComponent({
  name: 'IndicatorPanel',
  props: {
    tab: { type: String as PropType<IndicatorTab>, required: true },
    conditions: { type: Object as PropType<IndicatorConditions>, required: true },
    calculationTree: { type: Object as PropType<IndicatorTreeOwner>, required: true },
    resultTree: { type: Object as PropType<IndicatorTreeOwner>, required: true },
    calculation: { type: Object as PropType<IndicatorCalculation>, required: true },
    collapsed: { type: Boolean, default: false }
  },
  emits: {
    'update:tab': (tab: IndicatorTab) => typeof tab === 'string',
    'update:collapsed': (collapsed: boolean) => typeof collapsed === 'boolean'
  },
  setup(props, { emit }) {
    const element = ref<HTMLElement>();
    useMapOverlay(element, 'left');
    // ElMessageBox 不随组件卸载关闭：卸载时关掉本组件打开的确认框；它只能一次关闭全部，所以只在有打开的时调用
    let openConfirms = 0;
    onBeforeUnmount(() => {
      if (openConfirms > 0) {
        ElMessageBox.close();
      }
    });

    const confirmStart = async (existing: boolean): Promise<boolean> => {
      openConfirms++;
      try {
        await ElMessageBox.confirm(
          existing ? '当前选中的指标已存在计算结果，是否重新计算？' : '是否开始计算当前选中的指标？',
          '提示',
          { type: 'warning', confirmButtonText: existing ? '重新计算' : '开始计算' }
        );
        return true;
      } catch {
        // 点了取消、关闭，或页面销毁时被关闭
        return false;
      } finally {
        openConfirms--;
      }
    };

    // 不能开始时的原因，显示在按钮的提示里；可以开始时为 null
    const blocked = computed(() => {
      if (props.calculation.busy.value) {
        return '当前计算任务进行中';
      }
      if (props.conditions.year.value === null) {
        return '请先选择年份';
      }
      if (props.conditions.region.value === null) {
        return '请选择监测范围';
      }
      return props.calculationTree.picked.value.length === 0 ? '请至少选择一个指标' : null;
    });

    const start = () => {
      const year = props.conditions.year.value;
      const region = props.conditions.region.value;
      if (blocked.value !== null || year === null || region === null) {
        return;
      }
      const request: CalculationRequest = {
        year,
        regionCode: region.code,
        regionName: region.name,
        indicators: props.calculationTree.picked.value.map(({ code, name }) => ({ code, name }))
      };
      void props.calculation.start(request, confirmStart);
    };

    // 重置回默认条件，清掉两棵树的选择和这次计算
    const reset = () => {
      props.conditions.reset();
      props.calculationTree.clear();
      props.resultTree.clear();
      props.calculation.reset();
    };

    const renderConditions = () => (
      <section class={styles.conditions}>
        <MxTitle>计算设置</MxTitle>
        <div class={styles.field}>
          <span class={styles.label}>年份</span>
          <ElDatePicker
            class={styles.control}
            type="year"
            modelValue={props.conditions.year.value === null ? '' : String(props.conditions.year.value)}
            valueFormat="YYYY"
            format="YYYY年"
            placeholder="请选择年份"
            onUpdate:modelValue={(value: string | null) => props.conditions.setYear(value ? Number(value) : null)}
          />
        </div>
        <div class={styles.field}>
          <span class={styles.label}>监测范围</span>
          <ElCascader
            class={styles.control}
            modelValue={props.conditions.region.value?.code ?? null}
            options={REGION_OPTIONS}
            props={REGION_PROPS}
            clearable
            placeholder="请选择市或区县"
            onUpdate:modelValue={value => props.conditions.setRegion(typeof value === 'string' ? value : null)}
          />
        </div>
      </section>
    );

    const renderFooter = () => (
      <div class={styles.footer}>
        <ElButton onClick={reset}>重置</ElButton>
        <ElTooltip disabled={blocked.value === null} content={blocked.value ?? ''} placement="top">
          <span class={styles.start}>
            <ElButton
              type="primary"
              loading={props.calculation.busy.value}
              disabled={blocked.value !== null}
              onClick={start}
            >
              开始计算
            </ElButton>
          </span>
        </ElTooltip>
      </div>
    );

    // 收起时面板只隐藏不卸载：树的搜索、展开状态还在
    return () => {
      const calculating = props.tab === 'calculation';
      return (
        <div ref={element} class={styles.root} data-indicator-panel>
          {props.collapsed && (
            <button
              type="button"
              class={styles.strip}
              aria-label="展开监测指标"
              onClick={() => emit('update:collapsed', false)}
            >
              <SvgIcon class={styles.stripIcon} name="panel-expand" size={16} />
              <span class={styles.stripLabel}>监测指标</span>
            </button>
          )}
          <MxPanel floating flush headerTone="muted" class={styles.panel} v-show={!props.collapsed}>
            {{
              header: () => (
                <div class={styles.header}>
                  <MxTitle level="panel">监测指标</MxTitle>
                  <nav class={styles.tabs} role="tablist">
                    {TABS.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        role="tab"
                        class={[styles.tab, props.tab === item.id && styles.currentTab]}
                        aria-selected={props.tab === item.id}
                        onClick={() => emit('update:tab', item.id)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </nav>
                </div>
              ),
              actions: () => (
                <button
                  type="button"
                  class={styles.collapse}
                  aria-label="收起监测指标"
                  onClick={() => emit('update:collapsed', true)}
                >
                  <SvgIcon name="panel-collapse" size={16} />
                </button>
              ),
              default: () => (
                <div class={styles.body}>
                  {renderConditions()}
                  {/* 两棵树都保留着：切页签时搜索、展开的状态还在 */}
                  <div class={styles.tree} v-show={calculating}>
                    <IndicatorTree tree={props.calculationTree} variant="calculation" />
                  </div>
                  <div class={styles.tree} v-show={!calculating}>
                    <IndicatorTree tree={props.resultTree} variant="result" />
                  </div>
                </div>
              ),
              footer: calculating ? renderFooter : undefined
            }}
          </MxPanel>
        </div>
      );
    };
  }
});
