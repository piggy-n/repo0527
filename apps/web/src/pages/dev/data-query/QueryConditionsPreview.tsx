import { ArrowDown, ArrowUp, Close, Plus, RefreshLeft, Search, Upload } from '@element-plus/icons-vue';
import { MxPanel, MxTitle } from '@yzt/ui';
import { ElButton, ElForm, ElFormItem, ElInput, ElOption, ElSegmented, ElSelect } from 'element-plus';
import { defineComponent, type PropType, ref, watch } from 'vue';
import { MODES, type QueryMode } from './preview-data';
import type { QueryPreviewModel } from './useQueryPreview';
import styles from './preview.module.scss';

/** 四类查询共用标题、切换栏与固定操作区，高级查询不再另外打开面板 */
export const QueryConditionsPreview = defineComponent({
  name: 'QueryConditionsPreview',
  props: {
    model: { type: Object as PropType<QueryPreviewModel>, required: true },
    compact: Boolean
  },
  setup(props) {
    const adding = ref(false);
    const file = ref<HTMLInputElement>();
    const fileName = ref('');

    watch(() => props.model.layerCode.value, () => {
      adding.value = false;
      fileName.value = '';
    });

    function renderAttribute() {
      const model = props.model;
      return (
        <>
          {model.conditionCodes.value.length > 1 && (
            <ElFormItem label="条件关系">
              <ElSegmented
                options={[{ label: '全部满足', value: 'AND' }, { label: '任一满足', value: 'OR' }]}
                modelValue={model.relation.value}
                onUpdate:modelValue={(value: string) => (model.relation.value = value)}
              />
            </ElFormItem>
          )}
          {model.conditionCodes.value.map(code => {
            const field = model.layer.value!.fields.find(item => item.code === code)!;
            return (
              <ElFormItem label={field.label} key={code}>
                <div class={styles.condition}>
                  {field.values ? (
                    <ElSelect
                      aria-label={field.label}
                      clearable
                      placeholder="不限"
                      modelValue={model.values[code] ?? ''}
                      onUpdate:modelValue={(value: string) => (model.values[code] = value)}
                    >
                      {field.values.map(value => <ElOption key={value} label={value} value={value} />)}
                    </ElSelect>
                  ) : (
                    <ElInput
                      aria-label={field.label}
                      placeholder={`请输入${field.label}`}
                      modelValue={model.values[code] ?? ''}
                      onUpdate:modelValue={value => (model.values[code] = value)}
                    />
                  )}
                  <ElButton
                    link
                    icon={Close}
                    aria-label={`移除${field.label}条件`}
                    onClick={() => {
                      model.conditionCodes.value = model.conditionCodes.value.filter(item => item !== code);
                      delete model.values[code];
                    }}
                  />
                </div>
              </ElFormItem>
            );
          })}
          {adding.value ? (
            <ElSelect
              aria-label="添加条件字段"
              placeholder="选择要添加的字段"
              onUpdate:modelValue={(value: string) => {
                model.conditionCodes.value = [...model.conditionCodes.value, value];
                adding.value = false;
              }}
            >
              {model.layer.value!.fields.filter(field => !model.conditionCodes.value.includes(field.code))
                .map(field => <ElOption label={field.label} value={field.code} key={field.code} />)}
            </ElSelect>
          ) : (
            <ElButton
              link
              type="primary"
              icon={Plus}
              disabled={model.conditionCodes.value.length === model.layer.value!.fields.length}
              onClick={() => (adding.value = true)}
            >添加查询条件</ElButton>
          )}
          <div class={styles.expression}>
            <ElButton link onClick={() => (model.showExpression.value = !model.showExpression.value)}>
              {model.showExpression.value ? '收起查询表达式' : '查看查询表达式'}
            </ElButton>
            {model.showExpression.value && <pre>{model.expression.value || '未设置附加条件'}</pre>}
          </div>
        </>
      );
    }

    function renderAdvanced() {
      const model = props.model;
      return (
        <>
          <ElFormItem label="字段">
            <div class={styles.condition}>
              <ElSelect
                aria-label="高级查询字段"
                modelValue={model.fieldCode.value}
                onUpdate:modelValue={(value: string) => (model.fieldCode.value = value)}
              >
                {model.layer.value!.fields.map(field => (
                  <ElOption label={`${field.label} · ${field.code}`} value={field.code} key={field.code} />
                ))}
              </ElSelect>
              <ElButton onClick={() => model.appendToken(model.fieldCode.value)}>插入字段</ElButton>
            </div>
          </ElFormItem>
          <div class={styles.tokens} aria-label="运算符">
            {['=', '<>', '>', '<', '>=', '<=', 'LIKE', 'AND', 'OR', 'NOT', '(', ')'].map(operator => (
              <ElButton size="small" key={operator} onClick={() => model.appendToken(operator)}>{operator}</ElButton>
            ))}
          </div>
          <MxTitle level="section">可选值</MxTitle>
          <div class={styles.tokens}>
            {model.selectedField.value?.values?.map(value => (
              <ElButton size="small" key={value} onClick={() => model.appendToken(`'${value}'`)}>{value}</ElButton>
            )) ?? <span class={styles.hint}>此字段没有预置枚举值，可在条件中直接输入</span>}
          </div>
          <ElFormItem label="查询条件">
            <ElInput
              aria-label="高级查询条件"
              type="textarea"
              rows={4}
              resize="vertical"
              placeholder="例如 TYPE = '小学'"
              modelValue={model.advanced.value}
              onUpdate:modelValue={value => (model.advanced.value = value)}
            />
          </ElFormItem>
          <p class={styles.hint}>只填写筛选条件；图层与行政区划使用上方选择。</p>
        </>
      );
    }

    function renderSpatial() {
      const model = props.model;
      return (
        <>
          <ElFormItem label="查询范围">
            <ElSegmented
              block
              class={styles.spatialSwitch}
              options={[{ label: '框选', value: 'rectangle' }, { label: '多边形', value: 'polygon' },
                { label: 'SHP 导入', value: 'shp' }]}
              modelValue={model.spatialMethod.value}
              onUpdate:modelValue={(value: string) => (model.spatialMethod.value = value)}
            />
          </ElFormItem>
          {model.spatialMethod.value === 'shp' ? (
            <>
              <input
                hidden
                ref={file}
                type="file"
                accept=".shp,.zip"
                onChange={() => {
                  const selected = file.value?.files?.[0];
                  fileName.value = selected?.name ?? '';
                  model.rangeReady.value = Boolean(selected);
                }}
              />
              <ElButton icon={Upload} onClick={() => file.value?.click()}>选择 SHP / ZIP 文件</ElButton>
              <p class={styles.hint}>{fileName.value || '预览仅显示文件名，不上传文件。'}</p>
            </>
          ) : (
            <div class={styles.rangePreview}>
              <MxTitle level="section">{model.rangeReady.value ? '范围已选定' : '在地图上选择范围'}</MxTitle>
              <p class={styles.hint}>此处演示范围完成后的状态；实际绘制在方案确认后接入。</p>
              <ElButton type="primary" plain onClick={() => (model.rangeReady.value = !model.rangeReady.value)}>
                {model.rangeReady.value ? '清除范围' : '载入示例范围'}
              </ElButton>
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
                onClick={() => (model.formOpen.value = !model.formOpen.value)}
              />
            ),
            subheader: model.formOpen.value ? () => (
              <div class={styles.modeSwitch}>
                <ElSegmented
                  block
                  size="small"
                  aria-label="查询方式"
                  options={[...MODES]}
                  modelValue={model.mode.value}
                  onUpdate:modelValue={(value: QueryMode) => (model.mode.value = value)}
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
                      onUpdate:modelValue={(value: string) => (model.layerCode.value = value)}
                    >
                      {model.layers.value.map(layer => (
                        <ElOption key={layer.code} label={layer.label} value={layer.code} />
                      ))}
                    </ElSelect>
                  </ElFormItem>
                )}
                {['attribute', 'advanced'].includes(model.mode.value) && (
                  <ElFormItem label="行政区划">
                    <ElSelect
                      aria-label="行政区划"
                      modelValue={model.region.value}
                      onUpdate:modelValue={(value: string) => (model.region.value = value)}
                    >
                      {['江苏省', '南京市', '苏州市', '无锡市'].map(name => <ElOption key={name} label={name} value={name} />)}
                    </ElSelect>
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
                        rows={5}
                        resize="none"
                        placeholder="描述希望查询的图层、区域和条件"
                        modelValue={model.natural.value}
                        onUpdate:modelValue={value => (model.natural.value = value)}
                      />
                    </ElFormItem>
                    <MxTitle level="section">试试这样问</MxTitle>
                    <button
                      type="button"
                      class={styles.example}
                      onClick={() => (model.natural.value = model.example.value)}
                    >
                      {model.example.value}
                    </button>
                    <p class={styles.hint}>旧版仅支持示例匹配，真实自然语言解析服务待接入。</p>
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
                  onClick={() => {
                    model.search();
                    if (props.compact && !model.error.value) {
                      model.formOpen.value = false;
                    }
                  }}
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
