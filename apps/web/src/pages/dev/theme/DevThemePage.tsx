import { Delete, Download, Plus, Refresh, RefreshLeft, Search, Upload } from '@element-plus/icons-vue';
import {
  ElAlert,
  ElButton,
  ElCheckbox,
  ElDatePicker,
  ElForm,
  ElFormItem,
  ElInput,
  ElLink,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElPagination,
  ElRadio,
  ElRadioGroup,
  ElSelect,
  ElSwitch,
  ElTable,
  ElTableColumn,
  ElTag,
  ElTree
} from 'element-plus';
import { defineComponent, onMounted, ref } from 'vue';
import { iconNames, SvgIcon } from '@/shared/icons/SvgIcon';
import { QueryForm } from '@/shared/query-form/QueryForm';
import { SystemTitle } from '@/shared/system-title/SystemTitle';
import styles from './DevThemePage.module.scss';
import { PanelPreview, SectionPreview, SplitLayoutPreview, TitlePreview } from './UiComponentsPreview';

interface IndicatorRow {
  region: string;
  indicator: string;
  status: '处理完成' | '正在处理' | '计算失败';
  // 空值演示：null 和空字符串都显示为"-"
  remark: string | null;
}

// 令牌名不含 --color- 前缀
const colorGroups = [
  {
    title: '主题色',
    names: [
      'primary',
      'primary-hover',
      'primary-border',
      'primary-border-hover',
      'primary-bg',
      'primary-bg-light',
      'primary-bg-lighter'
    ]
  },
  {
    title: '文本',
    names: [
      'text-title',
      'text-strong',
      'text-primary',
      'text-regular',
      'text-secondary',
      'text-placeholder',
      'text-disabled'
    ]
  },
  {
    title: '边框与背景',
    names: ['border', 'border-light', 'border-dashed', 'divider', 'bg-page', 'bg-container', 'neutral-bg']
  },
  {
    title: '功能色',
    names: ['info', 'info-bg', 'success', 'success-bg', 'warning', 'warning-bg', 'danger', 'danger-bg', 'neutral']
  }
];

const fontSizes = [
  { name: 'display', usage: '结果数值', weight: 'bold' },
  { name: 'lg', usage: '面板标题', weight: 'semibold' },
  { name: 'base', usage: '正文', weight: 'regular' },
  { name: 'xs', usage: '辅助文字', weight: 'regular' },
  { name: 'xxs', usage: '极小文字', weight: 'regular' }
];

// 只加载了 400 和 600 两个字重，500、700 按 CSS 字重匹配规则分别显示为 400、600
const fontWeights = [
  { weight: 400, note: '常规' },
  { weight: 500, note: '按 400 显示' },
  { weight: 600, note: '半粗' },
  { weight: 700, note: '按 600 显示' }
];

const buttonTypes = ['primary', 'success', 'warning', 'danger', 'info'] as const;

// 操作按钮的图标，规范见 docs/design/page-layout.md 的"操作按钮"
const actionButtons = [
  { label: '查询', icon: Search },
  { label: '重置', icon: RefreshLeft },
  { label: '刷新', icon: Refresh },
  { label: '新增', icon: Plus },
  { label: '上传', icon: Upload },
  { label: '下载', icon: Download },
  { label: '批量删除', icon: Delete }
];

// 查询表单的示例：三个条件在不同宽度下的三种排布
const queryFormDemos = [
  { width: 1100, note: '条件和按钮都放得下一行' },
  { width: 900, note: '条件放得下一行，按钮另起一行' },
  { width: 760, note: '条件放不下，换行并统一标签宽度' },
  { width: 480, note: '每行一个条件' }
];
const queryFormLabels = ['文档名称', '年份', '业务类型标签'];

interface TreeSample {
  id: string;
  label: string;
  children?: TreeSample[];
}

// 三层，分组出现在第一、二层，叶子出现在第二、三层；ElTree 会在节点数据上写入标记，不能声明为 readonly
const treeSamples: TreeSample[] = [
  {
    id: 'survey',
    label: '自然资源调查',
    children: [
      {
        id: 'land',
        label: '国土调查',
        children: [
          { id: 'land-annual', label: '年度变更调查' },
          { id: 'land-special', label: '专项调查' }
        ]
      },
      { id: 'forest', label: '森林资源调查' }
    ]
  },
  {
    id: 'monitor',
    label: '监测评价',
    children: [
      { id: 'monitor-dynamic', label: '动态监测' },
      { id: 'monitor-report', label: '评价报告' }
    ]
  },
  { id: 'other', label: '其他' }
];

