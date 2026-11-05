import { MxPanel, MxSplitLayout } from '@mx/ui';
import { ElButton, ElMessage, ElOption, ElPagination, ElSelect } from 'element-plus';
import { computed, defineComponent } from 'vue';
import type { Application } from '@/features/data-application/api';
import { ApplicationDialog } from '@/features/data-application/components/ApplicationDialog';
import { ApplicationFilterBar } from '@/features/data-application/components/ApplicationFilterBar';
import { ApplicationTable } from '@/features/data-application/components/ApplicationTable';
import { auditOpenLabel } from '@/features/data-application/status';
import { ReportFilterBar } from '@/features/statistics-report/components/ReportFilterBar';
import { ReportTable } from '@/features/statistics-report/components/ReportTable';
import { RouteName } from '@/shared/router/route-names';
import { SideNav, type SideNavItem } from '@/shared/side-nav/SideNav';
import styles from './preview.module.scss';
import {
  type ListScene,
  type SubmitScene,
  type SystemSection,
  useSystemManagementDemo,
  type Viewer
} from './useSystemManagementDemo';

const VIEWERS: [Viewer, string][] = [
  ['admin', '管理员'],
  ['user', '普通用户']
];
const LIST_SCENES: [ListScene, string][] = [
  ['normal', '正常'],
  ['loading', '首次加载'],
  ['refreshing', '刷新中（遮罩）'],
  ['error', '加载失败'],
  ['empty', '没有数据']
];
const SUBMIT_SCENES: [SubmitScene, string][] = [
  ['success', '成功'],
  ['error', '失败'],
  ['slow', '3 秒后成功']
];

// 和正式页面相同；菜单项链接到真实的页面。两种角色的差别都写在这里，组件只按属性显示
interface ViewerPage {
  title: string;
  listTitle: string;
  nav: SideNavItem[];
  listPath: string;
  reportsPath: string;
  nameLabel: string;
  showApplicant: boolean;
  openLabel: (application: Application) => string;
}

const PAGES: Record<Viewer, ViewerPage> = {
  admin: {
    title: '系统管理',
    listTitle: '资源审核',
    nav: [
      { label: '资源审核', icon: 'menu-audit', route: RouteName.systemManagement },
      { label: '统计报表', icon: 'menu-report', route: RouteName.systemManagementReports }
    ],
    listPath: '/system-management',
    reportsPath: '/system-management/statistical-report',
    nameLabel: '数据名称',
    showApplicant: true,
    openLabel: auditOpenLabel
  },
  user: {
    title: '数据下载',
    listTitle: '数据列表',
    nav: [
      { label: '数据列表', icon: 'menu-list', route: RouteName.resourceApplication },
      { label: '统计报表', icon: 'menu-report', route: RouteName.resourceApplicationReports }
    ],
    listPath: '/resource-application',
    reportsPath: '/resource-application/statistical-report',
    nameLabel: '资源名称',
    showApplicant: false,
    openLabel: () => '查看'
  }
};

const PAGE_SIZES = [10, 20, 50, 100];

// 演示选项：一个标签加一个小号下拉
function renderOption<T extends string>(label: string, value: T, options: [T, string][], update: (value: T) => void) {
  return (
    <div class={styles.control}>
      <span>{label}</span>
      <ElSelect modelValue={value} onUpdate:modelValue={update} size="small" aria-label={label}>
        {options.map(([key, text]) => (
          <ElOption key={key} value={key} label={text} />
        ))}
      </ElSelect>
    </div>
  );
}

