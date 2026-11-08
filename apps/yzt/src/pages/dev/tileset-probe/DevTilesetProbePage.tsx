import { MAP_RUNTIME } from '@mx/map-vue';
import { ElButton, ElInputNumber, ElOption, ElRadioButton, ElRadioGroup, ElSelect } from 'element-plus';
import { computed, defineComponent, inject, ref, type VNode, watch } from 'vue';
import { MODEL_KIND_LABELS, type SceneModel } from '@/features/scene-models/catalog';
import { useSceneModelsQuery } from '@/features/scene-models/queries';
import { saveFile } from '@/shared/file-transfer';
import { type ProbeMode, type ProbeReportFiles, summarizeInspection } from './probe-report';
import { type ProbePhase, useTilesetProbe } from './useTilesetProbe';
import styles from './DevTilesetProbePage.module.scss';

// 瓦片集加载诊断（/dev/tileset-probe）：在显卡机器上复现倾斜摄影"先清晰后模糊"、"加载又卸载"的问题，
// 把 Cesium 的瓦片集读数记成报告发回来；逻辑在 useTilesetProbe，这里只显示和调用

const MB = 1024 * 1024;

const PHASE_LABELS: Readonly<Record<ProbePhase['kind'], string>> = {
  idle: '未开始',
  starting: '准备中：加载引擎、索引和首批瓦片',
  running: '记录中',
  stopping: '收尾中',
  done: '已完成，可以下载报告',
  failed: '失败'
};

const MODE_LABELS: Readonly<Record<ProbeMode, string>> = { sequence: '自动序列', manual: '手动记录' };

// 屏幕误差（像素）：Cesium 的默认值 16，可调范围
const DEFAULT_SCREEN_SPACE_ERROR = 16;
const MIN_SCREEN_SPACE_ERROR = 1;
const MAX_SCREEN_SPACE_ERROR = 64;

// 默认选第一个倾斜摄影：问题出在这类模型上
function defaultModel(models: readonly SceneModel[]): SceneModel | undefined {
  return models.find(model => model.kind === 'oblique') ?? models.at(0);
}

function reportFileName(report: ProbeReportFiles, extension: 'json' | 'md'): string {
  const { model, startedAt } = report.json.session;
  const stamp = startedAt.replace(/[:.]/g, '-').slice(0, 19);
  return `tileset-probe-${model.id}-${stamp}.${extension}`;
}

// 给在显卡机器上跑诊断的同事看的步骤
const renderHelp = () => (
  <details class={styles.help}>
    <summary>怎么运行（在显卡机器上）</summary>
    <ol>
      <li>
        在显卡机器上拉取这个分支，运行 <code>pnpm install</code>
      </li>
      <li>
        在 PowerShell 里指定模型服务器：<code>{"$env:YZT_3DT_PROXY = 'http://<服务器地址>'"}</code>
        （提供 /3dt/ 和已部署系统的那台服务器），然后运行 <code>pnpm --filter yzt dev:intranet</code>
      </li>
      <li>
        用 Chrome 打开 <code>{'http://localhost:<端口>/dev/tileset-probe'}</code>（端口看终端的输出）
      </li>
      <li>
        确认状态行里的"显卡"是真实的显卡型号，不是 SwiftShader 或 Basic Render Driver；否则浏览器没有用上显卡，结果没有参考价值
      </li>
      <li>选好模型，浏览器窗口保持和平时测试一样的屏幕大小，点"开始"；自动序列约 3～6 分钟，期间不要碰鼠标和键盘</li>
      <li>状态变成"已完成"后点两个下载按钮，把 .json 和 .md 两个文件一起发回来</li>
      <li>手动记录：点"开始"后自己操作相机复现问题，复现到了再点"停止"，同样下载两个文件</li>
    </ol>
  </details>
);

