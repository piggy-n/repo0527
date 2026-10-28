import { MxPanel, MxSplitLayout } from '@yzt/ui';
import { ElButton, ElMessage, ElOption, ElPagination, ElSelect } from 'element-plus';
import { computed, defineComponent } from 'vue';
import { ApplicationDialog } from '@/features/data-application/components/ApplicationDialog';
import { ApplicationFilterBar } from '@/features/data-application/components/ApplicationFilterBar';
import { ApplicationTable } from '@/features/data-application/components/ApplicationTable';
import { ReportFilterBar } from '@/features/statistics-report/components/ReportFilterBar';
import { ReportTable } from '@/features/statistics-report/components/ReportTable';
import { RouteName } from '@/shared/router/route-names';
import { SideNav, type SideNavItem } from '@/shared/side-nav/SideNav';
import styles from './preview.module.scss';
import { type ListScene, type SubmitScene, type SystemSection, useSystemManagementDemo } from './useSystemManagementDemo';

const SECTIONS: [SystemSection, string][] = [
  ['audit', '资源审核'],
  ['reports', '统计报表']
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

// 和正式页面相同；菜单项链接到真实的页面
const NAV_ITEMS: SideNavItem[] = [
  { label: '资源审核', icon: 'menu-audit', route: RouteName.systemManagement },
  { label: '统计报表', icon: 'menu-report', route: RouteName.systemManagementReports }
];

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

/** 系统管理的组件样例：和正式页面相同的布局与正式组件（筛选栏、表格、详情与审核弹窗、分页），数据固定，不请求接口 */
export const DevSystemManagementPage = defineComponent({
  name: 'DevSystemManagementPage',
  setup() {
    const demo = useSystemManagementDemo();
    const address = computed(() => {
      const path = demo.section.value === 'audit' ? '/system-management' : '/system-management/statistical-report';
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
          onUpdate:current-page={(page: number) => {
            pager.pageNum.value = page;
          }}
          onUpdate:page-size={pager.changePageSize}
        />
      );
    }

    function renderAudit() {
      const { audit, listScene } = demo;
      return (
        <MxPanel headerTone="muted" title="资源审核">
          {{
            default: () => [
              <ApplicationFilterBar
                class={styles.filters}
                model={audit.form}
                onSearch={audit.search}
                onReset={audit.reset}
              />,
              <ApplicationTable
                applications={audit.rows.value}
                firstSerial={audit.pager.firstSerial.value}
                initialLoading={listScene.value === 'loading'}
                refreshing={listScene.value === 'refreshing'}
                error={listScene.value === 'error'}
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
          <h1>系统管理 · 组件样例</h1>
          <p class={styles.hint}>
            布局、页面内菜单、筛选栏、表格、详情与审核弹窗都是正式组件；数据固定，审核和下载只在内存里演示。左侧菜单链接到真实页面，
            这里用"栏目"切换。正式页面的地址：<code>{address.value}</code>
          </p>
          <details class={styles.options} open>
            <summary>演示选项</summary>
            <div class={styles.controls}>
              {renderOption('栏目', demo.section.value, SECTIONS, value => {
                demo.section.value = value;
              })}
              {renderOption('列表状态', demo.listScene.value, LIST_SCENES, value => {
                demo.listScene.value = value;
              })}
              {renderOption('审核提交', demo.submitScene.value, SUBMIT_SCENES, value => {
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
          <MxSplitLayout asideType="menu" asideLabel="系统管理">
            {{
              aside: () => (
                <MxPanel flush>
                  <SideNav label="系统管理" items={NAV_ITEMS} />
                </MxPanel>
              ),
              default: () => (demo.section.value === 'audit' ? renderAudit() : renderReports())
            }}
          </MxSplitLayout>
        </div>
      </main>
    );
  }
});
