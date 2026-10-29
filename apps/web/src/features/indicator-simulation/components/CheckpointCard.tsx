import { ElButton, ElSpace } from 'element-plus';
import { defineComponent, type PropType, ref, shallowRef, type VNodeChild } from 'vue';
import type { Checkpoint, CheckpointDecision } from '../engine/engine';
import { walkMinutes } from '../model/indicators';
import { describeParam, SCOPE_LABELS, type SimulationConditions, type SimulationParams } from '../model/params';
import { em, type Rich, rich } from '../run/narrative';
import { ParamFields } from './ParamFields';
import styles from './CheckpointCard.module.scss';
import { RichText } from './RichText';

function spatialText(conditions: SimulationConditions, params: SimulationParams): Rich {
  const radii = walkMinutes(conditions.indicatorIds)
    .map(value => `${value} 分钟约 ${value * params.walkSpeed} 米`)
    .join('、');
  return rich`采用演示参数：步行速度 ${em(`${params.walkSpeed} 米/分钟`)}${radii === '' ? '' : `（${radii}）`}，纳入${em(SCOPE_LABELS[params.facilityScope])}，规划新增 ${em(describeParam('newFacilities', params, conditions))}。`;
}

/** 等人确认的卡片：数据核查问缺失人口怎么处理，空间分析确认参数（也可以转去人工干预） */
export const CheckpointCard = defineComponent({
  name: 'CheckpointCard',
  props: {
    checkpoint: { type: Object as PropType<Checkpoint>, required: true },
    conditions: { type: Object as PropType<SimulationConditions>, required: true },
    params: { type: Object as PropType<SimulationParams>, required: true }
  },
  emits: {
    resolve: (decision: CheckpointDecision) => typeof decision === 'object',
    adjust: () => true
  },
  setup(props, { emit }) {
    // 手动填写缺失人口时展开的编辑项
    const manual = ref(false);
    const draft = shallowRef(props.params);

    const renderQc = (checkpoint: Extract<Checkpoint, { step: 'qc' }>): VNodeChild => {
      const suggested = checkpoint.missing.map(({ district, imputed }) => `${district.name} ${imputed} 万`).join('、');
      return (
        <>
          <p class={styles.text}>
            <RichText
              text={rich`建议按上年人口 × 近三年平均增长率插补：${em(suggested)}。剔除会让它们不参与汇总，手动填写可以输入核实后的数字。`}
            />
          </p>
          {manual.value ? (
            <div class={styles.manual}>
              <ParamFields
                keys={['missing']}
                conditions={props.conditions}
                missing={checkpoint.missing}
                modelValue={draft.value}
                onUpdate:modelValue={params => (draft.value = params)}
              />
              <ElSpace class={styles.options} wrap size={6}>
                <ElButton size="small" onClick={() => (manual.value = false)}>
                  返回
                </ElButton>
                <ElButton
                  size="small"
                  type="primary"
                  onClick={() => emit('resolve', { step: 'qc', missing: draft.value.missing })}
                >
                  确定
                </ElButton>
              </ElSpace>
            </div>
          ) : (
            <ElSpace class={styles.options} wrap size={6}>
              <ElButton
                size="small"
                type="primary"
                onClick={() => emit('resolve', { step: 'qc', missing: { kind: 'impute' } })}
              >
                按趋势插补（推荐）
              </ElButton>
              <ElButton size="small" onClick={() => emit('resolve', { step: 'qc', missing: { kind: 'exclude' } })}>
                剔除这 {checkpoint.missing.length} 个区县
              </ElButton>
              <ElButton
                size="small"
                onClick={() => {
                  draft.value = {
                    ...props.params,
                    missing: {
                      kind: 'manual',
                      values: Object.fromEntries(
                        checkpoint.missing.map(({ district, imputed }) => [district.code, imputed])
                      )
                    }
                  };
                  manual.value = true;
                }}
              >
                手动填写
              </ElButton>
            </ElSpace>
          )}
        </>
      );
    };

    const renderSpatial = (): VNodeChild => (
      <>
        <p class={styles.text}>
          <RichText text={spatialText(props.conditions, props.params)} />
        </p>
        <ElSpace class={styles.options} wrap size={6}>
          <ElButton size="small" type="primary" onClick={() => emit('resolve', { step: 'spatial' })}>
            按此执行
          </ElButton>
          <ElButton size="small" onClick={() => emit('adjust')}>
            人工干预
          </ElButton>
        </ElSpace>
      </>
    );

    return () => {
      const { checkpoint } = props;
      return (
        <div class={styles.root} role="group" aria-label="需要你确认">
          <div class={styles.title}>
            需要你确认：{checkpoint.step === 'qc' ? '缺失人口如何处理' : '空间分析参数'}
          </div>
          {checkpoint.step === 'qc' ? renderQc(checkpoint) : renderSpatial()}
        </div>
      );
    };
  }
});
