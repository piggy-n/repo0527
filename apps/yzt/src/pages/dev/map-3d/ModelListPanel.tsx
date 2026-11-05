import { ArrowDown, ArrowRight, ArrowUp, Loading, Search } from '@element-plus/icons-vue';
import { MxPanel, MxTitle } from '@yzt/ui';
import { ElButton, ElCheckbox, ElIcon, ElInput, ElOption, ElSelect, ElTooltip } from 'element-plus';
import { computed, defineComponent, type PropType, ref } from 'vue';
import { type IconName, SvgIcon } from '@/shared/icons/SvgIcon';
import { MAP_TOOLTIP_PROPS } from '@/shared/map/tooltip';
import { MODEL_KIND_LABELS, type ModelEntry } from './model-samples';
import type { LoadStatus, ModelDemo } from './useModelDemo';
import styles from './ModelListPanel.module.scss';

interface CityGroup {
  readonly code: string;
  readonly name: string;
  readonly models: readonly ModelEntry[];
}

// 按清单顺序分到所属的市
function groupByCity(models: readonly ModelEntry[]): CityGroup[] {
  const groups = new Map<string, { name: string; models: ModelEntry[] }>();
  for (const model of models) {
    const group = groups.get(model.cityCode) ?? { name: model.cityName, models: [] };
    group.models.push(model);
    groups.set(model.cityCode, group);
  }
  return [...groups].map(([code, { name, models: items }]) => ({ code, name, models: items }));
}

// 行内的图标按钮，悬停提示名称
function iconButton(label: string, icon: IconName, onClick: () => void, disabled = false) {
  return (
    <ElTooltip {...MAP_TOOLTIP_PROPS} content={label} placement="top">
      <button type="button" class={styles.iconButton} aria-label={label} disabled={disabled} onClick={onClick}>
        <SvgIcon name={icon} size={16} />
      </button>
    </ElTooltip>
  );
}

/**
 * 原型：三维时替换左侧的资源图层面板；目录勾选即加载，"已加载"里定位、卸载，能漫游的模型在第二行右边有"漫游"
 * （2026-10-28：合并原来的"步行漫游""路线漫游"，进入后左侧换成漫游面板）
 */