const tableRows: IndicatorRow[] = [
  { region: '南京市', indicator: '城镇开发边界面积', status: '处理完成', remark: '按 2025 年变更调查口径' },
  { region: '苏州市', indicator: '耕地保有量', status: '正在处理', remark: null },
  { region: '无锡市', indicator: '生态保护红线面积', status: '计算失败', remark: '' }
];

const statusTagTypes = {
  处理完成: 'success',
  正在处理: 'primary',
  计算失败: 'danger'
} as const;

// 同时用于检查 ElMessageBox 这类函数式调用的组件能否拿到中文语言包
async function confirmDelete() {
  try {
    await ElMessageBox.confirm('确认删除这条记录吗？', '提示', { type: 'warning' });
    ElMessage.success('已删除');
  } catch {
    ElMessage.info('已取消');
  }
}

/** 主题预览：检查设计令牌与 Element Plus 主题映射的效果 */
export const DevThemePage = defineComponent({
  name: 'DevThemePage',
  setup() {
    const resolvedColors = ref<Record<string, string>>({});
    const keyword = ref('');
    const city = ref('');
    const checked = ref(true);
    const period = ref('year');
    const enabled = ref(true);
    const date = ref('');
    const currentPage = ref(1);

    // 显示浏览器实际解析到的值，确认令牌确实输出到了 :root
    onMounted(() => {
      const rootStyle = getComputedStyle(document.documentElement);
      const names = colorGroups.flatMap(group => group.names);
      resolvedColors.value = Object.fromEntries(
        names.map(name => [name, rootStyle.getPropertyValue(`--color-${name}`).trim()])
      );
    });

    return () => (
      <div class={styles.root}>
        <h1 class={styles.systemTitle}>
          <SystemTitle />
        </h1>

        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>色板</h2>
          {colorGroups.map(group => (
            <div key={group.title} class={styles.group}>
              <h3 class={styles.groupTitle}>{group.title}</h3>
              <div class={styles.swatches}>
                {group.names.map(name => (
                  <div key={name} class={styles.swatch}>
                    <div class={styles.swatchColor} style={{ background: `var(--color-${name})` }} />
                    <div class={styles.swatchName}>{name}</div>
                    <div class={styles.swatchValue}>{resolvedColors.value[name]}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>字号与字重</h2>
          {fontSizes.map(({ name, usage, weight }) => (
            <p
              key={name}
              class={styles.fontSample}
              style={{ fontSize: `var(--font-size-${name})`, fontWeight: `var(--font-weight-${weight})` }}
            >
              {name} · {usage} · 城市国土空间监测指标 1234
            </p>
          ))}
          <div class={styles.row}>
            {fontWeights.map(({ weight, note }) => (
              <span key={weight} data-weight={weight} style={{ fontWeight: weight }}>
                {weight} {note} 国土空间监测
              </span>
            ))}
          </div>
        </section>

        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>阴影</h2>
          <div class={styles.shadows}>
            {['sm', 'md', 'lg', 'primary-lg'].map(size => (
              <div key={size} class={styles.shadowCard} style={{ boxShadow: `var(--shadow-${size})` }}>
                shadow-{size}
              </div>
            ))}
          </div>
        </section>

        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>间距与圆角</h2>
          <div class={styles.spaces}>
            {['xs', 'sm', 'md', 'lg', 'xl'].map(size => (
              <div key={size} class={styles.space}>
                <span class={styles.spaceBar} style={{ width: `var(--space-${size})` }} />
                space-{size}
              </div>
            ))}
          </div>
          <div class={styles.radii}>
            {['sm', 'md', 'lg', 'xl'].map(size => (
              <div key={size} class={styles.radius} style={{ borderRadius: `var(--radius-${size})` }}>
                radius-{size}
              </div>
            ))}
          </div>
        </section>

        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>图标</h2>
          <div class={styles.icons}>
            {iconNames.map(name => (
              <div key={name} class={styles.iconItem}>
                <SvgIcon name={name} size={24} />
                <span class={styles.iconName}>{name}</span>
              </div>
            ))}
          </div>
          <div class={styles.row}>
            <span class={styles.iconDemo}>
              <SvgIcon name="nav-current-map" /> 默认 1em，跟随文字颜色
            </span>
            <span class={styles.iconDemoPrimary}>
              <SvgIcon name="nav-current-map" size={20} /> 父元素 color 为主色
            </span>
            <SvgIcon name="nav-files" size={20} color="var(--color-danger)" title="文件管理" />
            <span class={styles.iconDemoOnDark}>
              <SvgIcon name="nav-arrow-color" size={16} /> 多色，保留原色
            </span>
            <span class={styles.iconDemoOnDark}>
              <SvgIcon name="nav-arrow-color" size={16} rotate={-90} /> rotate
            </span>
          </div>
        </section>

        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>按钮</h2>
          <div class={styles.row}>
            <ElButton>默认</ElButton>
            {buttonTypes.map(type => (
              <ElButton key={type} type={type}>{type}</ElButton>
            ))}
          </div>
          <div class={styles.row}>
            <ElButton plain>默认</ElButton>
            {buttonTypes.map(type => (
              <ElButton key={type} type={type} plain>{type}</ElButton>
            ))}
          </div>
          <div class={styles.row}>
            <ElButton disabled>默认</ElButton>
            {buttonTypes.map(type => (
              <ElButton key={type} type={type} disabled>{type}</ElButton>
            ))}
          </div>
          <div class={styles.row}>
            {buttonTypes.map(type => (
              <ElLink key={type} type={type}>链接 {type}</ElLink>
            ))}
            <ElButton type="primary" text>文字按钮</ElButton>
          </div>
          <div class={styles.row}>
            {actionButtons.map(({ label, icon }) => (
              <ElButton key={label} icon={icon}>
                {label}
              </ElButton>
            ))}
          </div>
        </section>

        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>表单</h2>
          <div class={styles.row}>
            <ElInput
              class={styles.field}
              modelValue={keyword.value}
              onUpdate:modelValue={(value: string) => {
                keyword.value = value;
              }}
              placeholder="请输入关键字"
              prefixIcon={Search}
              clearable
            />
            <ElInput class={styles.field} modelValue="禁用状态" disabled />
            <ElSelect
              class={styles.field}
              modelValue={city.value}
              onUpdate:modelValue={(value: string) => {
                city.value = value;
              }}
              placeholder="请选择行政区"
            >
              {tableRows.map(({ region }) => (
                <ElOption key={region} label={region} value={region} />
              ))}
            </ElSelect>
            <ElDatePicker
              modelValue={date.value}
              onUpdate:modelValue={(value: string) => {
                date.value = value;
              }}
              type="date"
              valueFormat="YYYY-MM-DD"
              placeholder="选择日期"
            />
          </div>
          <div class={styles.row}>
            <ElCheckbox
              modelValue={checked.value}
              onUpdate:modelValue={(value: string | number | boolean) => {
                checked.value = value === true;
              }}
            >
              显示图例
            </ElCheckbox>
            <ElRadioGroup
              modelValue={period.value}
              onUpdate:modelValue={(value: string | number | boolean | undefined) => {
                period.value = String(value);
              }}
            >
              <ElRadio value="year">按年</ElRadio>
              <ElRadio value="quarter">按季度</ElRadio>
            </ElRadioGroup>
            <ElSwitch
              modelValue={enabled.value}
              onUpdate:modelValue={(value: string | number | boolean) => {
                enabled.value = value === true;
              }}
            />
          </div>
        </section>

        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>填充输入框与加大号按钮（登录页）</h2>
          <div class={styles.filledPanel}>
            <ElForm class={styles.filledForm}>
              <ElFormItem>
                <ElInput class="input-filled" placeholder="请输入账号">
                  {{ prefix: () => <SvgIcon name="auth-user" size={18} /> }}
                </ElInput>
              </ElFormItem>
              <ElFormItem>
                <ElInput class="input-filled" modelValue="admin">
                  {{ prefix: () => <SvgIcon name="auth-user" size={18} /> }}
                </ElInput>
              </ElFormItem>
              <ElFormItem>
                <ElInput class="input-filled" modelValue="password" type="password" showPassword>
                  {{ prefix: () => <SvgIcon name="auth-lock" size={18} /> }}
                </ElInput>
              </ElFormItem>
              <ElFormItem error="请输入密码">
                <ElInput class="input-filled" type="password" placeholder="校验失败">
                  {{ prefix: () => <SvgIcon name="auth-lock" size={18} /> }}
                </ElInput>
              </ElFormItem>
              <ElButton class="button-xl" type="primary" autoInsertSpace>
                登录
              </ElButton>
              <ElButton class="button-xl" type="primary" loading autoInsertSpace>
                登录
              </ElButton>
            </ElForm>
          </div>
        </section>

        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>查询表单（QueryForm）</h2>
          {queryFormDemos.map(({ width, note }) => (
            <div key={note} class={styles.queryFrame} style={{ width: `${width}px` }}>
              <p class={styles.frameLabel}>
                宽 {width}，{note}
              </p>
              <QueryForm labelChars={6}>
                {{
                  default: () =>
                    queryFormLabels.map(label => (
                      <ElFormItem key={label} label={label}>
                        {label === '年份' ? (
                          <ElDatePicker type="year" placeholder="全部" />
                        ) : (
                          <ElInput placeholder={`请输入${label}`} />
                        )}
                      </ElFormItem>
                    )),
                  actions: () => [
                    <ElButton type="primary" icon={Search}>
                      查询
                    </ElButton>,
                    <ElButton icon={RefreshLeft}>重置</ElButton>
                  ],
                  extra: () => (
                    <ElButton type="primary" icon={Upload}>
                      上传文档
                    </ElButton>
                  )
                }}
              </QueryForm>
            </div>
          ))}
        </section>

        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>标签与提示</h2>
          <div class={styles.row}>
            {buttonTypes.map(type => (
              <ElTag key={type} type={type}>{type}</ElTag>
            ))}
          </div>
          <div class={styles.row}>
            {buttonTypes.map(type => (
              <ElTag key={type} type={type} effect="plain">{type}</ElTag>
            ))}
          </div>
          <div class={styles.alerts}>
            <ElAlert title="计算完成" type="success" showIcon />
            <ElAlert title="数据待计算" type="info" showIcon />
            <ElAlert title="部分图层缺少数据" type="warning" showIcon />
            <ElAlert title="计算失败" type="error" showIcon />
          </div>
          <div class={styles.row}>
            <ElButton onClick={() => ElMessage.success('保存成功')}>成功消息</ElButton>
            <ElButton onClick={() => ElMessage.warning('请先选择图层')}>警告消息</ElButton>
            <ElButton onClick={() => ElMessage.error('请求失败')}>错误消息</ElButton>
            <ElButton onClick={() => ElMessage.info('暂无数据')}>普通消息</ElButton>
            <ElButton type="danger" onClick={() => void confirmDelete()}>确认框</ElButton>
          </div>
        </section>

        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>树</h2>
          <div class={styles.treeBox}>
            <ElTree
              data={treeSamples}
              nodeKey="id"
              highlightCurrent
              currentNodeKey="land-annual"
              defaultExpandedKeys={['survey', 'land', 'monitor']}
            />
          </div>
        </section>

        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>表格与分页</h2>
          <ElTable data={tableRows}>
            <ElTableColumn prop="region" label="行政区" />
            <ElTableColumn prop="indicator" label="指标" />
            <ElTableColumn label="状态">
              {{
                default: ({ row }: { row: IndicatorRow }) => (
                  <ElTag type={statusTagTypes[row.status]}>{row.status}</ElTag>
                )
              }}
            </ElTableColumn>
            <ElTableColumn prop="remark" label="备注" showOverflowTooltip />
          </ElTable>
          <ElPagination
            class={styles.pagination}
            currentPage={currentPage.value}
            onUpdate:current-page={(value: number) => {
              currentPage.value = value;
            }}
            total={50}
            layout="total, prev, pager, next, jumper"
          />
        </section>

        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>标题（@yzt/ui 的 MxTitle）</h2>
          <TitlePreview />
        </section>

        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>区块（@yzt/ui 的 MxSection）</h2>
          <SectionPreview />
        </section>

        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>面板（@yzt/ui 的 MxPanel）</h2>
          <PanelPreview />
        </section>

        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>分栏布局（@yzt/ui 的 MxSplitLayout，视口窄于 1200 时侧栏收进抽屉）</h2>
          <SplitLayoutPreview />
        </section>
      </div>
    );
  }
});
