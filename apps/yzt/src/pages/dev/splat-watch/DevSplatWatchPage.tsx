import { useIntervalFn } from '@vueuse/core';
import { ElButton, ElOption, ElRadioButton, ElRadioGroup, ElSelect, ElSwitch } from 'element-plus';
import { computed, defineComponent, onScopeDispose, ref, shallowRef, watch } from 'vue';
import type { SceneModel } from '@/features/scene-models/catalog';
import { useSceneModelsQuery } from '@/features/scene-models/queries';
import { type ProbeSnapshot, SplatProbe } from './splat-probe';
import { type Background, EngineScope, SplatWatchMap, type WatchMode } from './SplatWatchMap';
import { readoutLines, reportText } from './watch-report';
import styles from './DevSplatWatchPage.module.scss';

// 高斯泼溅的 GL 监听和预算（/dev/splat-watch，ADR 0149 第 2 节、L.3）：在显卡机器上用真实数据看
// 库在渲染回调外的 GL 调用有没有出错、各个预算下的手感和亮处；逻辑在 SplatProbe，这里只显示和调用。
// 引擎固定用 maplibre（泼溅只在这种引擎下），不看 .env

// 比较的总预算（ADR 0149 第 9 节 L.3）：换预算要重建地图（预算是渲染器的构造参数）
const BUDGETS = [3_000_000, 6_000_000, 10_000_000] as const;
const MODE_LABELS: Readonly<Record<WatchMode, string>> = { splat: '只看泼溅', reference: '只看对照', both: '一起（对照在泼溅的范围里裁掉）' };
const BACKGROUND_LABELS: Readonly<Record<Background, string>> = { dark: '深色', light: '浅色' };

const find = (models: readonly SceneModel[], id: string) => models.find(model => model.id === id) ?? null;

const renderHelp = () => (
  <details class={styles.help}>
    <summary>怎么用（在显卡机器上）</summary>
    <ol>
      <li>
        开发服务器 <code>pnpm --filter yzt dev</code>，用 Chrome 打开 <code>/dev/splat-watch</code>；确认左边的"显卡"是真实的显卡，不是
        SwiftShader 或 Basic Render Driver
      </li>
      <li>彭城广场的 LCC2 样例要先写进本地清单（docs/modules/map-three.md"泼溅的预算"），楚王山1号在入库的清单里</li>
      <li>GL 监听：开着监听，按每个预算各拖动、转动、缩放一分钟，看"GL 错误"是不是 0；开着监听时帧率会掉，不算数</li>
      <li>手感：关掉监听再按每个预算各看一遍：卡不卡、转动时闪不闪、飞到新地方补得快不快</li>
      <li>亮处偏白：对照选同一处的倾斜摄影，在"只看泼溅""只看对照"之间切换，比浅色墙面、地面亮不亮</li>
      <li>每个预算点一次"复制结果"，连同感受一起发回来</li>
    </ol>
  </details>
);

