import { ArrowDown, ArrowUp, RefreshLeft } from '@element-plus/icons-vue';
import { useMapOverlay } from '@yzt/map-vue';
import { MxPanel, MxTitle } from '@yzt/ui';
import { ElButton, ElCheckbox, ElColorPicker, ElSkeleton } from 'element-plus';
import { defineComponent, type PropType, ref } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import { BoundarySettingsPanel } from '@/shared/map/boundary/BoundarySettingsPanel';
import type { Boundaries } from '@/shared/map/boundary/useBoundaries';
import type { IndicatorResultOwner, ResultLayerView } from '../composables/useIndicatorResult';
import { FLAG_SYMBOL_COLOR } from '../result-layers';
import styles from './IndicatorResultPanel.module.scss';

// 取色的预设，同旧页面的图层色板
const PREDEFINE = ['#597EF7', '#59C0F7', '#10B981', '#F2B84B', '#7C8CC4', '#76B7A3', '#8B9DB5', '#C9A96E'];

/**
 * 指标成果（展示页签，地图右上）：计算结果、行政区、指标的子图层。子图层的勾选控制显隐，后面的色块就是图例：
 * 点开取色，拖动时只预览，确认后才改（ADR 0044 的取色规则）；改过的可以恢复默认。会挡住定位，登记为贴右边的悬浮元素
 */
export const IndicatorResultPanel = defineComponent({
  name: 'IndicatorResultPanel',
  props: {
    result: { type: Object as PropType<IndicatorResultOwner>, required: true },
    boundaries: { type: Object as PropType<Boundaries>, required: true },
    /** 窄屏时让给左边，只隐藏不卸载 */
    visible: { type: Boolean, default: true }
  },
  setup(props) {
    const element = ref<HTMLElement>();
    useMapOverlay(element, 'right');
    const collapsed = ref(false);
    const showSkeleton = useDelayedFlag(() => props.result.state.value.kind === 'loading');

    const renderSymbol = ({ layer, color, recolorable }: ResultLayerView) => {
      if (!recolorable) {
        return (
          <svg class={styles.flag} viewBox="0 0 24 24" role="img" aria-label="旗子">
            <path d="M10.5 3h2v19h-2z M12.5 3 21 8.5 12.5 14z" fill={FLAG_SYMBOL_COLOR} />
          </svg>
        );
      }
      const { previewColor, setColor } = props.result;
      return (
        <ElColorPicker
          class={styles.picker}
          size="small"
          modelValue={color}
          showAlpha
          predefine={PREDEFINE}
          clearable={false}
          ariaLabel={`${layer.name}的颜色`}
          onActiveChange={(value: string | null) => previewColor(layer.key, value)}
          onChange={(value: string | null) => {
            if (value) {
              setColor(layer.key, value);
            }
          }}
        />
      );
    };

    const renderLayer = (view: ResultLayerView) => (
      <li key={view.layer.key} class={styles.layer}>
        <ElCheckbox
          class={styles.checkbox}
          modelValue={view.visible}
          onChange={value => props.result.setVisible(view.layer.key, value === true)}
        >
          <span title={view.layer.name}>{view.layer.name}</span>
        </ElCheckbox>
        {renderSymbol(view)}
        <ElButton
          class={[styles.reset, !view.customized && styles.hidden]}
          link
          icon={RefreshLeft}
          aria-label={`${view.layer.name}恢复默认颜色`}
          disabled={!view.customized}
          onClick={() => props.result.resetColor(view.layer.key)}
        />
      </li>
    );

    const renderContent = () => {
      const state = props.result.state.value;
      if (state.kind === 'loading') {
        return showSkeleton.value ? <ElSkeleton rows={4} animated /> : null;
      }
      if (state.kind === 'failed') {
        return (
          <div class={styles.message}>
            {state.message || '指标成果加载失败'}
            <ElButton link type="primary" onClick={props.result.retry}>
              重试
            </ElButton>
          </div>
        );
      }
      if (state.kind !== 'ready') {
        return null;
      }
      const layers = props.result.layers.value;
      return (
        <>
          <section class={styles.section}>
            <MxTitle>计算结果</MxTitle>
            <div class={styles.value}>{state.result.value ?? '-'}</div>
          </section>
          <section class={styles.section}>
            <MxTitle>行政区</MxTitle>
            <BoundarySettingsPanel boundaries={props.boundaries} active={!collapsed.value && props.visible} />
          </section>
          <section class={styles.section}>
            <MxTitle>指标图层</MxTitle>
            {layers.length > 0 ? (
              <ul class={styles.layers}>{layers.map(renderLayer)}</ul>
            ) : (
              <div class={styles.message}>暂无图层</div>
            )}
          </section>
        </>
      );
    };

    return () => {
      const state = props.result.state.value;
      if (state.kind === 'none') {
        return null;
      }
      return (
        <div
          ref={element}
          class={[styles.window, collapsed.value && styles.collapsed]}
          style={props.visible ? undefined : { display: 'none' }}
          data-indicator-result
        >
          <MxPanel
            floating
            headerTone="muted"
            flush={collapsed.value}
            title="指标成果"
            description={state.indicator.name}
            class={styles.shell}
          >
            {{
              actions: () => (
                <ElButton
                  link
                  icon={collapsed.value ? ArrowDown : ArrowUp}
                  aria-label={collapsed.value ? '展开指标成果' : '收起指标成果'}
                  aria-expanded={!collapsed.value}
                  onClick={() => (collapsed.value = !collapsed.value)}
                />
              ),
              default: () => (collapsed.value ? null : <div class={styles.content}>{renderContent()}</div>)
            }}
          </MxPanel>
        </div>
      );
    };
  }
});