/** 瓦片集加载诊断：/dev/tileset-probe */
export const DevTilesetProbePage = defineComponent({
  name: 'DevTilesetProbePage',
  setup() {
    const loadRuntime = inject(MAP_RUNTIME, null);
    const query = useSceneModelsQuery(true);
    const models = computed(() => query.data.value ?? []);
    const selectedId = ref('');
    const selected = computed(() => models.value.find(model => model.id === selectedId.value) ?? null);
    // 清单已在查询缓存里时立即选上
    watch(
      models,
      list => {
        if (!selectedId.value) {
          selectedId.value = defaultModel(list)?.id ?? '';
        }
      },
      { immediate: true }
    );
    const mode = ref<ProbeMode>('sequence');
    const screenSpaceError = ref(DEFAULT_SCREEN_SPACE_ERROR);
    // 换模型时先填上业务页面实际用的值：清单里给了就用它，没给是引擎的默认值
    watch(selected, model => {
      screenSpaceError.value = model?.maximumScreenSpaceError ?? DEFAULT_SCREEN_SPACE_ERROR;
    });
    const container = ref<HTMLElement>();
    const probe = useTilesetProbe({ loadRuntime });

    const busy = computed(() => probe.phase.value.kind === 'starting' || probe.phase.value.kind === 'running');
    const totals = computed(() => (probe.latest.value ? summarizeInspection(probe.latest.value) : null));

    const start = () => {
      const model = selected.value;
      const element = container.value;
      if (!model || !element) {
        return;
      }
      const effect = model.effects.find(item => item.id === model.defaultEffect) ?? model.effects.at(0);
      if (!effect) {
        return;
      }
      void probe.start(
        element,
        { id: model.id, name: model.name, url: effect.url },
        mode.value,
        { maximumScreenSpaceError: screenSpaceError.value }
      );
    };

    const download = (extension: 'json' | 'md') => {
      const built = probe.report.value;
      if (!built) {
        return;
      }
      const content = extension === 'json' ? JSON.stringify(built.json, null, 2) : built.markdown;
      const type = extension === 'json' ? 'application/json' : 'text/markdown';
      saveFile({ blob: new Blob([content], { type }), fileName: reportFileName(built, extension) });
    };

    const renderPhase = (): string | VNode => {
      const current = probe.phase.value;
      if (current.kind === 'failed') {
        return (
          <span class={styles.error}>
            失败：{current.error instanceof Error ? current.error.message : String(current.error)}
          </span>
        );
      }
      return PHASE_LABELS[current.kind];
    };

    const renderStatus = () => {
      const latest = probe.latest.value;
      const sums = totals.value;
      const tileset = latest?.tilesets.at(0);
      const items: [string, string | VNode][] = [
        ['状态', renderPhase()],
        ['姿态', probe.poseLabel.value || (probe.phase.value.kind === 'running' ? '手动' : '—')],
        ['已用时', `${probe.elapsedS.value.toFixed(1)} s，采样 ${probe.sampleCount.value} 次`],
        ['显存', sums ? `${(sums.memoryBytes / MB).toFixed(1)} MB` : '—'],
        ['调整后误差', sums && tileset ? `${sums.sse.toFixed(1)}（上限 ${tileset.maximumScreenSpaceError}）` : '—'],
        ['等待 / 处理', sums ? `${sums.pending} / ${sums.processing}` : '—'],
        ['帧 / tick', latest ? `${latest.frames} / ${latest.ticks}` : '—'],
        ['显卡', latest ? latest.renderer || '取不到' : '—']
      ];
      return (
        <dl class={styles.status}>
          {items.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      );
    };

    return () => (
      <main class={styles.root}>
        <header class={styles.toolbar}>
          <strong>瓦片集加载诊断</strong>
          <ElSelect
            class={styles.select}
            modelValue={selectedId.value}
            disabled={busy.value}
            placeholder={query.isError.value ? '清单加载失败' : '选择模型'}
            onUpdate:modelValue={(value: unknown) => {
              selectedId.value = typeof value === 'string' ? value : '';
            }}
          >
            {models.value.map(model => (
              <ElOption
                key={model.id}
                value={model.id}
                label={`${model.name}（${model.cityName}，${MODEL_KIND_LABELS[model.kind]}）`}
              />
            ))}
          </ElSelect>
          <ElRadioGroup
            modelValue={mode.value}
            disabled={busy.value}
            onUpdate:modelValue={(value: unknown) => {
              mode.value = value === 'manual' ? 'manual' : 'sequence';
            }}
          >
            <ElRadioButton value="sequence">{MODE_LABELS.sequence}</ElRadioButton>
            <ElRadioButton value="manual">{MODE_LABELS.manual}</ElRadioButton>
          </ElRadioGroup>
          <label class={styles.field}>
            屏幕误差
            <ElInputNumber
              class={styles.number}
              modelValue={screenSpaceError.value}
              disabled={busy.value}
              min={MIN_SCREEN_SPACE_ERROR}
              max={MAX_SCREEN_SPACE_ERROR}
              step={1}
              stepStrictly
              controlsPosition="right"
              onUpdate:modelValue={(value: number | undefined) => {
                screenSpaceError.value = value ?? DEFAULT_SCREEN_SPACE_ERROR;
              }}
            />
          </label>
          <div class={styles.actions}>
            <ElButton
              type="primary"
              loading={probe.phase.value.kind === 'starting'}
              disabled={!selected.value || busy.value}
              onClick={start}
            >
              开始
            </ElButton>
            <ElButton disabled={!busy.value} onClick={probe.stop}>
              停止
            </ElButton>
            <ElButton disabled={!probe.report.value} onClick={() => download('json')}>
              下载 JSON
            </ElButton>
            <ElButton disabled={!probe.report.value} onClick={() => download('md')}>
              下载 Markdown
            </ElButton>
          </div>
        </header>
        {renderStatus()}
        {renderHelp()}
        <section class={styles.stage}>
          <div ref={container} class={styles.canvas} />
          {probe.phase.value.kind === 'idle' && <div class={styles.placeholder}>选好模型和方式后点"开始"</div>}
        </section>
      </main>
    );
  }
});
