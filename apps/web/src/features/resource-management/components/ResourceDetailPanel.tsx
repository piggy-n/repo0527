import { ArrowLeft, EditPen } from '@element-plus/icons-vue';
import { MxPanel, MxSection } from '@yzt/ui';
import {
  ElAlert, ElButton, ElInput, ElMessage, ElOption, ElOptionGroup, ElSelect, ElSkeleton, ElTable, ElTableColumn
} from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import type { ResourceAttribute, ResourceDirectory } from '../api';
import type { useResourceDetail } from '../composables/useResourceDetail';
import styles from './ResourceDetailPanel.module.scss';

/** 只读元数据保留完整内容，长文本在单元格内换行 */
function metadata(items: [string, string | number | null | undefined][]) {
  return <dl class={styles.metadata}>{items.map(([label, value]) => (
    <div class={styles.metadataItem} key={label}><dt>{label}</dt><dd>{value === '' ? '—' : value ?? '—'}</dd></div>
  ))}</dl>;
}

/** 详情主区按 v2 展示；编辑入口固定在头部，草稿与提交逻辑由拥有者管理 */
export const ResourceDetailPanel = defineComponent({
  name: 'ResourceDetailPanel',
  props: {
    owner: { type: Object as PropType<ReturnType<typeof useResourceDetail>>, required: true },
    directories: { type: Array as PropType<ResourceDirectory[]>, required: true }
  },
  setup(props) {
    const showLoading = useDelayedFlag(() => props.owner.query.isLoading.value);
    const showSaving = useDelayedFlag(() => props.owner.pending.value);

    async function save() {
      if (await props.owner.save()) { ElMessage.success('资源属性已保存'); }
    }

    return () => {
      const owner = props.owner;
      const data = owner.draft.value?.base ?? owner.detail.value;
      const attributes = owner.draft.value?.attributes ?? data?.attributes ?? [];
      return (
        <MxPanel
          class={styles.panel}
          title={owner.target.value?.name ?? '资源详情'}
          description={`${owner.target.value?.year ?? '年份未提供'} · ${owner.editing.value ? '编辑' : '查看'}`}
          data-resource-detail
        >
          {{
            actions: () => <>
              <ElButton link icon={ArrowLeft} disabled={owner.pending.value} onClick={() => void owner.close()}>
                返回列表
              </ElButton>
              {!owner.editing.value && <ElButton
                type="primary"
                icon={EditPen}
                disabled={!data || owner.query.isError.value}
                onClick={owner.beginEdit}
              >修改</ElButton>}
            </>,
            default: () => <>
              {owner.error.value && <ElAlert class={styles.notice} type="error" title={owner.error.value} closable={false} />}
              {owner.query.isError.value && <ElAlert class={styles.notice} type="error" closable={false}>
                资源详情加载失败{data ? '，当前显示上次结果' : ''}
                <ElButton link type="primary" onClick={() => void owner.query.refetch()}>重试详情</ElButton>
              </ElAlert>}
              {data ? <>
                <MxSection title="数据分类">
                  {owner.editing.value ? <>
                    <ElSelect
                      class={styles.categorySelect}
                      modelValue={owner.draft.value?.category?.id}
                      placeholder="请选择数据分类"
                      aria-label="数据分类"
                      disabled={owner.pending.value}
                      onUpdate:modelValue={owner.setCategory}
                    >
                      {{ default: () => props.directories.map(group => (
                        <ElOptionGroup key={group.id} label={group.name}>
                          {{ default: () => (group.children ?? []).map(node => <ElOption
                            key={node.id} label={`${group.name} / ${node.name}`} value={node.id}
                          />) }}
                        </ElOptionGroup>
                      )) }}
                    </ElSelect>
                    {!owner.draft.value?.category && <p class={styles.hint}>
                      当前分类「{data.resourceName || '未提供'}」未唯一匹配目录，请选择后保存
                    </p>}
                  </> : <span>{data.resourceName || '—'}</span>}
                </MxSection>
                <MxSection title="数据集元数据">{metadata([
                  ['数据集名称', data.datasetName], ['数据生产年份', data.year],
                  ['数据来源', data.submit_unit || data.submitUnit], ['数据集图层列表', data.datasets]
                ])}</MxSection>
                <MxSection title="空间要素图层元数据">{metadata([
                  ['图层名称', data.layerName], ['要素类型', data.elementType],
                  ['记录数目', data.layerRecord?.toLocaleString('zh-CN')], ['平面坐标系', data.coordinate]
                ])}</MxSection>
                <MxSection title="属性结构描述表">
                  <ElTable data={attributes} emptyText="暂无属性结构">
                    <ElTableColumn label="字段名称" minWidth="200">
                      {{ default: ({ row, $index }: { row: ResourceAttribute; $index: number }) => owner.editing.value
                        ? <ElInput
                          aria-label={`${row.code}字段名称`}
                          modelValue={row.name ?? ''}
                          disabled={owner.pending.value}
                          onUpdate:modelValue={value => owner.setName($index, value)}
                          placeholder="可为空"
                        /> : <span class={styles.attributeName}>{row.name || '—'}</span> }}
                    </ElTableColumn>
                    <ElTableColumn prop="code" label="字段代码" minWidth="130" />
                    <ElTableColumn prop="fieldType" label="字段类型" minWidth="100" />
                    <ElTableColumn prop="fieldLength" label="字段长度" width="100" />
                  </ElTable>
                  <p class={styles.hint}>{owner.editing.value
                    ? '仅可修改数据分类和字段名称；字段名称允许为空。' : '字段代码、类型和长度只读。'}</p>
                </MxSection>
              </> : showLoading.value ? <ElSkeleton rows={8} animated aria-label="正在加载资源详情" /> : null}
            </>,
            footer: owner.editing.value ? () => <div class={styles.footer}>
              <span class={styles.dirty}>{owner.pending.value ? '正在保存…' : owner.dirty.value ? '有未保存的修改' : '尚未修改'}</span>
              <ElButton disabled={owner.pending.value} onClick={() => void owner.cancelEdit()}>取消编辑</ElButton>
              <ElButton
                type="primary"
                loading={showSaving.value}
                disabled={!owner.dirty.value || owner.pending.value}
                onClick={() => void save()}
              >保存</ElButton>
            </div> : undefined
          }}
        </MxPanel>
      );
    };
  }
});