/** 系统管理和数据下载的组件样例：和正式页面相同的布局与正式组件（筛选栏、表格、详情与审核弹窗、分页），数据固定，不请求接口 */
export const DevSystemManagementPage = defineComponent({
  name: 'DevSystemManagementPage',
  setup() {
    const demo = useSystemManagementDemo();
    const page = computed(() => PAGES[demo.viewer.value]);
    const sections = computed<[SystemSection, string][]>(() => [
      ['audit', page.value.listTitle],
      ['reports', '统计报表']
    ]);
    const address = computed(() => {
      const path = demo.section.value === 'audit' ? page.value.listPath : page.value.reportsPath;
      const id = demo.review.state.value === 'closed' ? null : demo.review.application.value?.id;
      return id ? `${path}?apply=${id}` : path;
    });

    async function download(id: string) {
      if (await demo.downloads.start(id)) {
        ElMessage.success('已交给浏览器下载');
      }
    }

    function renderPagination(pager: typeof demo.audit.pager, total: number) {
      return (
        <ElPagination
          class="pagination-wrap"
          currentPage={pager.pageNum.value}
          pageSize={pager.pageSize.value}
          total={total}
          pageSizes={PAGE_SIZES}
          pagerCount={5}
          layout="total, sizes, prev, pager, next, jumper"
          onUpdate:current-page={(value: number) => {
            pager.pageNum.value = value;
          }}
          onUpdate:page-size={pager.changePageSize}
        />
      );
    }

    function renderApplications() {
      const { audit, listScene } = demo;
      const current = page.value;
      return (
        // 换角色相当于换了一个页面：按角色重建，表格的列不用在原地增减
        <MxPanel key={demo.viewer.value} headerTone="muted" title={current.listTitle}>
          {{
            default: () => [
              <ApplicationFilterBar
                class={styles.filters}
                model={audit.form}
                nameLabel={current.nameLabel}
                onSearch={audit.search}
                onReset={audit.reset}
              />,
              <ApplicationTable
                applications={audit.rows.value}
                firstSerial={audit.pager.firstSerial.value}
                initialLoading={listScene.value === 'loading'}
                refreshing={listScene.value === 'refreshing'}
                error={listScene.value === 'error'}
                nameLabel={current.nameLabel}
                showApplicant={current.showApplicant}
                openLabel={current.openLabel}
                onRetry={() => {
                  listScene.value = 'normal';
                }}
                onOpen={application => void demo.open(application.id)}
                downloads={demo.downloads.state}
                onDownload={application => void download(application.id)}
              />,
              <ApplicationDialog
                owner={demo.review}
                downloads={demo.downloads.state}
                showApplicant={current.showApplicant}
                onClose={demo.close}
                onDownload={application => void download(application.id)}
              />
            ],
            footer: () => renderPagination(audit.pager, audit.total.value)
          }}
        </MxPanel>
      );
    }

    function renderReports() {
      const { reports, listScene } = demo;
      return (
        <MxPanel headerTone="muted" title="统计报表">
          {{
            default: () => [
              <ReportFilterBar
                class={styles.filters}
                model={reports.form}
                onSearch={reports.search}
                onReset={reports.reset}
              />,
              <ReportTable
                reports={reports.rows.value}
                firstSerial={reports.pager.firstSerial.value}
                initialLoading={listScene.value === 'loading'}
                refreshing={listScene.value === 'refreshing'}
                error={listScene.value === 'error'}
                onRetry={() => {
                  listScene.value = 'normal';
                }}
                downloads={demo.downloads.state}
                onDownload={report => void download(report.id)}
              />
            ],
            footer: () => renderPagination(reports.pager, reports.total.value)
          }}
        </MxPanel>
      );
    }

    // 演示选项可以收起，窄屏时给页面留出高度
    function renderHeader() {
      return (
        <header class={styles.header}>
          <h1>{page.value.title} · 组件样例</h1>
          <p class={styles.hint}>
            布局、页面内菜单、筛选栏、表格、详情与审核弹窗都是正式组件；数据固定，审核和下载只在内存里演示。左侧菜单链接到真实页面，
            这里用"栏目"切换。正式页面的地址：<code>{address.value}</code>
          </p>
          <details class={styles.options} open>
            <summary>演示选项</summary>
            <div class={styles.controls}>
              {renderOption('角色', demo.viewer.value, VIEWERS, demo.switchViewer)}
              {renderOption('栏目', demo.section.value, sections.value, value => {
                demo.section.value = value;
              })}
              {renderOption('列表状态', demo.listScene.value, LIST_SCENES, value => {
                demo.listScene.value = value;
              })}
              {demo.viewer.value === 'admin' &&
                renderOption('审核提交', demo.submitScene.value, SUBMIT_SCENES, value => {
                  demo.submitScene.value = value;
                })}
              <ElButton size="small" onClick={() => void demo.open('apply-001', 1000)}>
                从消息打开待审核的申请
              </ElButton>
              <ElButton size="small" onClick={() => void demo.open('apply-006', 1000)}>
                从消息打开已退回的申请
              </ElButton>
            </div>
          </details>
        </header>
      );
    }

    return () => (
      <main class={styles.page}>
        {renderHeader()}
        <div class={styles.workspace}>
          <MxSplitLayout asideType="menu" asideLabel={page.value.title}>
            {{
              aside: () => (
                <MxPanel flush headerTone="muted" title={page.value.title}>
                  <SideNav label={page.value.title} items={page.value.nav} />
                </MxPanel>
              ),
              default: () => (demo.section.value === 'audit' ? renderApplications() : renderReports())
            }}
          </MxSplitLayout>
        </div>
      </main>
    );
  }
});
