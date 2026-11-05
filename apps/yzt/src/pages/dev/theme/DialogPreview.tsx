import { MxTitle } from '@yzt/ui';
import { ElButton, ElDialog, ElForm, ElFormItem, ElInput } from 'element-plus';
import { defineComponent, ref } from 'vue';

/** 公共浅灰标题弹窗（dialog-panel-header，ADR 0076）的样例，不读取或提交业务数据 */
export const DialogPreview = defineComponent({
  name: 'DialogPreview',
  setup() {
    const opened = ref(false);
    const name = ref('土地资源');

    return () => (
      <>
        <ElButton onClick={() => (opened.value = true)}>灰底标题弹窗</ElButton>
        <ElDialog
          class="dialog-panel-header"
          title="目录名称示例"
          width="min(560px, calc(100vw - 32px))"
          modelValue={opened.value}
          onUpdate:modelValue={value => (opened.value = value)}
          appendToBody
          destroyOnClose
        >
          {{
            header: () => <MxTitle level="panel">目录名称示例</MxTitle>,
            default: () => (
              <ElForm labelPosition="top">
                <ElFormItem label="目录名称" required>
                  <ElInput
                    modelValue={name.value}
                    onUpdate:modelValue={value => (name.value = value)}
                    maxlength={20}
                    showWordLimit
                  />
                </ElFormItem>
              </ElForm>
            ),
            footer: () => (
              <>
                <ElButton onClick={() => (opened.value = false)}>取消</ElButton>
                <ElButton type="primary" onClick={() => (opened.value = false)}>
                  保存目录
                </ElButton>
              </>
            )
          }}
        </ElDialog>
      </>
    );
  }
});
