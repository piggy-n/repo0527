import { DataAnalysis, Document, Refresh, Timer, Upload } from '@element-plus/icons-vue';
import {
  ElButton,
  ElCheckbox,
  ElDatePicker,
  ElIcon,
  ElLink,
  ElPagination,
  ElRadioButton,
  ElRadioGroup,
  ElTable,
  ElTableColumn
} from 'element-plus';
import { defineComponent, ref } from 'vue';
import { MxPanel, MxTitle } from '@yzt/ui';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import styles from './UiComponentsPreview.module.scss';

/** libs/ui 的标题：两个层级、自定义图标、extra、省略 */
export const TitlePreview = defineComponent({
  name: 'TitlePreview',
  setup() {
    return () => (
      <div class={styles.titleGrid}>
        <div class={styles.stack}>
          <MxTitle level="panel">面板标题 · 统计报表计算</MxTitle>
          <MxTitle>区块标题 · 年份选择</MxTitle>
        </div>
        <div class={styles.stack}>
          <MxTitle level="panel">
            {{
              default: () => '面板标题换成图标（ElIcon）',
              icon: () => (
                <ElIcon>
                  <DataAnalysis />
                </ElIcon>
              )
            }}
          </MxTitle>
          <MxTitle>{{ default: () => '区块标题换成图标（SvgIcon）', icon: () => <SvgIcon name="nav-query" /> }}</MxTitle>
        </div>
        <div class={styles.stack}>
          <MxTitle>{{ default: () => '选择表', extra: () => <ElCheckbox modelValue>全选</ElCheckbox> }}</MxTitle>
          <MxTitle>
            {{
              default: () => '处理进度',
              icon: () => (
                <ElIcon>
                  <Timer />
                </ElIcon>
              ),
              extra: () => [
                <span class={styles.muted}>更新于 10:24</span>,
                <ElButton size="small" icon={Refresh}>
                  刷新
                </ElButton>
              ]
            }}
          </MxTitle>
        </div>
        <div class={[styles.stack, styles.narrow]}>
          <MxTitle>
            {{
              default: () => '国家/行业现行技术规程、标准、规范 · 自然资源调查类',
              extra: () => <ElLink type="primary">更多</ElLink>
            }}
          </MxTitle>
          <span class={styles.muted}>↑ 宽 300 时标题省略，"更多"保持完整</span>
        </div>
      </div>
    );
  }
});

const auditRows = Array.from({ length: 12 }, (_, index) => ({
  name: `南京市 ${2025 - (index % 3)} 年度国土变更调查成果（${index + 1}）`,
  applicant: ['张敏', '王磊', '李娜'][index % 3],
  time: `2026-09-${String(29 - index).padStart(2, '0')} 09:${String(12 + index * 2).padStart(2, '0')}`
}));

const reportActions = () => <ElButton size="small">重置</ElButton>;
const documentIcon = () => (
  <ElIcon>
    <Document />
  </ElIcon>
);

/** libs/ui 的面板：三种头部写法、操作与底部、表格占满、无头部、去掉内边距 */
export const PanelPreview = defineComponent({
  name: 'PanelPreview',
  setup() {
    const year = ref('2025');
    const level = ref('省级');
    const page = ref(1);

    const reportForm = () => (
      <div class={styles.form}>
        <label class={styles.field}>
          数据年份
          <ElDatePicker
            class={styles.year}
            type="year"
            valueFormat="YYYY"
            clearable={false}
            modelValue={year.value}
            onUpdate:modelValue={(value: string) => {
              year.value = value;
            }}
          />
        </label>
        <div class={styles.field}>
          行政区域
          <ElRadioGroup
            modelValue={level.value}
            onUpdate:modelValue={value => {
              level.value = String(value);
            }}
          >
            {['省级', '市级', '县级'].map(option => (
              <ElRadioButton key={option} value={option}>
                {option}
              </ElRadioButton>
            ))}
          </ElRadioGroup>
        </div>
      </div>
    );

    return () => (
      <div class={styles.stage}>
        <div class={styles.panelGrid}>
          <div class={styles.cell}>
            <p class={styles.caption}>① 默认：竖杠标题</p>
            <MxPanel title="选择查看报表">{{ default: reportForm, actions: reportActions }}</MxPanel>
          </div>
          <div class={styles.cell}>
            <p class={styles.caption}>② 标题换成图标</p>
            <MxPanel title="选择查看报表">
              {{ default: reportForm, actions: reportActions, icon: documentIcon }}
            </MxPanel>
          </div>
          <div class={styles.cell}>
            <p class={styles.caption}>③ 卡片头部（iconTile）</p>
            <MxPanel title="选择查看报表" iconTile>
              {{ default: reportForm, actions: reportActions, icon: documentIcon }}
            </MxPanel>
          </div>
        </div>

        <div class={styles.tableRow}>
          <div class={[styles.cell, styles.tableCell]}>
            <p class={styles.caption}>高 360 的容器：表格占满剩余高度，在面板内滚动，分页固定在底部</p>
            <MxPanel title="资源审核">
              {{
                actions: () => (
                  <ElButton type="primary" icon={Upload}>
                    上传文件
                  </ElButton>
                ),
                default: () => (
                  <ElTable class={styles.fillTable} data={auditRows} height="100%">
                    <ElTableColumn prop="name" label="数据名称" showOverflowTooltip />
                    <ElTableColumn prop="applicant" label="申请人" width="100" />
                    <ElTableColumn prop="time" label="申请时间" width="170" />
                  </ElTable>
                ),
                footer: () => (
                  <ElPagination
                    total={136}
                    layout="total, prev, pager, next"
                    currentPage={page.value}
                    onUpdate:current-page={(value: number) => {
                      page.value = value;
                    }}
                  />
                )
              }}
            </MxPanel>
          </div>
          <div class={[styles.cell, styles.sideCells]}>
            <p class={styles.caption}>没有头部：内容区上方同样留 16</p>
            <MxPanel>
              <p class={styles.text}>菜单型左栏这类面板不写标题，也没有操作。</p>
            </MxPanel>
            <p class={styles.caption}>flush：内容区不留内边距</p>
            <MxPanel title="地图" flush>
              <div class={styles.mapPlaceholder}>内容贴边</div>
            </MxPanel>
          </div>
        </div>
      </div>
    );
  }
});
