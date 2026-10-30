import { MxTitle } from '@yzt/ui';
import { ElInputNumber, ElRadioButton, ElRadioGroup, ElSlider } from 'element-plus';
import { defineComponent, type PropType, type VNodeChild } from 'vue';
import { simulationIndicator } from '../model/indicators';
import {
  isStandard,
  paramApplies,
  PARAM_LABELS,
  type ParamKey,
  POP_CHANGE_RANGE,
  RECOGNITION_LABELS,
  type Recognition,
  type Rule,
  RULE_LABELS,
  signedPercent,
  type SimulationConditions,
  type SimulationParams
} from '../model/params';
import styles from './ParamFields.module.scss';

const RULES: readonly Rule[] = ['new', 'old'];
const RECOGNITIONS: readonly Recognition[] = ['half', 'intersect'];

// 选项的说明：写清楚取自 Excel 的哪条规则
const RULE_NOTES: Readonly<Record<Rule, string>> = {
  new: '卫生服务站、文化活动站按步行 15 分钟（1000 米），2025 年起采用',
  old: '站点按步行 5 分钟（300 米），服务中心仍为 15 分钟'
};
const RECOGNITION_NOTES: Readonly<Record<Recognition, string>> = {
  half: '住宅图斑一半以上的面积在服务范围内才算覆盖',
  intersect: '与服务范围相交的住宅图斑都算覆盖，同消防救援、派出所的认定'
};

// 单选组的值换回选项；不在选项里的忽略
const pick = <T extends string>(options: readonly T[], value: unknown): T | undefined =>
  options.find(option => option === value);

const scenarioTag = (show: boolean) => show && <span class={styles.scenario}>自定义口径</span>;

/** 参数的编辑项：编排阶段的参数节点只编辑一项，人工干预编辑所选指标用得上的全部；改动交给拥有者，组件不保存 */
export const ParamFields = defineComponent({
  name: 'ParamFields',
  props: {
    keys: { type: Array as PropType<readonly ParamKey[]>, required: true },
    conditions: { type: Object as PropType<SimulationConditions>, required: true },
    modelValue: { type: Object as PropType<SimulationParams>, required: true },
    /** 浮层的标题已经写了参数名：不再显示区块标题，只留一行说明和右侧的取值或情景标记 */
    bare: Boolean
  },
  emits: {
    'update:modelValue': (params: SimulationParams) => typeof params === 'object'
  },
  setup(props, { emit }) {
    const update = (patch: Partial<SimulationParams>) => emit('update:modelValue', { ...props.modelValue, ...patch });

    // 一项参数：区块标题（可带紧跟的灰色说明）、右侧的当前值或情景标记，下面是编辑控件
    const field = (key: ParamKey, content: VNodeChild, extra?: () => VNodeChild, description?: string) => {
      let head: VNodeChild;
      if (!props.bare) {
        head = <MxTitle description={description}>{{ default: () => PARAM_LABELS[key], extra }}</MxTitle>;
      } else if (description !== undefined || extra) {
        head = (
          <div class={styles.head}>
            <span class={styles.description}>{description}</span>
            {extra?.()}
          </div>
        );
      }
      return (
        <div key={key} class={styles.field}>
          {head}
          <div>{content}</div>
        </div>
      );
    };

    const render = (key: ParamKey): VNodeChild => {
      const { conditions, modelValue: params } = props;
      const scenario = () => scenarioTag(!isStandard(key, params));
      // 这项参数作用于哪些已选指标
      const scope = `作用于${conditions.indicatorIds
        .filter(id => paramApplies(key, id))
        .map(id => simulationIndicator(id).short)
        .join('、')}`;
      switch (key) {
        case 'rule':
          return field(
            key,
            <>
              <ElRadioGroup
                size="small"
                modelValue={params.rule}
                aria-label={PARAM_LABELS.rule}
                onUpdate:modelValue={value => {
                  const rule = pick(RULES, value);
                  if (rule) {
                    update({ rule });
                  }
                }}
              >
                {RULES.map(rule => (
                  <ElRadioButton key={rule} value={rule}>
                    {RULE_LABELS[rule]}
                    {rule === 'new' && '（标准）'}
                  </ElRadioButton>
                ))}
              </ElRadioGroup>
              <p class={styles.note}>{RULE_NOTES[params.rule]}</p>
            </>,
            scenario,
            scope
          );
        case 'recognition':
          return field(
            key,
            <>
              <ElRadioGroup
                size="small"
                modelValue={params.recognition}
                aria-label={PARAM_LABELS.recognition}
                onUpdate:modelValue={value => {
                  const recognition = pick(RECOGNITIONS, value);
                  if (recognition) {
                    update({ recognition });
                  }
                }}
              >
                {RECOGNITIONS.map(recognition => (
                  <ElRadioButton key={recognition} value={recognition}>
                    {RECOGNITION_LABELS[recognition]}
                    {recognition === 'half' && '（标准）'}
                  </ElRadioButton>
                ))}
              </ElRadioGroup>
              <p class={styles.note}>{RECOGNITION_NOTES[params.recognition]}</p>
            </>,
            scenario,
            scope
          );
        case 'popChange':
          return field(
            key,
            <>
              <ElSlider
                class={styles.slider}
                size="small"
                modelValue={params.popChange}
                min={POP_CHANGE_RANGE.min}
                max={POP_CHANGE_RANGE.max}
                step={POP_CHANGE_RANGE.step}
                showStops
                showTooltip={false}
                ariaLabel={PARAM_LABELS.popChange}
                onUpdate:modelValue={value => {
                  if (typeof value === 'number') {
                    update({ popChange: value });
                  }
                }}
              />
              <p class={styles.note}>相对七普常住人口，只影响人均类指标</p>
            </>,
            () => [scenario(), <span class={styles.value}>{signedPercent(params.popChange)}</span>],
            scope
          );
        case 'targets':
          break;
      }
      return field(
        key,
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
                aria-label={`${label}的目标值`}
                onUpdate:modelValue={value => {
                  if (typeof value === 'number' && Number.isFinite(value)) {
                    update({ targets: { ...params.targets, [id]: value } });
                  }
                }}
              />
            ];
          })}
        </div>,
        undefined,
        '影响达标判断'
      );
    };

    return () => <div class={styles.root}>{props.keys.map(render)}</div>;
  }
});
