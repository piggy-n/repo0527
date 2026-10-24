import { ArrowDown, ArrowUp, Close, Download, FullScreen, ScaleToOriginal } from '@element-plus/icons-vue';
import { MxPanel, MxTitle } from '@yzt/ui';
import {
  ElButton, ElCheckbox, ElCheckboxGroup, ElDialog, ElEmpty, ElMessage, ElPagination, ElSkeleton, ElTable, ElTableColumn
} from 'element-plus';
import { computed, defineComponent, type PropType, ref } from 'vue';
import { DEMO_ROWS, type PreviewRow } from './preview-data';
import type { QueryPreviewModel } from './useQueryPreview';
import styles from './preview.module.scss';

/** 结果、分页与导出使用已提交的条件说明，编辑中的条件不改写结果标题 */
export const QueryResultsPreview = defineComponent({
  name: 'QueryResultsPreview',
  props: { model: { type: Object as PropType<QueryPreviewModel>, required: true } },
  emits: { locate: (_row: PreviewRow) => true },
  setup(props, { emit }) {
    const exportOpen = ref(false);
    const formats = ref<string[]>(['excel']);
    const rows = computed(() => DEMO_ROWS.slice((props.model.page.value - 1) * 20, props.model.page.value * 20));
    const ready = computed(() => props.model.submitted.value && props.model.scene.value === 'normal');

    function renderBody() {
      const model = props.model;
      if (!model.resultOpen.value) {
        return null;
      }
      if (model.scene.value === 'loading') {
        return <div class={styles.resultState} aria-busy="true"><ElSkeleton rows={3} animated /></div>;
      }
      if (model.scene.value === 'error') {
        return (
          <div class={styles.resultState} role="alert">
            <p>查询失败，请重试</p>
            <ElButton onClick={() => (model.scene.value = 'normal')}>重新查询</ElButton>
          </div>
        );
      }
      if (!model.submitted.value || model.scene.value === 'empty') {
        return <ElEmpty imageSize={48} description={model.submitted.value ? '没有符合条件的数据' : '设置条件后开始查询'} />;
      }
      return (
        <ElTable
          data={rows.value}
          height="100%"
          rowKey="id"
          highlightCurrentRow
          onRow-click={row => emit('locate', row)}
        >
          <ElTableColumn prop="id" label="序号" width={64} />
          <ElTableColumn prop="name" label="名称" minWidth={220} showOverflowTooltip />
          <ElTableColumn prop="region" label="行政区划" minWidth={110} />
          <ElTableColumn prop="type" label="类型" minWidth={100} />
          <ElTableColumn prop="area" label="面积（平方米）" minWidth={150} />
          <ElTableColumn prop="year" label="年份" minWidth={80} />
        </ElTable>
      );
    }

    return () => {
      const model = props.model;
      return (
        <>
          <MxPanel class={styles.panel} headerTone="muted" floating flush>
            {{
              header: () => <MxTitle level="panel">查询结果</MxTitle>,
              actions: () => [
                <ElButton
                  link
                  type="primary"
                  icon={Download}
                  disabled={!ready.value}
                  onClick={() => (exportOpen.value = true)}
                >导出</ElButton>,
                <ElButton
                  link
                  icon={model.resultOpen.value ? ArrowDown : ArrowUp}
                  aria-label={model.resultOpen.value ? '收起查询结果' : '展开查询结果'}
                  onClick={() => {
                    model.resultOpen.value = !model.resultOpen.value;
                    model.maximized.value = false;
                  }}
                />,
                model.resultOpen.value && (
                  <ElButton
                    link
                    icon={model.maximized.value ? ScaleToOriginal : FullScreen}
                    aria-label={model.maximized.value ? '恢复结果面板' : '最大化查询结果'}
                    onClick={() => (model.maximized.value = !model.maximized.value)}
                  />
                )
              ],
              subheader: model.resultOpen.value ? () => (
                <div class={styles.resultSummary}>
                  <span>{model.submitted.value?.title ?? '尚未查询'}</span>
                  {model.edited.value && <span class={styles.changed}>条件已修改，请重新查询</span>}
                </div>
              ) : undefined,
              default: renderBody,
              footer: model.resultOpen.value && ready.value ? () => (
                <div class={styles.pagination}>
                  <ElPagination
                    currentPage={model.page.value}
                    pageSize={20}
                    total={DEMO_ROWS.length}
                    layout="total, prev, pager, next"
                    pagerCount={5}
                    onUpdate:current-page={value => (model.page.value = value)}
                  />
                  <span class={styles.hint}>统计图 / 统计表待接口支持</span>
                </div>
              ) : undefined
            }}
          </MxPanel>
          <ElDialog
            class="dialog-panel-header"
            width="min(420px, calc(100vw - 32px))"
            modelValue={exportOpen.value}
            onUpdate:modelValue={value => (exportOpen.value = value)}
          >
            {{
              header: () => <MxTitle level="panel">导出查询结果</MxTitle>,
              default: () => (
                <>
                  <p>{model.submitted.value?.title}</p>
                  <ElCheckboxGroup
                    modelValue={formats.value}
                    onUpdate:modelValue={value => (formats.value = value as string[])}
                  >
                    <ElCheckbox value="excel">Excel</ElCheckbox>
                    <ElCheckbox value="shp">SHP</ElCheckbox>
                    <ElCheckbox value="gdb">GDB</ElCheckbox>
                  </ElCheckboxGroup>
                  <p class={styles.hint}>按本次查询结果导出，不采用尚未提交的新条件。</p>
                </>
              ),
              footer: () => [
                <ElButton icon={Close} onClick={() => (exportOpen.value = false)}>取消</ElButton>,
                <ElButton
                  type="primary"
                  icon={Download}
                  disabled={!formats.value.length}
                  onClick={() => {
                    exportOpen.value = false;
                    ElMessage.info('导出交互演示完成，未请求或生成业务文件');
                  }}
                >导出</ElButton>
              ]
            }}
          </ElDialog>
        </>
      );
    };
  }
});
