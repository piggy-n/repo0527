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
  ElTableColumn,
  ElTree
} from 'element-plus';
import { defineComponent, ref } from 'vue';
import { MxPanel, MxSection, MxSplitLayout, MxTitle, useSplitLayout } from '@yzt/ui';
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

const reportTables = ['土地利用现状分类面积汇总表', '耕地种植属性统计表', '城镇村及工矿用地统计表'];

/** libs/ui 的区块：面板里连续的区块，标题与内容之间 12，区块之间 16 */
export const SectionPreview = defineComponent({
  name: 'SectionPreview',
  setup() {
    const checked = ref(reportTables.slice(0, 2));
    const toggle = (table: string, value: boolean) => {
      checked.value = value ? [...checked.value, table] : checked.value.filter(item => item !== table);
    };

    return () => (
      <div class={styles.sectionDemo}>
        <MxPanel title="统计报表计算">
          <MxSection title="年份选择">
            <label class={styles.field}>
              监测数据年度
              <ElDatePicker class={styles.year} type="year" modelValue="2025" valueFormat="YYYY" clearable={false} />
            </label>
          </MxSection>
          <MxSection title="选择表">
            {{
              extra: () => <ElCheckbox modelValue={checked.value.length === reportTables.length}>全选</ElCheckbox>,
              default: () => (
                <div class={styles.checkList}>
                  {reportTables.map(table => (
                    <ElCheckbox
                      key={table}
                      modelValue={checked.value.includes(table)}
                      onUpdate:modelValue={value => toggle(table, Boolean(value))}
                    >
                      {table}
                    </ElCheckbox>
                  ))}
                </div>
              )
            }}
          </MxSection>
          <MxSection title="处理进度">
            {{
              icon: () => (
                <ElIcon>
                  <Timer />
                </ElIcon>
              ),
              default: () => <p class={styles.text}>3 张报表已提交，等待计算</p>
            }}
          </MxSection>
        </MxPanel>
        <ul class={styles.notes}>
          <li>区块标题与内容之间：--space-md（12）</li>
          <li>相邻区块之间：--space-lg（16），只在两个 MxSection 相邻时生效</li>
          <li>标题与内容放在 section 里，标题渲染为 h3</li>
        </ul>
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

interface DirectoryNode {
  id: string;
  label: string;
  children?: DirectoryNode[];
}

// 旧项目文件管理的目录结构
const directories: DirectoryNode[] = [
  ['技术标准规范', ['国家/行业现行技术规程、标准、规范', '地方补充技术规定/细则']],
  ['设计与报告', ['项目（技术）设计类', '项目（技术）总结类', '专题报告']],
  ['政策法规', ['国家层面政策法规', '地方层面政策法规']],
  ['政务公文', ['通知', '公报']]
].map(([label, groups]) => ({
  id: String(label),
  label: String(label),
  children: (groups as string[]).map(group => ({
    id: group,
    label: group,
    children: ['自然资源调查类', '监测类', '数据库类', '其他'].map(leaf => ({ id: `${group}/${leaf}`, label: leaf }))
  }))
}));

// 侧栏里的目录树：选中叶子节点后，窄屏时关闭抽屉
const DirectoryTree = defineComponent({
  name: 'DirectoryTree',
  emits: { select: (_label: string) => true },
  setup(_, { emit }) {
    const { compact, closeAside } = useSplitLayout();
    // ElTree 传入的节点数据类型是 Record<string, any>，这里只声明用到的字段再收窄
    const select = (node: { label?: unknown; children?: unknown }) => {
      if (node.children || typeof node.label !== 'string') {
        return;
      }
      emit('select', node.label);
      if (compact.value) {
        closeAside();
      }
    };
    return () => (
      <ElTree
        data={directories}
        nodeKey="id"
        defaultExpandAll
        highlightCurrent
        onNode-click={select}
      />
    );
  }
});

/** libs/ui 的分栏布局：侧栏 320，窄屏（视口 < 1200）时侧栏收进抽屉 */
export const SplitLayoutPreview = defineComponent({
  name: 'SplitLayoutPreview',
  setup() {
    const directory = ref('自然资源调查类');
    return () => (
      <div class={styles.layoutDemo}>
        <MxSplitLayout asideLabel="文件目录">
          {{
            aside: () => (
              <MxPanel title="文件目录">
                <DirectoryTree
                  onSelect={label => {
                    directory.value = label;
                  }}
                />
              </MxPanel>
            ),
            default: () => (
              <MxPanel title={directory.value} asideToggle>
                {{
                  actions: () => (
                    <ElButton type="primary" icon={Upload}>
                      上传文件
                    </ElButton>
                  ),
                  default: () => (
                    <ElTable class={styles.fillTable} data={auditRows} height="100%">
                      <ElTableColumn prop="name" label="文档名称" showOverflowTooltip />
                      <ElTableColumn prop="time" label="上传时间" width="170" />
                    </ElTable>
                  ),
                  footer: () => <ElPagination total={128} layout="total, prev, pager, next" />
                }}
              </MxPanel>
            )
          }}
        </MxSplitLayout>
      </div>
    );
  }
});
