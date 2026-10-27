import { ElButton, ElSlider } from 'element-plus';
import { computed, defineComponent, type PropType } from 'vue';
import type { SceneModels } from '../composables/useSceneModels';
import { MAX_SURFACE_OPACITY } from '../scene-content';
import styles from './UndergroundBar.module.scss';

// 滑块按百分比，每格 5%
const MAX_PERCENT = Math.round(MAX_SURFACE_OPACITY * 100);
const PERCENT_STEP = 5;

/**
 * 钻地条（ADR 0081 第 6 节，原型 `/dev/map-3d`）：钻地期间在地图下方，调地表不透明度、退出钻地；
 * 不在钻地、正在漫游时不渲染（ADR 0083 第 4 节）
 */
export const UndergroundBar = defineComponent({
  name: 'UndergroundBar',
  props: {
    models: { type: Object as PropType<SceneModels>, required: true }
  },
  setup(props) {
    const target = computed(() => {
      const choice = props.models.underground.value;
      const model = choice && props.models.models.value.find(item => item.id === choice.modelId);
      const roaming = props.models.roam.value !== null;
      return choice && model && !roaming ? { name: model.name, percent: Math.round(choice.opacity * 100) } : null;
    });
    const change = (value: number | number[]) => {
      if (typeof value === 'number') {
        props.models.setSurfaceOpacity(value / 100);
      }
    };

    return () => {
      const current = target.value;
      if (!current) {
        return null;
      }
      return (
        <div class={styles.root} role="region" aria-label="钻地观察" data-underground-bar>
          <strong class={styles.title}>钻地观察 · {current.name}</strong>
          <div class={styles.opacity}>
            <span aria-hidden="true">地表不透明度</span>
            <ElSlider
              class={styles.slider}
              size="small"
              min={0}
              max={MAX_PERCENT}
              step={PERCENT_STEP}
              showTooltip={false}
              modelValue={current.percent}
              aria-label="地表不透明度"
              onUpdate:modelValue={change}
            />
            <span class={styles.value}>{current.percent}%</span>
          </div>
          <ElButton link type="primary" onClick={props.models.exitUnderground}>
            退出钻地
          </ElButton>
        </div>
      );
    };
  }
});
