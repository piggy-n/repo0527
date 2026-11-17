import { Loading } from '@element-plus/icons-vue';
import { ElButton, ElIcon, ElOption, ElSelect, ElTooltip } from 'element-plus';
import { computed, defineComponent, type PropType } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import rowStyles from '@/shared/map/layer-panel/layer-row.module.scss';
import { MAP_TOOLTIP_PROPS } from '@/shared/map/tooltip';
import { MODEL_KIND_LABELS } from '../catalog';
import type { SceneModels } from '../composables/useSceneModels';
import { canRoamModel, roamUnavailable } from '../layer-panel';
import styles from './ModelLayerRow.module.scss';

/** 行尾"漫游"的提示：不能点时带上原因 */
export function roamTip(scene: boolean, hidden: boolean, ready: boolean): string {
  const reason = roamUnavailable(scene, hidden, ready);
  return reason === undefined ? '漫游' : `漫游（${reason}）`;
}

/**
 * 当前图层里一个三维模型的行内容（ADR 0157），放在通用分组的手柄、复选框后面：模型图标、名称、紧跟名称的状态
 * （三维里显示着时：请求状态说加载中时转圈，失败时红色图标加"重试"）、行尾的框（白膜是效果下拉，能漫游的是"漫游"按钮）、移除。
 * 二维里不加载、不能漫游，整组由分组变淡；拥有者的目录里没有这个模型时不显示
 */
export const ModelLayerRow = defineComponent({
  name: 'ModelLayerRow',
  props: {
    models: { type: Object as PropType<SceneModels>, required: true },
    id: { type: String, required: true },
    /** 正在显示三维：二维里模型不加载，不显示状态，不能漫游 */
    scene: { type: Boolean, required: true },
    /** 加载超过 0.4 秒（请求状态的 loadingKeys，读索引和读完以后这一轮都算，ADR 0162）：名称后面转圈 */
    loading: { type: Boolean, default: false }
  },
  emits: {
    remove: () => true
  },
  setup(props, { emit }) {
    const model = computed(() => props.models.models.value.find(item => item.id === props.id));
    const hidden = computed(() => props.models.hidden.value.has(props.id));

    const renderStatus = (name: string) => {
      if (!props.scene || hidden.value) {
        return null;
      }
      const state = props.models.stateOf(props.id);
      if (props.loading) {
        return (
          <ElIcon class={['is-loading', rowStyles.spinner]} aria-label="加载中">
            <Loading />
          </ElIcon>
        );
      }
      if (state === 'failed') {
        return [
          <ElTooltip {...MAP_TOOLTIP_PROPS} content="加载失败" placement="top">
            <span class={styles.error} role="img" aria-label="加载失败" tabindex={0}>
              <SvgIcon name="status-error" size={14} />
            </span>
          </ElTooltip>,
          <ElButton
            class="button-inline"
            link
            type="primary"
            size="small"
            aria-label={`重新加载：${name}`}
            onClick={() => props.models.retry(props.id)}
          >
            重试
          </ElButton>
        ];
      }
      return null;
    };

    // 名称：悬停看全称、所在的市和类型；二维里模型行变淡、留在原位，悬停说明"切换到三维后显示"（用户 2026-11-16，ADR 0161）
    const renderName = (name: string, title: string) =>
      props.scene ? (
        <span class={rowStyles.name} title={title} data-row-text data-row-dim>
          {name}
        </span>
      ) : (
        <ElTooltip {...MAP_TOOLTIP_PROPS} content="切换到三维后显示" placement="top">
          <span class={rowStyles.name} data-row-text data-row-dim data-row-hint="切换到三维后显示">
            {name}
          </span>
        </ElTooltip>
      );

    const renderTrail = () => {
      const current = model.value;
      if (!current) {
        return null;
      }
      if (current.kind === 'white') {
        return (
          <ElSelect
            class={[rowStyles.trail, 'select-no-arrow', 'select-compact']}
            size="small"
            aria-label={`${current.name}的效果`}
            modelValue={props.models.effectOf(props.id)}
            onUpdate:modelValue={(value: string) => props.models.setEffect(props.id, value)}
          >
            {current.effects.map(effect => (
              <ElOption key={effect.id} label={effect.label} value={effect.id} />
            ))}
          </ElSelect>
        );
      }
      if (!canRoamModel(current)) {
        return null;
      }
      const ready = props.models.stateOf(props.id) === 'ready';
      const usable = props.scene && !hidden.value && ready;
      return (
        <ElTooltip {...MAP_TOOLTIP_PROPS} content={roamTip(props.scene, hidden.value, ready)} placement="top">
          <button
            type="button"
            class={[rowStyles.trail, styles.roam]}
            aria-label={`漫游：${current.name}`}
            aria-disabled={!usable}
            data-roam={props.id}
            onClick={() => {
              if (usable) {
                props.models.startRoam(props.id);
              }
            }}
          >
            <SvgIcon name="roam-walk" size={14} />
            漫游
          </button>
        </ElTooltip>
      );
    };

    return () => {
      const current = model.value;
      if (!current) {
        return null;
      }
      const { name } = current;
      return [
        <span class={rowStyles.symbol} data-row-symbol data-row-dim>
          <SvgIcon name="model-3d" size={16} />
        </span>,
        renderName(name, `${name} · ${current.cityName} · ${MODEL_KIND_LABELS[current.kind]}`),
        <span class={rowStyles.status}>{renderStatus(name)}</span>,
        <span class={rowStyles.fill} />,
        renderTrail(),
        <ElTooltip {...MAP_TOOLTIP_PROPS} content="移除" placement="top">
          <button type="button" class={rowStyles.remove} aria-label={`移除：${name}`} onClick={() => emit('remove')}>
            <SvgIcon name="layer-remove" size={16} />
          </button>
        </ElTooltip>
      ];
    };
  }
});
