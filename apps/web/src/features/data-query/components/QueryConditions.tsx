import { ArrowDown, ArrowUp, Close, Plus, RefreshLeft, Search, Upload } from '@element-plus/icons-vue';
import { MxPanel, MxTitle } from '@yzt/ui';
import {
  ElButton, ElDatePicker, ElForm, ElFormItem, ElInput, ElOption, ElSegmented, ElSelect, ElTreeSelect
} from 'element-plus';
import { defineComponent, type PropType, ref, watch } from 'vue';
import { districtsOf, JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { QUERY_MODES } from '../config';
import { quoteValue } from '../conditions';
import type { DataQuery } from '../composables/useDataQuery';
import type { QueryDrawing } from '../composables/useQueryDrawing';
import type { FieldValue, QueryCondition, QueryField, QueryMode, SpatialMethod } from '../types';
import styles from './query.module.scss';

// 目录只使用项目本地区划，不另发天地图请求
const REGION_OPTIONS = [{
  value: '320000',
  label: '江苏省',
  children: JIANGSU_CITIES.map(city => ({
    value: city.code,
    label: city.name,
    children: districtsOf(city.code).map(district => ({ value: district.code, label: district.name }))
  }))
}];
const OPERATORS = ['=', '<>', '>', '<', '>=', '<=', 'LIKE', 'AND', 'OR', 'NOT', '(', ')'];

/** 四种查询共享面板与操作区，内容长时只滚动表单 */
export const QueryConditions = defineComponent({
  name: 'QueryConditions',
  props: {
    model: { type: Object as PropType<DataQuery>, required: true },
    drawing: { type: Object as PropType<QueryDrawing>, required: true },
    compact: Boolean
  },
  setup(props) {
    const adding = ref(false);
    const fieldCode = ref('');
    const expressionShown = ref(false);
    const fileInput = ref<HTMLInputElement>();
    watch(() => props.model.layerCode.value, () => {
      fieldCode.value = props.model.layer.value?.fields[0]?.code ?? '';
      adding.value = false;
    }, { immediate: true });

    function submit() {
      if (props.model.search() && props.compact) {
        props.model.formOpen.value = false;
      }
    }

    function renderValue(field: QueryField, condition: QueryCondition) {
      if (field.options) {
        return (
          <ElSelect
            aria-label={field.label}
            filterable
            clearable
            multiple={field.type === 'multipleSelect'}
            collapseTags
            placeholder="不限"
            modelValue={condition.value}
            onUpdate:modelValue={(value: FieldValue | undefined) => (condition.value = value ?? '')}
          >
            {field.options.map(option => (
              <ElOption key={option.code} value={option.code} label={option.name}>
                <span title={option.name}>{option.name}</span>
              </ElOption>
            ))}
          </ElSelect>
        );
      }
      if (field.type === 'datetime') {
        return (
          <ElDatePicker
            aria-label={field.label}
            type="date"
            valueFormat="YYYY-MM-DD"
            modelValue={condition.value}
            onUpdate:modelValue={(value: string | null) => (condition.value = value ?? '')}
          />
        );
      }
      return (
        <ElInput
          aria-label={field.label}
          placeholder={`请输入${field.label}`}
          modelValue={String(condition.value)}
          onUpdate:modelValue={value => (condition.value = value)}
          onKeydown={event => {
            if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
      );
    }

    function renderAttribute() {
      const model = props.model;
      const fields = model.layer.value!.fields;
      return (
        <>
          {model.conditions.value.length > 1 && (
            <ElFormItem label="条件关系">
              <ElSegmented
                options={[{ label: '全部满足', value: 'AND' }, { label: '任一满足', value: 'OR' }]}
                modelValue={model.relation.value}
                onUpdate:modelValue={(value: 'AND' | 'OR') => (model.relation.value = value)}
              />
            </ElFormItem>
          )}
          {model.conditions.value.map(condition => {
            const field = fields.find(item => item.code === condition.code)!;
            return (
              <ElFormItem key={condition.code} label={field.label}>
                <div class={styles.condition}>
                  {field.operators && (
                    <ElSelect
                      class={styles.operator}
                      aria-label={`${field.label}比较方式`}
                      modelValue={condition.operator}
                      onUpdate:modelValue={(value: string) => (condition.operator = value)}
                    >
                      {field.operators.map(operator => (
                        <ElOption
                          key={operator}
                          value={operator}
                          label={operator === 'LIKE' ? '包含' : operator === 'NOT' ? '不包含' : operator}
                        />
                      ))}
                    </ElSelect>
                  )}
                  {renderValue(field, condition)}
                  <ElButton
                    link
                    icon={Close}
                    aria-label={`移除${field.label}条件`}
                    onClick={() => {
                      model.conditions.value = model.conditions.value.filter(item => item.code !== condition.code);
                    }}
                  />
                </div>
              </ElFormItem>
            );
          })}
          {adding.value ? (
            <ElSelect
              aria-label="添加条件字段"
              placeholder="选择查询字段"
              filterable
              onUpdate:modelValue={(code: string) => {
                model.addCondition(code);
                adding.value = false;
              }}
            >
              {fields.filter(field => !model.conditions.value.some(item => item.code === field.code)).map(field => (
                <ElOption key={field.code} value={field.code} label={field.label}>
                  <span title={field.label}>{field.label}</span>
                </ElOption>
              ))}
            </ElSelect>
          ) : (
            <ElButton
              link
              type="primary"
              icon={Plus}
              disabled={model.conditions.value.length === fields.length}
              onClick={() => (adding.value = true)}
            >添加查询条件</ElButton>
          )}
          <div class={styles.expression}>
            <ElButton link onClick={() => (expressionShown.value = !expressionShown.value)}>
              {expressionShown.value ? '收起查询表达式' : '查看查询表达式'}
            </ElButton>
            {expressionShown.value && <pre>{model.expression.value || '未设置附加条件'}</pre>}
          </div>
        </>
      );
    }

    function renderAdvanced() {
      const model = props.model;
      const fields = model.layer.value!.fields;
      const selected = fields.find(field => field.code === fieldCode.value);
      const append = (text: string) => (model.advanced.value += `${model.advanced.value ? ' ' : ''}${text}`);
      return (
        <>
          <ElFormItem label="字段">
            <div class={styles.condition}>
              <ElSelect
                aria-label="高级查询字段"
                filterable
                modelValue={fieldCode.value}
                onUpdate:modelValue={(value: string) => (fieldCode.value = value)}
              >
                {fields.map(field => (
                  <ElOption key={field.code} value={field.code} label={`${field.label} · ${field.code}`} />
                ))}
              </ElSelect>
              <ElButton onClick={() => append(fieldCode.value)}>插入字段</ElButton>
            </div>
          </ElFormItem>
          <div class={styles.operators} aria-label="运算符">
            {OPERATORS.map(operator => (
              <ElButton key={operator} size="small" onClick={() => append(operator)}>{operator}</ElButton>
            ))}
          </div>
          {selected?.options && (
            <ElFormItem label="可选值">
              <ElSelect
                aria-label="插入字段值"
                filterable
                placeholder="选择并插入值"
                modelValue=""
                onUpdate:modelValue={(value: string) => append(quoteValue(value))}
              >
                {selected.options.map(option => (
                  <ElOption key={option.code} value={option.code} label={`${option.code} · ${option.name}`} />
                ))}
              </ElSelect>
            </ElFormItem>
          )}
          <ElFormItem label="查询条件">
            <ElInput
              aria-label="高级查询条件"
              type="textarea"
              rows={4}
              resize="vertical"
              placeholder="填写字段、运算符和筛选值"
              modelValue={model.advanced.value}
              onUpdate:modelValue={value => (model.advanced.value = value)}
            />
          </ElFormItem>
          <p class={styles.hint}>只填写筛选条件，图层与行政区划使用上方选择。</p>
        </>
      );
    }

    function renderSpatial() {
      const model = props.model;
      const drawing = props.drawing;
      return (
        <>
          <ElFormItem label="查询范围">
            <ElSegmented
              block
              class={styles.fullWidth}
              options={[
                { label: '框选', value: 'rectangle' },
                { label: '多边形', value: 'polygon' },
                { label: 'SHP 导入', value: 'shp' }
              ]}
              modelValue={model.method.value}
              onUpdate:modelValue={(value: SpatialMethod) => (model.method.value = value)}
            />
          </ElFormItem>
          {model.method.value === 'shp' ? (
            <>
              <input
                hidden
                ref={fileInput}
                type="file"
                accept=".shp,.zip"
                onChange={() => {
                  model.file.value = fileInput.value?.files?.[0] ?? null;
                  if (fileInput.value) {
                    fileInput.value.value = '';
                  }
                }}
              />
              <ElButton icon={Upload} onClick={() => fileInput.value?.click()}>选择 SHP / ZIP 文件</ElButton>
              <p class={styles.hint}>{model.file.value?.name ?? '查询时上传所选范围文件'}</p>
            </>
          ) : (
            <div class={styles.range}>
              <MxTitle level="section">{drawing.geometry.value ? '范围已选定' : '在地图上选择范围'}</MxTitle>
              <p class={styles.hint}>
                {model.method.value === 'rectangle' ? '按住左键拖动框选，Esc 取消' : '逐点单击绘制，双击或回车完成，退格撤销'}
              </p>
              <ElButton
                type="primary"
                plain
                onClick={() => {
                  if (drawing.active.value) {
                    drawing.stop();
                  } else if (model.method.value !== 'shp') {
                    drawing.start(model.method.value);
                    if (props.compact) {
                      model.formOpen.value = false;
                    }
                  }
                }}
              >{drawing.active.value ? '取消绘制' : drawing.geometry.value ? '重新绘制' : '开始绘制'}</ElButton>
              {drawing.geometry.value && <ElButton link onClick={drawing.clear}>清除范围</ElButton>}
              {drawing.error.value && <p role="alert" class={styles.error}>{drawing.error.value}</p>}
            </div>
          )}
        </>
      );
    }

    return () => {
      const model = props.model;
      return (
        <MxPanel title="数据查询" class={styles.panel} headerTone="muted" floating flush={!model.formOpen.value}>
          {{
            actions: () => (
              <ElButton
                link
                icon={props.compact ? Close : model.formOpen.value ? ArrowUp : ArrowDown}
                aria-label={model.formOpen.value ? '收起查询条件' : '展开查询条件'}
                onClick={() => {
                  props.drawing.stop();
                  model.formOpen.value = !model.formOpen.value;
                }}
              />
            ),
            subheader: model.formOpen.value ? () => (
              <div class={styles.modeSwitch}>
                <ElSegmented
                  block
                  size="small"
                  aria-label="查询方式"
                  options={QUERY_MODES}
                  modelValue={model.mode.value}
                  onUpdate:modelValue={(mode: QueryMode) => (model.mode.value = mode)}
                />
              </div>
            ) : undefined,
            default: () => model.formOpen.value && (
              <ElForm labelPosition="top" class={styles.form}>
                {model.mode.value !== 'natural' && (
                  <ElFormItem label="查询图层">
                    <ElSelect
                      aria-label="查询图层"
                      modelValue={model.layerCode.value}
                      onUpdate:modelValue={(code: string) => (model.layerCode.value = code)}
                    >
                      {model.layers.value.map(layer => (
                        <ElOption key={layer.code} label={layer.label} value={layer.code} />
                      ))}
                    </ElSelect>
                  </ElFormItem>
                )}
                {['attribute', 'advanced'].includes(model.mode.value) && (
                  <ElFormItem label="行政区划">
                    <ElTreeSelect
                      aria-label="行政区划"
                      checkStrictly
                      filterable
                      data={REGION_OPTIONS}
                      {...{
                        modelValue: model.region.value,
                        // TreeSelect 的声明未导出透传给 Select 的更新事件，回调类型在此明确
                        'onUpdate:modelValue': (code: string) => (model.region.value = code)
                      }}
                    />
                  </ElFormItem>
                )}
                {model.mode.value === 'attribute' && renderAttribute()}
                {model.mode.value === 'advanced' && renderAdvanced()}
                {model.mode.value === 'spatial' && renderSpatial()}
                {model.mode.value === 'natural' && (
                  <>
                    <ElFormItem label="查询描述">
                      <ElInput
                        aria-label="查询描述"
                        type="textarea"
                        rows={4}
                        resize="none"
                        modelValue={model.natural.value}
                        onUpdate:modelValue={value => (model.natural.value = value)}
                      />
                    </ElFormItem>
                    <MxTitle level="section">试试这样问</MxTitle>
                    {model.examples.value.map(example => (
                      <button
                        type="button"
                        class={styles.example}
                        key={example.text}
                        onClick={() => (model.natural.value = example.text)}
                      >{example.text}</button>
                    ))}
                    <p class={styles.hint}>当前支持以上示例，其他条件请使用属性或高级查询。</p>
                  </>
                )}
                {model.error.value && <p role="alert" class={styles.error}>{model.error.value}</p>}
              </ElForm>
            ),
            footer: model.formOpen.value ? () => (
              <div class={styles.formActions}>
                <ElButton
                  type="primary"
                  icon={Search}
                  loading={model.loading.value}
                  disabled={model.busy.value}
                  onClick={submit}
                >查询</ElButton>
                <ElButton icon={RefreshLeft} onClick={model.reset}>重置</ElButton>
              </div>
            ) : undefined
          }}
        </MxPanel>
      );
    };
  }
});