/** 高斯泼溅的 GL 监听和预算：/dev/splat-watch */
export const DevSplatWatchPage = defineComponent({
  name: 'DevSplatWatchPage',
  setup() {
    const query = useSceneModelsQuery(true);
    const splatModels = computed(() => (query.data.value ?? []).filter(model => model.splat !== null));
    const references = computed(() => (query.data.value ?? []).filter(model => model.kind === 'oblique'));
    const splatId = ref('');
    const referenceId = ref('');
    const budget = ref<number>(BUDGETS[0]);
    const mode = ref<WatchMode>('splat');
    const background = ref<Background>('dark');
    const watching = ref(true);
    const copied = ref(false);

    // 清单到了先选第一份泼溅
    watch(
      splatModels,
      models => {
        if (!models.some(model => model.id === splatId.value)) {
          splatId.value = models[0]?.id ?? '';
        }
      },
      { immediate: true }
    );
    const splat = computed(() => find(splatModels.value, splatId.value));
    const reference = computed(() => find(references.value, referenceId.value));
    // 清掉对照后只有泼溅可看：地图和复制的结果用同一个值
    const shownMode = computed<WatchMode>(() => (reference.value ? mode.value : 'splat'));
    const modelHint = computed(() => {
      if (query.isError.value) {
        return '清单加载失败';
      }
      return query.isPending.value ? '读取清单…' : '清单里没有高斯泼溅';
    });

    const probe = new SplatProbe();
    onScopeDispose(() => probe[Symbol.dispose]());
    watch(watching, on => probe.setWatching(on), { immediate: true });
    const snapshot = shallowRef<ProbeSnapshot | null>(null);
    useIntervalFn(() => {
      snapshot.value = probe.snapshot();
    }, 500);
    const lines = computed(() => readoutLines(snapshot.value));

    const copy = async () => {
      const text = reportText(snapshot.value, {
        model: splat.value?.name ?? '无',
        budget: budget.value,
        reference: reference.value?.name ?? null,
        mode: MODE_LABELS[shownMode.value]
      });
      await navigator.clipboard.writeText(text);
      copied.value = true;
    };
    watch([budget, splatId, referenceId, mode], () => {
      copied.value = false;
    });

    const renderToolbar = () => (
      <div class={styles.toolbar}>
        <ElSelect
          class={styles.select}
          modelValue={splatId.value}
          placeholder={modelHint.value}
          onUpdate:modelValue={(value: string) => {
            splatId.value = value;
          }}
        >
          {splatModels.value.map(model => (
            <ElOption key={model.id} label={`${model.cityName} ${model.name}`} value={model.id} />
          ))}
        </ElSelect>
        <ElRadioGroup
          modelValue={budget.value}
          onUpdate:modelValue={(value: string | number | boolean | undefined) => {
            budget.value = Number(value);
          }}
        >
          {BUDGETS.map(item => (
            <ElRadioButton key={item} value={item}>
              {item / 10000} 万
            </ElRadioButton>
          ))}
        </ElRadioGroup>
        <ElSelect
          class={styles.select}
          modelValue={referenceId.value}
          clearable
          placeholder="对照的倾斜摄影（可选）"
          onUpdate:modelValue={(value: string | undefined) => {
            referenceId.value = value ?? '';
          }}
        >
          {references.value.map(model => (
            <ElOption key={model.id} label={`${model.cityName} ${model.name}`} value={model.id} />
          ))}
        </ElSelect>
        <ElRadioGroup
          modelValue={shownMode.value}
          disabled={reference.value === null}
          onUpdate:modelValue={(value: string | number | boolean | undefined) => {
            mode.value = value as WatchMode;
          }}
        >
          {(Object.keys(MODE_LABELS) as WatchMode[]).map(item => (
            <ElRadioButton key={item} value={item}>
              {MODE_LABELS[item]}
            </ElRadioButton>
          ))}
        </ElRadioGroup>
        <ElRadioGroup
          modelValue={background.value}
          onUpdate:modelValue={(value: string | number | boolean | undefined) => {
            background.value = value as Background;
          }}
        >
          {(Object.keys(BACKGROUND_LABELS) as Background[]).map(item => (
            <ElRadioButton key={item} value={item}>
              {BACKGROUND_LABELS[item]}
            </ElRadioButton>
          ))}
        </ElRadioGroup>
        <span class={styles.switch}>
          GL 监听
          <ElSwitch
            modelValue={watching.value}
            onUpdate:modelValue={(value: string | number | boolean) => {
              watching.value = Boolean(value);
            }}
          />
        </span>
      </div>
    );

    return () => (
      <div class={styles.root}>
        {renderToolbar()}
        <div class={styles.body}>
          <aside class={styles.aside}>
            {renderHelp()}
            <ul class={styles.readouts}>
              {lines.value.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
            <ElButton onClick={() => void copy()}>{copied.value ? '已复制' : '复制结果'}</ElButton>
          </aside>
          <EngineScope key={budget.value} probe={probe} budget={budget.value}>
            {{
              default: () => (
                <SplatWatchMap
                  splat={splat.value}
                  reference={reference.value}
                  mode={shownMode.value}
                  background={background.value}
                />
              )
            }}
          </EngineScope>
        </div>
      </div>
    );
  }
});
