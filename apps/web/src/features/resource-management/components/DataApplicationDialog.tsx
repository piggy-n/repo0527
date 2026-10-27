import { MxTitle } from '@yzt/ui';
import {
  ElButton,
  ElDatePicker,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  ElOption,
  ElSelect,
  type FormInstance,
  type FormItemRule,
  type FormRules
} from 'element-plus';
import { defineComponent, type PropType, ref } from 'vue';
import { APPLY_NAME_MAX_LENGTH, APPLY_PURPOSE_MAX_LENGTH } from '../application-form';
import type { DataApplicationOwner } from '../composables/useDataApplication';
import { DATA_LAYERS, type DataFormat, formatDateTime } from '../data-request';
import styles from './DataApplicationDialog.module.scss';
import { RegionCascader } from './RegionCascader';

// 日期面板按天比较：传进来的是当天零点的 Date，表单里是带时分秒的字符串
const day = (value: Date | string) => (typeof value === 'string' ? value : formatDateTime(value)).slice(0, 10);

/** 资源列表"下载"的数据申请：提交后等待审核，审核通过的数据在申请列表里下载 */
export const DataApplicationDialog = defineComponent({
  name: 'DataApplicationDialog',
  props: {
    owner: { type: Object as PropType<DataApplicationOwner>, required: true }
  },
  setup(props) {
    const owner = props.owner;
    const formRef = ref<FormInstance>();
    // 校验期间不重复提交；提交中的防重复由拥有者负责
    const validating = ref(false);

    // 时间是同一格式的字符串，可以直接比较先后
    const startRule: FormItemRule = {
      validator: (_rule, value: string, callback) => {
        if (value && owner.form.endTime && value > owner.form.endTime) {
          callback(new Error('开始时间不能晚于结束时间'));
          return;
        }
        callback();
      },
      trigger: 'change'
    };
    const endRule: FormItemRule = {
      validator: (_rule, value: string, callback) => {
        if (value && owner.form.startTime && value < owner.form.startTime) {
          callback(new Error('结束时间不能早于开始时间'));
          return;
        }
        callback();
      },
      trigger: 'change'
    };
    const rules: FormRules = {
      applyName: [{ required: true, whitespace: true, message: '请输入数据名称', trigger: 'blur' }],
      layerCode: [{ required: true, message: '请选择数据需求', trigger: 'change' }],
      regionPath: [{ type: 'array', required: true, message: '请选择行政区划', trigger: 'change' }],
      startTime: [{ required: true, message: '请选择开始时间', trigger: 'change' }, startRule],
      endTime: [{ required: true, message: '请选择结束时间', trigger: 'change' }, endRule],
      formats: [{ type: 'array', required: true, message: '请选择数据格式', trigger: 'change' }],
      purpose: [{ required: true, whitespace: true, message: '请输入申请用途', trigger: 'blur' }]
    };

    // 日期面板里不能选的日子：开始不晚于结束的那天，结束不早于开始的那天（同一天可以选）
    const disabledStartDay = (date: Date) => Boolean(owner.form.endTime) && day(date) > day(owner.form.endTime);
    const disabledEndDay = (date: Date) => Boolean(owner.form.startTime) && day(date) < day(owner.form.startTime);

    // 改了一端的时间，另一端的先后提示也要更新
    function validateTimes() {
      formRef.value?.validateField(['startTime', 'endTime']).catch(() => undefined);
    }

    async function submit() {
      if (validating.value || owner.pending.value) {
        return;
      }
      validating.value = true;
      const valid = await formRef.value?.validate().catch(() => false);
      validating.value = false;
      if (!valid) {
        return;
      }
      const result = await owner.submit();
      if (result?.kind === 'success') {
        ElMessage.success('申请已提交，审核通过后可在申请列表下载');
      } else if (result?.kind === 'error') {
        ElMessage.error(result.message);
      }
    }

    function renderForm() {
      const form = owner.form;
      return (
        <ElForm
          ref={formRef}
          class={styles.form}
          model={form}
          rules={rules}
          labelPosition="top"
          disabled={owner.pending.value}
        >
          <ElFormItem label="数据名称" prop="applyName">
            <ElInput
              modelValue={form.applyName}
              onUpdate:modelValue={(value: string) => (form.applyName = value)}
              placeholder="请输入数据名称"
              maxlength={APPLY_NAME_MAX_LENGTH}
            />
          </ElFormItem>
          <ElFormItem label="数据需求（主题图层）" prop="layerCode">
            <ElSelect
              modelValue={form.layerCode}
              onUpdate:modelValue={(value: string) => (form.layerCode = value)}
              placeholder="请选择数据需求"
            >
              {DATA_LAYERS.map(layer => <ElOption key={layer.value} value={layer.value} label={layer.label} />)}
            </ElSelect>
          </ElFormItem>
          <ElFormItem label="行政区划" prop="regionPath">
            <RegionCascader
              modelValue={form.regionPath}
              onUpdate:modelValue={value => (form.regionPath = value)}
              placeholder="请选择行政区划"
            />
          </ElFormItem>
          <div class={styles.timeRow}>
            <ElFormItem label="开始时间" prop="startTime">
              <ElDatePicker
                type="datetime"
                valueFormat="YYYY-MM-DD HH:mm:ss"
                modelValue={form.startTime}
                onUpdate:modelValue={(value: string | null) => {
                  form.startTime = value ?? '';
                  validateTimes();
                }}
                disabledDate={disabledStartDay}
                placeholder="请选择开始时间"
              />
            </ElFormItem>
            <ElFormItem label="结束时间" prop="endTime">
              <ElDatePicker
                type="datetime"
                valueFormat="YYYY-MM-DD HH:mm:ss"
                modelValue={form.endTime}
                onUpdate:modelValue={(value: string | null) => {
                  form.endTime = value ?? '';
                  validateTimes();
                }}
                disabledDate={disabledEndDay}
                placeholder="请选择结束时间"
              />
            </ElFormItem>
          </div>
          <ElFormItem label="数据格式" prop="formats">
            <ElSelect
              modelValue={form.formats}
              onUpdate:modelValue={(value: DataFormat[]) => (form.formats = value)}
              multiple
              placeholder="请选择数据格式"
            >
              {owner.formats.value.map(format => <ElOption key={format} value={format} label={format} />)}
            </ElSelect>
          </ElFormItem>
          <ElFormItem label="申请用途" prop="purpose">
            <ElInput
              modelValue={form.purpose}
              onUpdate:modelValue={(value: string) => (form.purpose = value)}
              placeholder="如：用于年度耕地保护考核台账编制"
              maxlength={APPLY_PURPOSE_MAX_LENGTH}
              showWordLimit
            />
          </ElFormItem>
        </ElForm>
      );
    }

    return () => (
      <ElDialog
        class={['dialog-panel-header', styles.dialog]}
        modelValue={owner.open.value}
        onUpdate:modelValue={(open: boolean) => {
          if (!open) {
            owner.close();
          }
        }}
        // 提交期间点关闭、按 Esc 都不关
        beforeClose={(done: () => void) => {
          if (!owner.pending.value) {
            done();
          }
        }}
        title="数据申请提交"
        alignCenter
        appendToBody
        destroyOnClose
        closeOnClickModal={false}
      >
        {{
          header: () => (
            <MxTitle level="panel" description={owner.target.value?.name}>
              数据申请提交
            </MxTitle>
          ),
          default: renderForm,
          footer: () => (
            <>
              <ElButton disabled={owner.pending.value} onClick={owner.close}>
                取消
              </ElButton>
              <ElButton type="primary" loading={owner.pending.value} onClick={() => void submit()}>
                提交申请
              </ElButton>
            </>
          )
        }}
      </ElDialog>
    );
  }
});
