import { ElCheckTag, ElInputNumber, ElRadioButton, ElRadioGroup, ElSlider } from 'element-plus';
import { defineComponent, type PropType, type VNodeChild } from 'vue';
import type { MissingPopulation } from '../engine/engine';
import { simulationIndicator, walkMinutes } from '../model/indicators';
import {
  CALIBER_LABELS,
  type FacilityScope,
  inScenario,
  MISSING_LABELS,
  type MissingTreatment,
  NEW_FACILITIES_RANGE,
  PARAM_LABELS,
  type ParamKey,
  type PopulationCaliber,
  SCOPE_LABELS,
  type SimulationConditions,
  type SimulationParams,
  WALK_SPEED_RANGE
} from '../model/params';
import styles from './ParamFields.module.scss';

const CALIBERS: readonly PopulationCaliber[] = ['resident', 'registered'];
const SCOPES: readonly FacilityScope[] = ['all', 'standard', 'large'];
const MISSING_KINDS: readonly MissingTreatment['kind'][] = ['impute', 'exclude', 'manual'];

// 单选组的值换回选项；不在选项里的忽略
const pick = <T extends string>(options: readonly T[], value: unknown): T | undefined =>
  options.find(option => option === value);

// 步行类覆盖率各自的服务半径
function radiiText(conditions: SimulationConditions, walkSpeed: number): string {
  const minutes = walkMinutes(conditions.indicatorIds);
  if (minutes.length === 0) {
    return '所选指标没有步行类覆盖率，不受影响';
  }
  return `服务半径：${minutes.map(value => `${value} 分钟 ${value * walkSpeed} 米`).join('，')}`;
}

// 一项参数：名称、右侧的当前值、编辑控件
const field = (key: ParamKey, content: VNodeChild, value?: string) => (
  <div key={key} class={styles.field}>
    <div class={styles.label}>
      {PARAM_LABELS[key]}
      {value !== undefined && <span class={styles.value}>{value}</span>}
    </div>
    {content}
  </div>
);

