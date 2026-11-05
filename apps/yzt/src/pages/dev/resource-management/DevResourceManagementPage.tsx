import { Connection } from '@element-plus/icons-vue';
import { MxPanel, MxSplitLayout } from '@mx/ui';
import { ElButton, ElMessage, ElOption, ElSelect } from 'element-plus';
import { defineComponent, ref } from 'vue';
import type { ResourceDirectory, ResourceRecord } from '@/features/resource-management/api';
import { DataApplicationDialog } from '@/features/resource-management/components/DataApplicationDialog';
import { DataExtractionDialog } from '@/features/resource-management/components/DataExtractionDialog';
import { ResourceDirectoryPanel } from '@/features/resource-management/components/ResourceDirectoryPanel';
import { ResourceServiceDialogs } from '@/features/resource-management/components/ResourceServiceDialogs';
import { ResourceTable } from '@/features/resource-management/components/ResourceTable';
import { useDataApplication } from '@/features/resource-management/composables/useDataApplication';
import { useDataExtraction } from '@/features/resource-management/composables/useDataExtraction';
import { useLayerServices } from '@/features/resource-management/composables/useLayerServices';
import { useLayerServiceStore } from '@/features/resource-management/store';
import { ApiError } from '@/shared/http/errors';
import styles from './preview.module.scss';

type ApplyScene = 'success' | 'error' | 'slow';

const APPLY_SCENES: [ApplyScene, string][] = [
  ['success', '成功'],
  ['error', '失败'],
  ['slow', '提交 3 秒后成功']
];

function row(id: string, name: string, year: number | null, datasetCode: string, layerCode: string): ResourceRecord {
  return {
    id,
    name,
    year,
    datasetName: '年度国土变更调查',
    resourceName: '土地资源',
    datasetCode,
    layerCode,
    hasSlice: true,
    enabled: true
  };
}

// 固定数据：能匹配可申请图层的、学校图层（格式多）、对不上的长名称、没有年份的
const ROWS: ResourceRecord[] = [
  row('demo-dltb', '地类图斑', 2022, 'bgdc', 'dltb'),
  row('demo-xxp', '学校点层', 2022, 'csxhjctb', 'xxp'),
  row('demo-long', '拆除未尽区（城市更新专项调查成果，超长名称演示换行与省略）', 2022, 'cxjc', 'cwjq'),
  row('demo-yearless', '城镇村等用地', null, 'bgdc', 'czcdyd')
];

const directories = (names: string[]): ResourceDirectory[] => names.map(name => ({ id: name, name }));

// 固定的目录，覆盖全部目录图标；前两项带别的目录的旧图标文件名，看按名称指定的图标是否生效
const DIRECTORIES: ResourceDirectory[] = [
  {
    id: '基础库',
    name: '基础库',
    children: [
      { id: '城市国土空间监测', name: '城市国土空间监测', icon: '土地资源@1x.png' },
      { id: '国土变更', name: '国土变更', icon: '土地资源@1x.png' },
      ...directories(['土地资源', '地质/矿产资源', '海洋资源', '水资源', '森林资源', '草原资源', '湿地资源', '荒漠', '国家公园'])
    ]
  },
  { id: '公共库', name: '公共库', children: directories(['气象', '水利', '生态']) },
  { id: '主题库', name: '主题库', children: directories(['生态保护区', '耕地保护区', '联合审批']) },
  { id: '三区三线', name: '三区三线', children: null }
];

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

/** 资源管理的组件样例：正式的目录树、资源表格、附属服务弹窗、自助取数和下载申请；不请求接口，申请的结果用演示选项决定 */
export const DevResourceManagementPage = defineComponent({
  name: 'DevResourceManagementPage',
  setup() {
    const services = useLayerServices();
    const store = useLayerServiceStore();
    const extraction = useDataExtraction();
    const applyScene = ref<ApplyScene>('success');
    const selectedDirectory = ref('城市国土空间监测');
    const application = useDataApplication(async () => {
      await wait(applyScene.value === 'slow' ? 3000 : 600);
      if (applyScene.value === 'error') {
        throw new ApiError({ kind: 'business', message: '演示：申请提交失败，请重试' });
      }
    });

    // 第一行的两类各 12 条，名称和地址都很长，用来看列表滚动和换行
    function fillServices() {
      for (let index = 1; index <= 12; index += 1) {
        store.save(ROWS[0].id, 'map', {
          name: `年度国土变更调查地类图斑矢量切片服务（第 ${index} 期，长名称演示）`,
          type: index % 2 === 0 ? 'MVT' : 'WMS',
          url: `https://example.invalid/geoserver/bgdc/wms?service=WMS&version=1.3.0&layers=bgdc:dltb_part_${index}`,
          status: index % 3 === 0 ? 'disabled' : 'enabled'
        });
        store.save(ROWS[0].id, 'interface', {
          name: `地类图斑属性查询接口 ${index}`,
          type: index % 2 === 0 ? 'RESTful' : 'JSON',
          url: `https://example.invalid/api/query/attr/page?layer=bgdc_dltb_2022&page=${index}`,
          status: 'enabled'
        });
      }
    }

    function renderHeader() {
      return (
        <header class={styles.header}>
          <h1>资源管理 · 组件样例</h1>
          <p class={styles.hint}>
            正式的目录树、资源表格、地图服务与数据接口弹窗、自助取数和下载申请。目录是固定数据、不能维护；服务记录本来就只在内存里；自助取数没有接口；下载申请不发请求，结果按下面的选项演示。
          </p>
          <div class={styles.controls}>
            <ElButton size="small" onClick={fillServices}>
              第一行载入 12 项服务和接口
            </ElButton>
            <ElButton size="small" onClick={store.reset}>
              清空服务记录
            </ElButton>
            <label>下载申请的结果</label>
            <ElSelect
              modelValue={applyScene.value}
              onUpdate:modelValue={(value: ApplyScene) => (applyScene.value = value)}
              size="small"
              aria-label="下载申请的结果"
            >
              {APPLY_SCENES.map(([value, label]) => <ElOption key={value} value={value} label={label} />)}
            </ElSelect>
          </div>
        </header>
      );
    }

    return () => (
      <main class={styles.page}>
        {renderHeader()}
        <div class={styles.workspace}>
          <MxSplitLayout asideLabel="资源目录">
            {{
              aside: () => (
                <MxPanel headerTone="muted" title="资源目录">
                  <ResourceDirectoryPanel
                    nodes={DIRECTORIES}
                    selected={selectedDirectory.value}
                    maintenanceDisabled
                    onSelect={(id: string) => (selectedDirectory.value = id)}
                  />
                </MxPanel>
              ),
              default: () => (
                <MxPanel headerTone="muted" title="资源列表" description="组件样例">
                  {{
                    actions: () => (
                      <ElButton type="primary" icon={Connection} onClick={extraction.start}>
                        自助取数
                      </ElButton>
                    ),
                    default: () => (
                      <ResourceTable
                        rows={ROWS}
                        selected
                        statusPending={() => false}
                        serviceCount={services.count}
                        onToggle={() => ElMessage.info('样例不启停图层')}
                        onView={() => ElMessage.info('样例不打开详情')}
                        onRetry={() => undefined}
                        onApply={application.start}
                        onListServices={services.openList}
                        onAddService={services.openForm}
                      />
                    )
                  }}
                </MxPanel>
              )
            }}
          </MxSplitLayout>
        </div>
        <ResourceServiceDialogs owner={services} />
        <DataExtractionDialog owner={extraction} />
        <DataApplicationDialog owner={application} />
      </main>
    );
  }
});
