import { Search } from '@element-plus/icons-vue';
import { MxTitle } from '@yzt/ui';
import {
  ElButton,
  ElCheckbox,
  ElCheckboxGroup,
  ElDatePicker,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  ElStep,
  ElSteps,
  ElTag,
  type FormInstance,
  type FormRules
} from 'element-plus';
import { defineComponent, type PropType, ref, watch } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import type { DataExtractionOwner, ExtractionStep } from '../composables/useDataExtraction';
import { DATA_FORMATS } from '@/shared/data-request/catalog';
import { HOT_KEYWORDS, PURPOSE_MAX_LENGTH } from '../extraction/extraction-form';
import styles from './DataExtractionDialog.module.scss';
import { KnowledgeGraphChart } from './KnowledgeGraphChart';
import { RegionCascader } from './RegionCascader';
import { RelationGraph } from './RelationGraph';
import { RelationNodeDetail } from './RelationNodeDetail';

// 完成页时三步都已完成
const STEP_INDEX: Record<ExtractionStep, number> = { search: 0, graph: 1, done: 3 };

// 数据名称和数据需求选了节点自动填写，可以改，不能空着
const RULES: FormRules = {
  dataName: [{ required: true, whitespace: true, message: '请选择节点或填写数据名称', trigger: 'blur' }],
  requirement: [{ required: true, whitespace: true, message: '请选择节点或填写数据需求', trigger: 'blur' }]
};

/**
 * 自助取数：搜索关键词 → 在关系图里选节点、填条件 → 完成。第二步是左图右表单，窄屏改为上图下表单；
 * 水资源用泳道关系图（弹窗加宽到 1440），其他资源沿用旧版知识图谱
 */