/** 参数的编辑项：编排阶段的参数节点只编辑一项，人工干预编辑全部；改动交给拥有者，组件不保存 */
export const ParamFields = defineComponent({
  name: 'ParamFields',
  props: {
    keys: { type: Array as PropType<readonly ParamKey[]>, required: true },
    conditions: { type: Object as PropType<SimulationConditions>, required: true },
    modelValue: { type: Object as PropType<SimulationParams>, required: true },
    /** 最新年度缺失人口的区县：数据核查发现后才有，缺失数据处理按它编辑 */
    missing: { type: Array as PropType<readonly MissingPopulation[]>, default: () => [] }
  },
  emits: {
    'update:modelValue': (params: SimulationParams) => typeof params === 'object'
  },
  setup(props, { emit }) {
    const update = (patch: Partial<SimulationParams>) => emit('update:modelValue', { ...props.modelValue, ...patch });

    const toggleScope = (id: string) => {
      const { conditions, modelValue } = props;
      const scope = new Set(modelValue.scenarioIds ?? conditions.indicatorIds);
      if (scope.has(id)) {
        scope.delete(id);
      } else {
        scope.add(id);
      }
      const ids = conditions.indicatorIds.filter(item => scope.has(item));
      update({ scenarioIds: ids.length === conditions.indicatorIds.length ? null : ids });
    };

    // 手动填写的人口：没填过的用插补值
    const manualValues = (): Readonly<Record<string, number>> => {
      const { missing, modelValue } = props;
      const filled = modelValue.missing.kind === 'manual' ? modelValue.missing.values : {};
      return Object.fromEntries(
        missing.map(({ district, imputed }) => [district.code, filled[district.code] ?? imputed])
      );
    };

    const renderMissing = (): VNodeChild => {
      const { missing, modelValue: params } = props;
      if (missing.length === 0) {
        return field('missing', <p class={styles.note}>数据核查发现缺失后可调整</p>);
      }
      const values = manualValues();
      return field(
        'missing',
        <>
          <ElRadioGroup
            size="small"
            modelValue={params.missing.kind}
            aria-label={PARAM_LABELS.missing}
            onUpdate:modelValue={value => {
              const kind = pick(MISSING_KINDS, value);
              if (kind) {
                update({ missing: kind === 'manual' ? { kind, values } : { kind } });
              }
            }}
          >
            {MISSING_KINDS.map(kind => (
              <ElRadioButton key={kind} value={kind}>
                {MISSING_LABELS[kind]}
              </ElRadioButton>
            ))}
          </ElRadioGroup>
          {params.missing.kind === 'manual' && (
            <div class={styles.targets}>
              {missing.map(({ district }) => [
                <span key={`${district.code}-label`}>{district.name}（万人）</span>,
                <ElInputNumber
                  key={district.code}
                  class={styles.number}
                  size="small"
                  controlsPosition="right"
                  modelValue={values[district.code]}
                  min={0.1}
                  step={0.1}
                  precision={1}
                  aria-label={`${district.name}的人口（万人）`}
                  onUpdate:modelValue={value => {
                    if (typeof value === 'number' && Number.isFinite(value)) {
                      update({ missing: { kind: 'manual', values: { ...values, [district.code]: value } } });
                    }
                  }}
                />
              ])}
            </div>
          )}
          <p class={styles.note}>剔除的区县不参与汇总；手动填写核实后的人口</p>
        </>
      );
    };

    const render = (key: ParamKey): VNodeChild => {
      const { conditions, modelValue: params } = props;
      switch (key) {
        case 'popCaliber':
          return field(
            key,
            <>
              <ElRadioGroup
                size="small"
                modelValue={params.popCaliber}
                aria-label={PARAM_LABELS.popCaliber}
                onUpdate:modelValue={value => {
                  const popCaliber = pick(CALIBERS, value);
                  if (popCaliber) {
                    update({ popCaliber });
                  }
                }}
              >
                {CALIBERS.map(caliber => (
                  <ElRadioButton key={caliber} value={caliber}>
                    {CALIBER_LABELS[caliber]}
                  </ElRadioButton>
                ))}
              </ElRadioGroup>
              <p class={styles.note}>户籍人口在苏南城市明显少于常住人口，人均值会变高</p>
            </>
          );
        case 'walkSpeed':
          return field(
            key,
            <>
              <ElSlider
                modelValue={params.walkSpeed}
                min={WALK_SPEED_RANGE.min}
                max={WALK_SPEED_RANGE.max}
                step={WALK_SPEED_RANGE.step}
                showTooltip={false}
                ariaLabel={PARAM_LABELS.walkSpeed}
                onUpdate:modelValue={value => {
                  if (typeof value === 'number') {
                    update({ walkSpeed: value });
                  }
                }}
              />
              <p class={styles.note}>{radiiText(conditions, params.walkSpeed)}</p>
            </>,
            `${params.walkSpeed} 米/分钟`
          );
        case 'facilityScope':
          return field(
            key,
            <ElRadioGroup
              size="small"
              modelValue={params.facilityScope}
              aria-label={PARAM_LABELS.facilityScope}
              onUpdate:modelValue={value => {
                const facilityScope = pick(SCOPES, value);
                if (facilityScope) {
                  update({ facilityScope });
                }
              }}
            >
              {SCOPES.map(scope => (
                <ElRadioButton key={scope} value={scope}>
                  {SCOPE_LABELS[scope]}
                </ElRadioButton>
              ))}
            </ElRadioGroup>
          );
        case 'newFacilities':
          return field(
            key,
            <>
              <ElSlider
                modelValue={params.newFacilities}
                min={NEW_FACILITIES_RANGE.min}
                max={NEW_FACILITIES_RANGE.max}
                step={NEW_FACILITIES_RANGE.step}
                showTooltip={false}
                ariaLabel={PARAM_LABELS.newFacilities}
                onUpdate:modelValue={value => {
                  if (typeof value === 'number') {
                    update({ newFacilities: value });
                  }
                }}
              />
              <p class={styles.note}>情景假设：在现有设施附近按比例新增，地图上以紫色显示</p>
              <div class={styles.subLabel}>
                作用于<span class={styles.note}>点选切换，编排图上的连线同步</span>
              </div>
              <div class={styles.tags}>
                {conditions.indicatorIds.map(id => (
                  <ElCheckTag key={id} checked={inScenario(params, id)} onChange={() => toggleScope(id)}>
                    {simulationIndicator(id).short}
                  </ElCheckTag>
                ))}
              </div>
            </>,
            `${params.newFacilities}%`
          );
        case 'targets':
          return field(
            key,
            <>
              <p class={styles.note}>只影响达标判断，不重算数值</p>
              <div class={styles.targets}>
                {conditions.indicatorIds.map(id => {
                  const indicator = simulationIndicator(id);
                  const label = `${indicator.short}（${indicator.unit}）`;
                  return [
                    <span key={`${id}-label`}>{label}</span>,
                    <ElInputNumber
                      key={id}
                      class={styles.number}
                      size="small"
                      controlsPosition="right"
                      modelValue={params.targets[id]}
                      min={indicator.unit === '%' ? 1 : 0.1}
                      max={indicator.unit === '%' ? 100 : undefined}
                      step={indicator.unit === '%' ? 1 : 0.1}
                      aria-label={`${label}的演示目标值`}
                      onUpdate:modelValue={value => {
                        if (typeof value === 'number' && Number.isFinite(value)) {
                          update({ targets: { ...params.targets, [id]: value } });
                        }
                      }}
                    />
                  ];
                })}
              </div>
            </>
          );
        case 'missing':
          break;
      }
      return renderMissing();
    };

    return () => <div class={styles.root}>{props.keys.map(render)}</div>;
  }
});
