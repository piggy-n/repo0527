import { ArrowDown, ArrowRight, ArrowUp, Loading, Search } from '@element-plus/icons-vue';
import { useMapOverlay } from '@yzt/map-vue';
import { MxPanel, MxTitle } from '@yzt/ui';
import {
  ElButton,
  ElCheckbox,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElIcon,
  ElInput,
  ElOption,
  ElSelect,
  ElTooltip
} from 'element-plus';
import { computed, defineComponent, type PropType, ref } from 'vue';
import { type IconName, SvgIcon } from '@/shared/icons/SvgIcon';
import { MAP_TOOLTIP_PROPS } from '@/shared/map/tooltip';
import { groupByCity, MODEL_KIND_LABELS, type ModelCity, type SceneModel } from '../catalog';
import type { SceneModels } from '../composables/useSceneModels';
import styles from './SceneModelPanel.module.scss';

function formatLength(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
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
 * 三维模型面板（ADR 0081 第 7 节，原型 `/dev/map-3d`）：三维时替换左侧的资源图层面板；目录勾选即加载，
 * "已加载"按勾选的先后定位、卸载、换白膜效果和重试。只显示拥有者的状态并调用它的操作；收起与否由页面给出。
 * 会挡住定位，登记为贴左边的悬浮元素
 */
export const SceneModelPanel = defineComponent({
  name: 'SceneModelPanel',
  props: {
    models: { type: Object as PropType<SceneModels>, required: true },
    /** 清单加载失败；已经有目录时照常显示它 */
    failed: { type: Boolean, default: false },
    /** 显示为收起：用户收起了，或窄屏时让给右边 */
    collapsed: { type: Boolean, default: false }
  },
  emits: {
    retry: () => true,
    'update:collapsed': (collapsed: boolean) => typeof collapsed === 'boolean'
  },
  setup(props, { emit }) {
    const element = ref<HTMLElement>();
    useMapOverlay(element, 'left');

    // 以下都是面板自己的界面状态：市默认展开，记下收起的
    const keyword = ref('');
    const closedCities = ref<ReadonlySet<string>>(new Set());
    const loadedCollapsed = ref(false);
    const searching = computed(() => keyword.value.trim() !== '');
    const cities = computed(() => groupByCity(props.models.models.value, keyword.value));
    const loaded = computed(() => {
      const byId = new Map(props.models.models.value.map(model => [model.id, model]));
      return props.models.loaded.value.flatMap(id => byId.get(id) ?? []);
    });

    const toggleCity = (code: string) => {
      const next = new Set(closedCities.value);
      if (!next.delete(code)) {
        next.add(code);
      }
      closedCities.value = next;
    };

    const renderModel = (model: SceneModel) => {
      const { models } = props;
      const checked = models.loaded.value.includes(model.id);
      const state = models.stateOf(model.id);
      return (
        <li key={model.id} class={styles.modelRow} data-model={model.id}>
          <ElCheckbox
            class={styles.checkbox}
            modelValue={checked}
            onUpdate:modelValue={value => models.setChecked(model.id, value === true)}
          >
            <span class={styles.name} title={model.name}>
              {model.name}
            </span>
          </ElCheckbox>
          {checked && state === 'loading' && (
            <ElIcon class={['is-loading', styles.spinner]} aria-label="加载中">
              <Loading />
            </ElIcon>
          )}
          {checked && state === 'failed' && <span class={styles.error}>失败</span>}
          <span class={styles.kind}>{MODEL_KIND_LABELS[model.kind]}</span>
        </li>
      );
    };

    const renderCity = (city: ModelCity) => {
      const open = searching.value || !closedCities.value.has(city.cityCode);
      return (
        <li key={city.cityCode}>
          <button
            type="button"
            class={styles.groupRow}
            aria-expanded={open}
            disabled={searching.value}
            onClick={() => toggleCity(city.cityCode)}
          >
            <ElIcon class={styles.arrow}>{open ? <ArrowDown /> : <ArrowRight />}</ElIcon>
            <span class={styles.groupName}>{city.cityName}</span>
            <span class={styles.count}>{city.models.length}</span>
          </button>
          {open && <ul class={styles.children}>{city.models.map(renderModel)}</ul>}
        </li>
      );
    };

    // 预置路线的下拉：选一条就开始漫游，停在起点（ADR 0083 第 4 节）
    const renderRoutes = (model: SceneModel) => (
      <ElDropdown trigger="click" onCommand={command => props.models.startRoute(model.id, String(command))}>
        {{
          default: () => (
            <ElButton link type="primary" size="small">
              路线漫游
              <ElIcon class={styles.dropdownArrow}>
                <ArrowDown />
              </ElIcon>
            </ElButton>
          ),
          dropdown: () => (
            <ElDropdownMenu>
              {model.routes.map(route => (
                <ElDropdownItem key={route.id} command={route.id}>
                  {route.name}
                  <span class={styles.routeLength}>{formatLength(route.length)}</span>
                </ElDropdownItem>
              ))}
            </ElDropdownMenu>
          )
        }}
      </ElDropdown>
    );

    const renderLoadedMeta = (model: SceneModel) => {
      const { models } = props;
      const state = models.stateOf(model.id);
      if (state === 'loading') {
        return <span class={styles.meta}>加载中…</span>;
      }
      if (state === 'failed') {
        return (
          <>
            <span class={styles.error}>加载失败</span>
            <ElButton link type="primary" size="small" onClick={() => models.retry(model.id)}>
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
          {/* 清单里有出生点的才能步行（ADR 0086 第 5 节） */}
          {model.spawn && (
            <ElButton link type="primary" size="small" onClick={() => models.startWalk(model.id)}>
              步行漫游
            </ElButton>
          )}
          {model.routes.length > 0 && renderRoutes(model)}
          {model.kind === 'white' && (
            <ElSelect
              class={styles.effect}
              size="small"
              aria-label="白膜效果"
              modelValue={models.effectOf(model.id)}
              onUpdate:modelValue={(value: string) => models.setEffect(model.id, value)}
            >
              {model.effects.map(effect => (
                <ElOption key={effect.id} label={effect.label} value={effect.id} />
              ))}
            </ElSelect>
          )}
        </>
      );
    };

    // 漫游中优先于钻地
    const renderTag = (id: string) => {
      const { models } = props;
      if (models.roam.value?.modelId === id) {
        return <span class={styles.tag}>漫游中</span>;
      }
      return models.underground.value?.modelId === id ? <span class={styles.tag}>钻地</span> : null;
    };

    const renderLoaded = (model: SceneModel) => {
      const { models } = props;
      const { id } = model;
      return (
        <li key={id} class={[styles.loadedRow, models.focus.value === id && styles.focused]} data-loaded={id}>
          <div class={styles.loadedHead}>
            <span class={styles.loadedName} title={model.name}>
              {model.name}
            </span>
            {renderTag(id)}
            <span class={styles.actions}>
              {iconButton('定位', 'focus', () => models.locate(id), models.stateOf(id) !== 'ready')}
              {iconButton('卸载', 'close', () => models.setChecked(id, false))}
            </span>
          </div>
          <div class={styles.loadedMeta}>{renderLoadedMeta(model)}</div>
        </li>
      );
    };

    const renderStatus = () =>
      props.failed ? (
        <div class={styles.status}>
          <span>模型清单加载失败</span>
          <ElButton size="small" onClick={() => emit('retry')}>
            重试
          </ElButton>
        </div>
      ) : (
        <div class={styles.status}>正在加载模型清单…</div>
      );

    const renderBody = () => {
      if (!props.models.hasCatalog.value) {
        return renderStatus();
      }
      if (props.models.models.value.length === 0) {
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
            {cities.value.length > 0 ? (
              <ul class={styles.list}>{cities.value.map(renderCity)}</ul>
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
      <div ref={element} class={styles.root} data-scene-model-panel>
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