export const DataExtractionDialog = defineComponent({
  name: 'DataExtractionDialog',
  props: {
    owner: { type: Object as PropType<DataExtractionOwner>, required: true }
  },
  setup(props) {
    const owner = props.owner;
    const formRef = ref<FormInstance>();

    // 换了节点时两项重新填写，之前没填的校验提示不再适用
    watch([() => owner.form.dataName, () => owner.form.requirement], () =>
      formRef.value?.clearValidate(['dataName', 'requirement'])
    );

    function search(value?: string) {
      const message = owner.search(value);
      if (message) {
        ElMessage.warning(message);
      }
    }

    async function submit() {
      const valid = await formRef.value?.validate().catch(() => false);
      if (!valid) {
        return;
      }
      const message = owner.submit();
      if (message) {
        ElMessage.warning(message);
      }
    }

    function renderSearch() {
      return (
        <div class={styles.search}>
          <div class={styles.searchRow}>
            <ElInput
              modelValue={owner.keyword.value}
              onUpdate:modelValue={(value: string) => (owner.keyword.value = value)}
              onKeydown={(event: Event | KeyboardEvent) => {
                if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.isComposing) {
                  event.preventDefault();
                  search();
                }
              }}
              placeholder="请输入地类名称搜索（如：河流、耕地、居住用地）"
              aria-label="搜索关键词"
              prefixIcon={Search}
              clearable
            />
            <ElButton type="primary" icon={Search} onClick={() => search()}>
              搜索
            </ElButton>
          </div>
          <div class={styles.hot}>
            <span>热门搜索：</span>
            {HOT_KEYWORDS.map(word => (
              <ElButton key={word} size="small" onClick={() => search(word)}>
                {word}
              </ElButton>
            ))}
          </div>
          <div class={styles.hot}>
            <span>按资源类别：</span>
            <ElButton size="small" onClick={owner.browseWater}>
              <SvgIcon class={styles.buttonIcon} name="resource-water" size={14} />
              水资源
            </ElButton>
          </div>
        </div>
      );
    }

    function renderNode() {
      const node = owner.selected.value;
      if (!node) {
        return (
          <section class={styles.node} aria-live="polite">
            <strong>请选择关系图节点</strong>
            <p>在关系图中点击节点，查看它的分类信息</p>
          </section>
        );
      }
      return (
        <section class={styles.node} aria-live="polite">
          <div class={styles.nodeTitle}>
            <strong>{node.name}</strong>
            <ElTag size="small" type="success">
              已选中
            </ElTag>
          </div>
          <p>{[node.systemName, node.levelName].filter(Boolean).join(' · ')}</p>
          <p>{node.label}</p>
        </section>
      );
    }

    function renderFormatLabel() {
      return (
        <span class={styles.formatLabel}>
          数据格式（可多选）
          <span>
            <ElButton link type="primary" onClick={() => (owner.form.formats = [...DATA_FORMATS])}>
              全选
            </ElButton>
            <ElButton link type="primary" onClick={() => (owner.form.formats = [])}>
              清空
            </ElButton>
          </span>
        </span>
      );
    }

    function renderForm() {
      const form = owner.form;
      return (
        <ElForm ref={formRef} class={styles.form} model={form} rules={RULES} labelPosition="top">
          <ElFormItem label="数据名称" prop="dataName">
            <ElInput
              modelValue={form.dataName}
              onUpdate:modelValue={(value: string) => (form.dataName = value)}
              placeholder="选择节点后自动填写"
            />
          </ElFormItem>
          <ElFormItem label="数据需求" prop="requirement">
            <ElInput
              modelValue={form.requirement}
              onUpdate:modelValue={(value: string) => (form.requirement = value)}
              placeholder="选择节点后自动生成，如：河流线图层"
            />
          </ElFormItem>
          <ElFormItem label="行政区划">
            <RegionCascader modelValue={form.regionPath} onUpdate:modelValue={value => (form.regionPath = value)} />
          </ElFormItem>
          <ElFormItem label="开始时间">
            <ElDatePicker
              type="datetime"
              valueFormat="YYYY-MM-DD HH:mm:ss"
              modelValue={form.startTime}
              onUpdate:modelValue={(value: string | null) => (form.startTime = value ?? '')}
              placeholder="请选择开始时间"
            />
          </ElFormItem>
          <ElFormItem label="结束时间">
            <ElDatePicker
              type="datetime"
              valueFormat="YYYY-MM-DD HH:mm:ss"
              modelValue={form.endTime}
              onUpdate:modelValue={(value: string | null) => (form.endTime = value ?? '')}
              placeholder="请选择结束时间"
            />
          </ElFormItem>
          <ElFormItem class={styles.formatItem}>
            {{
              label: renderFormatLabel,
              default: () => (
                <ElCheckboxGroup
                  class={styles.formats}
                  modelValue={form.formats}
                  // 按选项的固定顺序保存，和点选的先后无关
                  onUpdate:modelValue={value => (form.formats = DATA_FORMATS.filter(format => value.includes(format)))}
                >
                  {DATA_FORMATS.map(format => (
                    <ElCheckbox key={format} value={format}>
                      {format}
                    </ElCheckbox>
                  ))}
                </ElCheckboxGroup>
              )
            }}
          </ElFormItem>
          <ElFormItem label="申请用途">
            <ElInput
              modelValue={form.purpose}
              onUpdate:modelValue={(value: string) => (form.purpose = value)}
              placeholder="如：用于年度耕地保护考核台账编制"
              maxlength={PURPOSE_MAX_LENGTH}
              showWordLimit
            />
          </ElFormItem>
        </ElForm>
      );
    }

    function renderBody() {
      const step = owner.step.value;
      if (step === 'search') {
        return renderSearch();
      }
      if (step === 'done') {
        return (
          <p class={styles.done} role="status">
            <span class={styles.doneIcon}>
              <SvgIcon name="check" size={16} />
            </span>
            已转到后台处理数据
          </p>
        );
      }
      if (owner.mode.value === 'relation') {
        return (
          <div key="relation" class={styles.workspace}>
            <div class={styles.graph}>
              <RelationGraph owner={owner.relation} />
            </div>
            <div class={styles.conditions}>
              <RelationNodeDetail owner={owner.relation} />
              {renderForm()}
            </div>
          </div>
        );
      }
      return (
        <div key="legacy" class={styles.workspace}>
          <div class={styles.graph}>
            <KnowledgeGraphChart
              graph={owner.graph.value}
              keyword={owner.searched.value}
              selectedId={owner.selected.value?.id}
              onSelect={owner.select}
            />
          </div>
          <div class={styles.conditions}>
            {renderNode()}
            {renderForm()}
          </div>
        </div>
      );
    }

    // 只有第二步有底栏；完成页只用标题栏的关闭
    function renderFooter() {
      return (
        <div class={styles.footer}>
          <ElButton onClick={owner.back}>上一步</ElButton>
          <span>
            <ElButton onClick={owner.close}>取消</ElButton>
            <ElButton type="primary" onClick={() => void submit()}>
              开始取数
            </ElButton>
          </span>
        </div>
      );
    }

    return () => (
      <ElDialog
        class={[
          'dialog-panel-header',
          styles.dialog,
          owner.step.value === 'graph' && (owner.mode.value === 'relation' ? styles.wideRelation : styles.wide)
        ]}
        modelValue={owner.open.value}
        onUpdate:modelValue={(open: boolean) => (owner.open.value = open)}
        title="知识库-自助取数"
        alignCenter
        appendToBody
        destroyOnClose
        closeOnClickModal={false}
      >
        {{
          header: () => (
            <MxTitle level="panel" description="选择业务标签，点亮知识节点，完成数据提取">
              知识库-自助取数
            </MxTitle>
          ),
          default: () => (
            <>
              <ElSteps class={styles.steps} active={STEP_INDEX[owner.step.value]} finishStatus="success" alignCenter>
                <ElStep title="选择标签" />
                <ElStep title="选择节点" />
                <ElStep title="开始取数" />
              </ElSteps>
              {renderBody()}
            </>
          ),
          footer: owner.step.value === 'graph' ? renderFooter : undefined
        }}
      </ElDialog>
    );
  }
});
