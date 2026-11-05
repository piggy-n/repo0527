import { ArrowDown, ArrowUp, Close, Plus } from '@element-plus/icons-vue';
import { MxTitle } from '@yzt/ui';
import {
  ElButton,
  ElCascader,
  ElDatePicker,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElInput,
  ElOption,
  ElRadioButton,
  ElRadioGroup,
  ElSelect
} from 'element-plus';
import { defineComponent, type PropType, ref } from 'vue';
import { districtsOf, JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import type { Condition } from '../conditions';
import type { AttributeForm, ConditionPatch } from '../composables/useAttributeForm';
import type { InputOperator } from '../layer-fields';
import { PROVINCE_CODE } from '../result-layers';
import type { QueryTopic } from '../topics';
import styles from './AttributeQueryForm.module.scss';
import { LayerField } from './LayerField';
import formStyles from './QueryForm.module.scss';

// 行政区划从全省开始，可以停在省、市或区县（同旧页面）
const REGION_OPTIONS = [
  {
    value: PROVINCE_CODE,
    label: '江苏省',
    children: JIANGSU_CITIES.map(city => ({
      value: city.code,
      label: city.name,
      children: districtsOf(city.code).map(district => ({ value: district.code, label: district.name }))
    }))
  }
];

const REGION_PROPS = { checkStrictly: true, expandTrigger: 'hover', emitPath: false } as const;

const OPERATOR_LABELS: Readonly<Record<InputOperator, string>> = {
  LIKE: '包含',
  NOT: '不包含',
  '>': '>',
  '<': '<',
  '=': '=',
  '>=': '>=',
  '<=': '<='
};

/** 显示或隐藏 SQL 语句，属性查询和自然语言查询共用；整行的描边按钮（参考旧页面） */
export const SqlPreview = defineComponent({
  name: 'SqlPreview',
  props: {
    sql: { type: String, required: true }
  },
  setup(props) {
    const visible = ref(false);
    return () => (
      <div class={formStyles.sql}>
        <ElButton
          type="primary"
          plain
          class={formStyles.wide}
          icon={visible.value ? ArrowUp : ArrowDown}
          onClick={() => (visible.value = !visible.value)}
        >
          {visible.value ? '隐藏 SQL 语句' : '显示 SQL 语句'}
        </ElButton>
        {visible.value && <ElInput type="textarea" modelValue={props.sql} rows={3} readonly />}
      </div>
    );
  }
});

/** 属性查询：图层、行政区划和条件；条件按字段类型给出下拉、输入或日期 */
export const AttributeQueryForm = defineComponent({
  name: 'AttributeQueryForm',
  props: {
    topic: { type: Object as PropType<QueryTopic>, required: true },
    form: { type: Object as PropType<AttributeForm>, required: true },
    hasResult: { type: Boolean, default: false }
  },
  setup(props) {
    const update = (key: number, patch: ConditionPatch) => props.form.updateCondition(key, patch);

    const renderControl = (condition: Condition) => {
      const { field, key, value } = condition;
      const text = typeof value === 'string' ? value : '';
      if (field.type === 'multiple') {
        return (
          <ElSelect
            class={formStyles.control}
            modelValue={typeof value === 'string' ? [] : [...value]}
            multiple
            collapseTags
            collapseTagsTooltip
            filterable
            clearable
            placeholder={`请选择${field.label}`}
            onUpdate:modelValue={(next: string[]) => update(key, { value: next })}
          >
            {field.options.map(option => (
              <ElOption key={option.code} value={option.code} label={option.name} />
            ))}
          </ElSelect>
        );
      }
      if (field.type === 'single') {
        return (
          <ElSelect
            class={formStyles.control}
            modelValue={text}
            filterable
            clearable
            placeholder={`请选择${field.label}`}
            onUpdate:modelValue={(next: string | undefined) => update(key, { value: next ?? '' })}
          >
            {field.options.map(option => (
              <ElOption key={option.code} value={option.code} label={option.name} />
            ))}
          </ElSelect>
        );
      }
      if (field.type === 'input') {
        return [
          <ElSelect
            key="operator"
            class={styles.operator}
            modelValue={condition.operator ?? ''}
            onUpdate:modelValue={(operator: InputOperator) => update(key, { operator })}
          >
            {field.operators.map(operator => (
              <ElOption key={operator} value={operator} label={OPERATOR_LABELS[operator]} />
            ))}
          </ElSelect>,
          <ElInput
            key="value"
            class={formStyles.control}
            modelValue={text}
            type={field.operators.includes('>') ? 'number' : 'text'}
            placeholder="请输入"
            onUpdate:modelValue={(next: string) => update(key, { value: next })}
          />
        ];
      }
      return (
        <ElDatePicker
          class={[formStyles.control, styles.date]}
          modelValue={text === '' ? undefined : text}
          type="date"
          valueFormat="YYYY-MM-DD"
          placeholder="请选择日期"
          onUpdate:modelValue={(next: string | null) => update(key, { value: next ?? '' })}
        />
      );
    };

    // 条件列表下面整行的"添加查询条件"（参考旧页面），点开是还没加的字段
    const renderAdd = () => {
      const fields = props.form.remainingFields.value;
      const disabled = props.form.layer.value === null || fields.length === 0;
      return (
        <ElDropdown
          class={formStyles.wide}
          trigger="click"
          placement="bottom"
          disabled={disabled}
          maxHeight={280}
          onCommand={(field: string) => props.form.addCondition(field)}
        >
          {{
            default: () => (
              <ElButton type="primary" plain class={formStyles.wide} icon={Plus} disabled={disabled}>
                添加查询条件
              </ElButton>
            ),
            dropdown: () => (
              <ElDropdownMenu>
                {fields.map(field => (
                  <ElDropdownItem key={field.field} command={field.field}>
                    {field.label}
                  </ElDropdownItem>
                ))}
              </ElDropdownMenu>
            )
          }}
        </ElDropdown>
      );
    };

    const renderConditions = () => {
      const conditions = props.form.conditions.value;
      if (conditions.length === 0) {
        return (
          <p class={styles.empty}>
            {props.form.layer.value ? '没有条件时查询所选行政区划内的全部数据' : '请先选择图层'}
          </p>
        );
      }
      return conditions.flatMap((condition, index) => [
        <div key={condition.key} class={styles.condition} data-condition={condition.field.field}>
          <div class={styles.conditionHead}>
            <span class={styles.conditionLabel}>{condition.field.label}</span>
            <ElButton
              link
              icon={Close}
              aria-label={`删除条件：${condition.field.label}`}
              onClick={() => props.form.removeCondition(condition.key)}
            />
          </div>
          <div class={styles.controls}>{renderControl(condition)}</div>
        </div>,
        // 连接写在前一个条件上，连接它和下一个（同旧页面）；最后一个没有
        index < conditions.length - 1 && (
          <div key={`link-${condition.key}`} class={styles.connector}>
            <ElRadioGroup
              size="small"
              modelValue={condition.link}
              onUpdate:modelValue={(link: string | number | boolean | undefined) =>
                update(condition.key, { link: link === 'OR' ? 'OR' : 'AND' })
              }
            >
              <ElRadioButton value="AND">AND</ElRadioButton>
              <ElRadioButton value="OR">OR</ElRadioButton>
            </ElRadioGroup>
          </div>
        )
      ]);
    };

    return () => {
      const { form } = props;
      const layer = form.layer.value;
      return (
        <div class={formStyles.form}>
          <section class={formStyles.section}>
            <MxTitle>查询范围</MxTitle>
            <LayerField
              topic={props.topic}
              layer={layer}
              hasResult={props.hasResult}
              onChange={(table: string) => form.setLayer(table)}
            />
            <div class={formStyles.field}>
              <span class={formStyles.label}>行政区划</span>
              <ElCascader
                class={formStyles.control}
                modelValue={form.region.value}
                options={REGION_OPTIONS}
                props={REGION_PROPS}
                clearable
                placeholder="请选择行政区划"
                onUpdate:modelValue={value => form.setRegion(typeof value === 'string' ? value : null)}
              />
            </div>
          </section>
          <section class={formStyles.section}>
            <MxTitle>筛选条件</MxTitle>
            <div class={styles.conditions}>{renderConditions()}</div>
            {renderAdd()}
            {layer && <SqlPreview sql={form.sql.value} />}
          </section>
        </div>
      );
    };
  }
});