export const ModelListPanel = defineComponent({
  name: 'ModelListPanel',
  props: {
    owner: { type: Object as PropType<ModelDemo>, required: true },
    collapsed: { type: Boolean, default: false }
  },
  emits: {
    'update:collapsed': (collapsed: boolean) => typeof collapsed === 'boolean'
  },
  setup(props, { emit }) {
    const keyword = ref('');
    const expanded = ref<ReadonlySet<string>>(new Set(['320100', '320500']));
    const loadedCollapsed = ref(false);
    const searching = computed(() => keyword.value.trim() !== '');

    const groups = computed(() => {
      const text = keyword.value.trim();
      const matched = props.owner.models.value.filter(
        model => text === '' || model.name.includes(text) || model.cityName.includes(text)
      );
      return groupByCity(matched);
    });
    // 按加载的先后排列
    const loaded = computed(() => [...props.owner.loads.value].map(([id, status]) => ({ id, status })));

    const toggleCity = (code: string) => {
      const next = new Set(expanded.value);
      if (!next.delete(code)) {
        next.add(code);
      }
      expanded.value = next;
    };

    const renderModel = (model: ModelEntry) => {
      const status = props.owner.loads.value.get(model.id);
      return (
        <li key={model.id} class={styles.modelRow}>
          <ElCheckbox
            class={styles.checkbox}
            modelValue={status !== undefined}
            onUpdate:modelValue={checked => (checked ? props.owner.load(model.id) : props.owner.unload(model.id))}
          >
            <span class={styles.name} title={model.name}>
              {model.name}
            </span>
          </ElCheckbox>
          {status === 'loading' && (
            <ElIcon class={['is-loading', styles.spinner]} aria-label="加载中">
              <Loading />
            </ElIcon>
          )}
          {status === 'failed' && <span class={styles.error}>失败</span>}
          <span class={styles.kind}>{MODEL_KIND_LABELS[model.kind]}</span>
        </li>
      );
    };

    const renderGroup = (group: CityGroup) => {
      const open = searching.value || expanded.value.has(group.code);
      return (
        <li key={group.code}>
          <button
            type="button"
            class={styles.groupRow}
            aria-expanded={open}
            disabled={searching.value}
            onClick={() => toggleCity(group.code)}
          >
            <ElIcon class={styles.arrow}>{open ? <ArrowDown /> : <ArrowRight />}</ElIcon>
            <span class={styles.groupName}>{group.name}</span>
            <span class={styles.count}>{group.models.length}</span>
          </button>
          {open && <ul class={styles.children}>{group.models.map(renderModel)}</ul>}
        </li>
      );
    };

    const renderLoadedMeta = (model: ModelEntry, status: LoadStatus) => {
      const { owner } = props;
      if (status === 'loading') {
        return <span class={styles.meta}>加载中…</span>;
      }
      if (status === 'failed') {
        return (
          <>
            <span class={styles.error}>加载失败</span>
            <ElButton link type="primary" size="small" onClick={() => owner.retry(model.id)}>
              重试
            </ElButton>
          </>
        );
      }
      return (
        <>
          <span class={styles.meta}>
            {model.cityName} · {MODEL_KIND_LABELS[model.kind]}
          </span>
          {model.effects.length > 0 && (
            <ElSelect
              class={styles.effect}
              size="small"
              aria-label="白膜效果"
              modelValue={owner.effectOf(model.id)}
              onUpdate:modelValue={(value: string) => owner.setEffect(model.id, value)}
            >
              {model.effects.map(effect => (
                <ElOption key={effect.id} label={effect.label} value={effect.id} />
              ))}
            </ElSelect>
          )}
          {(model.walkable || model.routes.length > 0) && (
            <ElButton class={styles.roam} size="small" type="primary" plain onClick={() => owner.startRoam(model.id)}>
              漫游
            </ElButton>
          )}
        </>
      );
    };

    const renderLoaded = ({ id, status }: { id: string; status: LoadStatus }) => {
      const { owner } = props;
      const model = owner.model(id);
      return (
        <li key={id} class={styles.loadedRow}>
          <div class={styles.loadedHead}>
            <span class={styles.loadedName} title={model.name}>
              {model.name}
            </span>
            <span class={styles.actions}>
              {iconButton('定位', 'focus', () => owner.locate(id), status !== 'ready')}
              {iconButton('卸载', 'close', () => owner.unload(id))}
            </span>
          </div>
          <div class={styles.loadedMeta}>{renderLoadedMeta(model, status)}</div>
        </li>
      );
    };

    const renderStatus = () => {
      const { owner } = props;
      if (owner.manifest.value === 'loading') {
        return <div class={styles.status}>正在加载模型清单…</div>;
      }
      return (
        <div class={styles.status}>
          <span>模型清单加载失败</span>
          <ElButton size="small" onClick={owner.retryManifest}>
            重试
          </ElButton>
        </div>
      );
    };

    const renderBody = () => {
      if (props.owner.manifest.value !== 'ready') {
        return renderStatus();
      }
      if (props.owner.models.value.length === 0) {
        return <div class={[styles.status, styles.placeholder]}>暂无三维模型</div>;
      }
      return (
        <>
          <div class={styles.filter}>
            <ElInput
              modelValue={keyword.value}
              clearable
              prefixIcon={Search}
              placeholder="搜索模型或所属市"
              onUpdate:modelValue={(value: string) => (keyword.value = value)}
            />
          </div>
          <div class={styles.tree}>
            {groups.value.length > 0 ? (
              <ul class={styles.list}>{groups.value.map(renderGroup)}</ul>
            ) : (
              <div class={styles.status}>没有找到模型</div>
            )}
          </div>
          {loaded.value.length > 0 && (
            <div class={styles.loaded}>
              <button
                type="button"
                class={styles.loadedToggle}
                aria-expanded={!loadedCollapsed.value}
                onClick={() => (loadedCollapsed.value = !loadedCollapsed.value)}
              >
                <span class={styles.loadedTitle}>已加载</span>
                <span class={styles.count}>{loaded.value.length}</span>
                <span class={styles.toggleText}>{loadedCollapsed.value ? '展开' : '收起'}</span>
                <ElIcon>{loadedCollapsed.value ? <ArrowUp /> : <ArrowDown />}</ElIcon>
              </button>
              {!loadedCollapsed.value && <ul class={styles.loadedList}>{loaded.value.map(renderLoaded)}</ul>}
            </div>
          )}
        </>
      );
    };

    return () => (
      <div class={styles.root} data-model-list-panel>
        {props.collapsed ? (
          <button
            type="button"
            class={styles.strip}
            aria-label="展开三维模型"
            onClick={() => emit('update:collapsed', false)}
          >
            <SvgIcon class={styles.stripIcon} name="panel-expand" size={16} />
            <span class={styles.stripLabel}>三维模型</span>
          </button>
        ) : (
          <MxPanel floating flush headerTone="muted" class={styles.panel}>
            {{
              header: () => <MxTitle level="panel">三维模型</MxTitle>,
              actions: () => (
                <button
                  type="button"
                  class={styles.collapse}
                  aria-label="收起三维模型"
                  onClick={() => emit('update:collapsed', true)}
                >
                  <SvgIcon name="panel-collapse" size={16} />
                </button>
              ),
              default: renderBody
            }}
          </MxPanel>
        )}
      </div>
    );
  }
});
