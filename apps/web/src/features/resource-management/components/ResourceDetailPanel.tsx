import { ArrowDown, ArrowLeft, ArrowUp, EditPen } from '@element-plus/icons-vue';
import { useMediaQuery } from '@vueuse/core';
import { MxPanel, MxSection, MxTitle } from '@yzt/ui';
import {
  ElAlert,
  ElButton,
  ElInput,
  ElMessage,
  ElOption,
  ElOptionGroup,
  ElPopover,
  ElSelect,
  ElSkeleton,
  ElTable,
  ElTableColumn
} from 'element-plus';
import { defineComponent, type PropType, ref } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import type { ResourceAttribute, ResourceDetail, ResourceDirectory } from '../api';
import type { useResourceDetail } from '../composables/useResourceDetail';
import styles from './ResourceDetailPanel.module.scss';

type ResourceDetailOwner = ReturnType<typeof useResourceDetail>;
type MetadataItems = [label: string, value: string | number | null | undefined][];

// 宽度不超过 760 或高度不超过 700 时元数据默认收起，同一时间只展开一组，属性表留在主区
const COMPACT_DETAIL_QUERY = '(max-width: 760px), (max-height: 700px)';

// 元数据固定占高：长值省略，点开看全文，不把属性表挤下去
function renderMetadata(items: MetadataItems) {
  return (
    <dl class={styles.metadata}>
      {items.map(([label, value]) => {
        const text = value === '' ? '—' : String(value ?? '—');
        return (
          <div class={styles.metadataItem} key={label}>
            <dt>{label}</dt>
            <dd>
              <ElPopover trigger="click" width={280} content={text}>
                {{
                  reference: () => (
                    <button class={styles.value} title={text} aria-label={`${label}：${text}`}>
                      {text}
                    </button>
                  )
                }}
              </ElPopover>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function datasetItems(data: ResourceDetail): MetadataItems {
  return [
    ['数据集名称', data.datasetName],
    ['数据生产年份', data.year],
    ['数据来源', data.submit_unit],
    ['数据集图层列表', data.datasets]
  ];
}

function layerItems(data: ResourceDetail): MetadataItems {
  return [
    ['图层名称', data.layerName],
    ['要素类型', data.elementType],
    ['记录数目', data.layerRecord?.toLocaleString('zh-CN')],
    ['平面坐标系', data.coordinate]
  ];
}

/** 资源详情：在主区里替换列表显示；修改入口在头部，草稿、保存和导入都由拥有者（useResourceDetail）处理 */
export const ResourceDetailPanel = defineComponent({
  name: 'ResourceDetailPanel',
  props: {
    owner: { type: Object as PropType<ResourceDetailOwner>, required: true },
    directories: { type: Array as PropType<ResourceDirectory[]>, required: true }
  },
  setup(props) {
    const showLoading = useDelayedFlag(() => props.owner.query.isLoading.value);
    const showSaving = useDelayedFlag(() => props.owner.pending.value);
    const compact = useMediaQuery(COMPACT_DETAIL_QUERY);
    // 窄屏、矮屏时展开着的那一组元数据
    const expanded = ref<string | null>(null);
    const fileInput = ref<HTMLInputElement>();

    // 选了文件直接上传；清空输入框，失败后能再选同一个文件
    function selectFile(event: Event) {
      if (!(event.target instanceof HTMLInputElement)) {
        return;
      }
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) {
        void props.owner.importer.upload(file);
      }
    }

    async function save() {
      if (await props.owner.save()) {
        ElMessage.success('资源属性已保存');
      }
    }

    function renderMetadataSection(title: string, items: MetadataItems) {
      const collapsed = compact.value && expanded.value !== title;
      const renderToggle = () => (
        <ElButton
          link
          icon={collapsed ? ArrowDown : ArrowUp}
          aria-label={`${collapsed ? '展开' : '收起'}${title}`}
          aria-expanded={!collapsed}
          onClick={() => {
            expanded.value = collapsed ? title : null;
          }}
        />
      );
      return (
        <MxSection class={styles.metadataSection} title={title} data-collapsed={collapsed || undefined}>
          {{
            // 只有窄屏、矮屏可以收起
            extra: compact.value ? renderToggle : undefined,
            default: () => (collapsed ? [] : [renderMetadata(items)])
          }}
        </MxSection>
      );
    }

    function renderCategory(data: ResourceDetail) {
      const { owner } = props;
      if (!owner.editing.value) {
        return <span>{data.resourceName || '—'}</span>;
      }
      return (
        <>
          <ElSelect
            class={styles.categorySelect}
            modelValue={owner.draft.value?.category?.id}
            placeholder="请选择数据分类"
            aria-label="数据分类"
            disabled={owner.pending.value}
            onUpdate:modelValue={owner.setCategory}
          >
            {props.directories.map(group => (
              <ElOptionGroup key={group.id} label={group.name}>
                {(group.children ?? []).map(node => (
                  <ElOption key={node.id} label={`${group.name} / ${node.name}`} value={node.id} />
                ))}
              </ElOptionGroup>
            ))}
          </ElSelect>
          {!owner.draft.value?.category && (
            <p class={styles.hint}>当前分类「{data.resourceName || '未提供'}」未唯一匹配目录，请选择后保存</p>
          )}
        </>
      );
    }

    function importText(): string {
      const { stage, percent, message } = props.owner.importer;
      if (stage.value === 'sending') {
        return percent.value === null ? '正在上传…' : `正在上传 ${percent.value}%`;
      }
      return stage.value === 'processing' ? '文件已发送，正在处理…' : message.value;
    }

    function renderImportStatus() {
      const { stage } = props.owner.importer;
      const text = importText();
      if (!text) {
        return null;
      }
      return (
        <p
          class={[
            styles.importStatus,
            stage.value === 'error' && styles.importError,
            stage.value === 'success' && styles.importSuccess
          ]}
          role={stage.value === 'error' ? 'alert' : 'status'}
          title={text}
        >
          {text}
        </p>
      );
    }

    function renderImportEntry() {
      const { owner } = props;
      // 编辑、保存、导入中和详情加载失败时不能导入
      const disabled =
        owner.editing.value || owner.pending.value || owner.importer.pending.value || owner.query.isError.value;
      return (
        <>
          <input
            ref={fileInput}
            hidden
            type="file"
            accept=".xlsx,.xls"
            aria-label="属性规范 Excel 文件"
            disabled={disabled}
            onChange={selectFile}
          />
          <ElButton link type="primary" disabled={disabled} onClick={() => fileInput.value?.click()}>
            导入
          </ElButton>
          <span class={styles.importHint}>（支持 .xlsx、.xls）</span>
        </>
      );
    }

    function renderAttributes(attributes: ResourceAttribute[]) {
      const { owner } = props;
      return (
        <MxSection class={styles.attributes} title="属性结构描述表">
          {{
            extra: renderImportEntry,
            default: () => (
              <>
                {renderImportStatus()}
                <ElTable class={styles.attributeTable} height="100%" data={attributes} emptyText="暂无属性结构">
                  <ElTableColumn label="字段名称" minWidth="200">
                    {{
                      default: ({ row, $index }: { row: ResourceAttribute; $index: number }) =>
                        owner.editing.value ? (
                          <ElInput
                            aria-label={`${row.code}字段名称`}
                            modelValue={row.name ?? ''}
                            disabled={owner.pending.value}
                            onUpdate:modelValue={value => owner.setName($index, value)}
                            placeholder="可为空"
                          />
                        ) : (
                          <span class={styles.attributeName}>{row.name || '—'}</span>
                        )
                    }}
                  </ElTableColumn>
                  <ElTableColumn prop="code" label="字段代码" minWidth="130" />
                  <ElTableColumn prop="fieldType" label="字段类型" minWidth="100" />
                  <ElTableColumn prop="fieldLength" label="字段长度" width="100" />
                </ElTable>
              </>
            )
          }}
        </MxSection>
      );
    }

    function renderBody() {
      const { owner } = props;
      // 编辑时显示开始编辑那一刻的详情，后台刷新不覆盖输入
      const data = owner.draft.value?.base ?? owner.detail.value;
      const attributes = owner.draft.value?.attributes ?? data?.attributes ?? [];
      return (
        <>
          {owner.error.value && (
            <ElAlert class={styles.notice} type="error" title={owner.error.value} closable={false} />
          )}
          {owner.query.isError.value && (
            <ElAlert class={styles.notice} type="error" closable={false}>
              资源详情加载失败{data ? '，当前显示上次结果' : ''}
              <ElButton link type="primary" onClick={() => void owner.query.refetch()}>
                重试详情
              </ElButton>
            </ElAlert>
          )}
          {data && (
            <>
              <div class={styles.categoryRow}>
                <MxTitle level="section">数据分类</MxTitle>
                {renderCategory(data)}
              </div>
              {renderMetadataSection('数据集元数据', datasetItems(data))}
              {renderMetadataSection('空间要素图层元数据', layerItems(data))}
              {renderAttributes(attributes)}
            </>
          )}
          {!data && showLoading.value && <ElSkeleton rows={8} animated aria-label="正在加载资源详情" />}
        </>
      );
    }

    // 按钮各包一层 span：间距只由 MxPanel 的头部和底栏决定，不叠加 Element 相邻按钮的外边距
    function renderActions() {
      const { owner } = props;
      const writing = owner.pending.value || owner.importer.pending.value;
      const loaded = owner.detail.value !== undefined && !owner.query.isError.value;
      return (
        <>
          <span>
            <ElButton icon={ArrowLeft} disabled={writing} onClick={() => void owner.close()}>
              返回
            </ElButton>
          </span>
          {!owner.editing.value && (
            <span>
              <ElButton
                type="primary"
                icon={EditPen}
                disabled={!loaded || owner.importer.pending.value}
                onClick={owner.beginEdit}
              >
                修改
              </ElButton>
            </span>
          )}
        </>
      );
    }

    function renderFooter() {
      const { owner } = props;
      return (
        <>
          <span>
            <ElButton disabled={owner.pending.value} onClick={() => void owner.cancelEdit()}>
              取消编辑
            </ElButton>
          </span>
          <span>
            <ElButton
              type="primary"
              loading={showSaving.value}
              disabled={!owner.dirty.value || owner.pending.value}
              onClick={() => void save()}
            >
              保存
            </ElButton>
          </span>
        </>
      );
    }

    return () => {
      const { owner } = props;
      const target = owner.target.value;
      return (
        <MxPanel
          headerTone="muted"
          class={styles.panel}
          title={target?.name ?? '资源详情'}
          description={`${target?.year ?? '年份未提供'} · ${owner.editing.value ? '编辑' : '查看'}`}
          data-resource-detail
        >
          {{
            actions: renderActions,
            default: renderBody,
            // 查看时不留空的底栏
            footer: owner.editing.value ? renderFooter : undefined
          }}
        </MxPanel>
      );
    };
  }
});
