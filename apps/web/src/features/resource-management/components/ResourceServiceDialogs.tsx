import { CopyDocument, Delete, EditPen, Plus } from '@element-plus/icons-vue';
import { useClipboard } from '@vueuse/core';
import { MxTitle } from '@yzt/ui';
import {
  ElButton,
  ElDialog,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  ElOption,
  ElRadioButton,
  ElRadioGroup,
  ElSelect,
  ElTag,
  type FormInstance,
  type FormRules
} from 'element-plus';
import { computed, defineComponent, ref, type PropType } from 'vue';
import type { LayerServiceEditor, LayerServicesOwner } from '../composables/useLayerServices';
import {
  LAYER_SERVICE_LABELS,
  LAYER_SERVICE_TYPES,
  type LayerServiceDraft,
  type LayerServiceRecord,
  mapServiceMeta
} from '../layer-services';
import styles from './ResourceServiceDialogs.module.scss';

/** 两类记录的字段名称不同，其余完全一样 */
const FIELD_LABELS = {
  map: { name: '服务名称', type: '服务类型', url: '服务地址', unit: '服务' },
  interface: { name: '接口名称', type: '接口类型', url: '接口地址', unit: '接口' }
} as const;

/** 地图服务、数据接口的列表、新增 / 编辑表单和删除确认；三个弹窗都由 useLayerServices 控制开关 */
export const ResourceServiceDialogs = defineComponent({
  name: 'ResourceServiceDialogs',
  props: {
    owner: { type: Object as PropType<LayerServicesOwner>, required: true }
  },
  setup(props) {
    const owner = props.owner;
    const formRef = ref<FormInstance>();
    // 校验期间不重复提交
    const validating = ref(false);
    const kind = computed(() => owner.target.value?.kind ?? 'map');
    const label = computed(() => LAYER_SERVICE_LABELS[kind.value]);
    const fields = computed(() => FIELD_LABELS[kind.value]);
    const formTitle = computed(() => `${owner.editor.value?.id ? '编辑' : '新增'}${label.value}`);
    const rules = computed<FormRules>(() => ({
      name: [{ required: true, whitespace: true, message: `请输入${fields.value.name}`, trigger: 'blur' }],
      type: [{ required: true, message: `请选择${fields.value.type}`, trigger: 'change' }],
      url: [{ required: true, whitespace: true, message: `请输入${fields.value.url}`, trigger: 'blur' }]
    }));
    const { copy } = useClipboard({ legacy: true });

    // 年份为空的资源只显示名称
    function subtitle() {
      const target = owner.target.value;
      if (!target) {
        return '';
      }
      return target.year === null ? target.name : `${target.name} · ${target.year}`;
    }

    async function submit(current: LayerServiceEditor) {
      if (validating.value) {
        return;
      }
      validating.value = true;
      try {
        const valid = await formRef.value?.validate().catch(() => false);
        if (valid && owner.save(current)) {
          ElMessage.success(`${label.value}已保存`);
        }
      } finally {
        validating.value = false;
      }
    }

    function submitOnEnter(event: Event | KeyboardEvent, current: LayerServiceEditor) {
      if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        void submit(current);
      }
    }

    // 普通 HTTP 的内网没有异步剪贴板，legacy 退回 execCommand
    async function copyAddress(url: string) {
      try {
        await copy(url);
        ElMessage.success('地址已复制');
      } catch {
        ElMessage.error('复制失败，请手动复制');
      }
    }

    function remove() {
      if (owner.answerRemoval(true)) {
        ElMessage.success(`${label.value}已删除`);
      }
    }

    function renderCard(item: LayerServiceRecord) {
      const meta = mapServiceMeta(item.type);
      const enabled = item.status === 'enabled';
      return (
        <article key={item.id} class={styles.card} aria-label={item.name}>
          <div class={styles.cardTop}>
            <div class={styles.cardTitle}>
              <strong>{item.name}</strong>
              <ElTag size="small" type={kind.value === 'map' ? 'primary' : 'warning'}>
                {item.type}
              </ElTag>
            </div>
            <span class={[styles.status, !enabled && styles.stopped]}>
              <span class={styles.statusDot} />
              {enabled ? '运行中' : '已停用'}
            </span>
          </div>
          <div class={styles.address}>
            <span class={styles.url}>{item.url}</span>
            <ElButton
              size="small"
              link
              icon={CopyDocument}
              aria-label={`复制「${item.name}」的地址`}
              onClick={() => void copyAddress(item.url)}
            />
          </div>
          <div class={styles.cardBottom}>
            <div class={styles.meta}>
              {meta && <ElTag size="small" type="info">{meta.crs}</ElTag>}
              {meta && <ElTag size="small" type="info">{meta.format}</ElTag>}
            </div>
            <div class={styles.actions}>
              <ElButton size="small" link type="primary" icon={EditPen} onClick={() => owner.edit(item)}>
                编辑
              </ElButton>
              <ElButton size="small" link type="danger" icon={Delete} onClick={() => owner.requestRemoval(item)}>
                删除
              </ElButton>
            </div>
          </div>
        </article>
      );
    }

    function renderList() {
      const items = owner.items.value;
      if (items.length === 0) {
        return <ElEmpty imageSize={64} description={`暂无${label.value}，点击“新增”添加`} />;
      }
      return <div class={styles.list}>{items.map(renderCard)}</div>;
    }

    function renderForm() {
      const current = owner.editor.value;
      if (!current) {
        return null;
      }
      const { draft } = current;
      return (
        <ElForm ref={formRef} model={draft} rules={rules.value} labelPosition="top">
          <ElFormItem label={fields.value.name} prop="name">
            <ElInput
              modelValue={draft.name}
              onUpdate:modelValue={(value: string) => (draft.name = value)}
              placeholder={`请输入${fields.value.name}`}
              onKeydown={(event: Event | KeyboardEvent) => submitOnEnter(event, current)}
            />
          </ElFormItem>
          <ElFormItem label={fields.value.type} prop="type">
            <ElSelect
              modelValue={draft.type}
              onUpdate:modelValue={(value: LayerServiceDraft['type']) => (draft.type = value)}
            >
              {LAYER_SERVICE_TYPES[kind.value].map(type => (
                <ElOption key={type} value={type} label={type} />
              ))}
            </ElSelect>
          </ElFormItem>
          <ElFormItem label={fields.value.url} prop="url">
            <ElInput
              modelValue={draft.url}
              onUpdate:modelValue={(value: string) => (draft.url = value)}
              placeholder={`请输入${fields.value.url}`}
              onKeydown={(event: Event | KeyboardEvent) => submitOnEnter(event, current)}
            />
          </ElFormItem>
          <ElFormItem label="状态">
            <ElRadioGroup
              modelValue={draft.status}
              onUpdate:modelValue={value => (draft.status = value === 'disabled' ? 'disabled' : 'enabled')}
            >
              <ElRadioButton value="enabled">启用</ElRadioButton>
              <ElRadioButton value="disabled">禁用</ElRadioButton>
            </ElRadioGroup>
          </ElFormItem>
        </ElForm>
      );
    }

    function confirmForm() {
      const current = owner.editor.value;
      if (current) {
        void submit(current);
      }
    }

    return () => (
      <>
        <ElDialog
          class={['dialog-panel-header', styles.dialog, styles.listDialog]}
          modelValue={owner.listOpen.value}
          onUpdate:modelValue={(open: boolean) => (owner.listOpen.value = open)}
          title={`${label.value}列表`}
          alignCenter
          appendToBody
          destroyOnClose
        >
          {{
            header: () => (
              <MxTitle level="panel" description={subtitle()}>
                {{
                  default: () => `${label.value}列表`,
                  extra: () => (
                    <ElButton size="small" type="primary" icon={Plus} onClick={() => owner.edit()}>
                      新增
                    </ElButton>
                  )
                }}
              </MxTitle>
            ),
            default: renderList
          }}
        </ElDialog>
        <ElDialog
          class={['dialog-panel-header', styles.dialog, styles.formDialog]}
          modelValue={owner.formOpen.value}
          onUpdate:modelValue={(open: boolean) => {
            if (!open) {
              owner.closeForm();
            }
          }}
          title={formTitle.value}
          alignCenter
          appendToBody
          destroyOnClose
          closeOnClickModal={false}
        >
          {{
            header: () => <MxTitle level="panel">{formTitle.value}</MxTitle>,
            default: renderForm,
            footer: () => (
              <>
                <ElButton onClick={owner.closeForm}>取消</ElButton>
                <ElButton type="primary" disabled={validating.value} onClick={confirmForm}>
                  确定
                </ElButton>
              </>
            )
          }}
        </ElDialog>
        <ElDialog
          class={['dialog-panel-header', styles.dialog, styles.formDialog]}
          modelValue={owner.removalOpen.value}
          // 点右上角关闭、按 Esc 都算取消
          onUpdate:modelValue={(open: boolean) => {
            if (!open) {
              owner.answerRemoval(false);
            }
          }}
          title={`删除${label.value}`}
          alignCenter
          appendToBody
          destroyOnClose
          closeOnClickModal={false}
        >
          {{
            header: () => <MxTitle level="panel">删除{label.value}</MxTitle>,
            default: () => (
              <p class={styles.confirmText}>
                确定删除{fields.value.unit}「{owner.removal.value?.name}」吗？
              </p>
            ),
            footer: () => (
              <>
                <ElButton onClick={() => owner.answerRemoval(false)}>取消</ElButton>
                <ElButton type="danger" onClick={remove}>
                  删除
                </ElButton>
              </>
            )
          }}
        </ElDialog>
      </>
    );
  }
});
