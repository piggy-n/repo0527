import { useMapOverlay } from '@yzt/map-vue';
import { MxPanel, MxTitle } from '@yzt/ui';
import { ElButton, ElRadioButton, ElRadioGroup } from 'element-plus';
import { defineComponent, type PropType, ref, watch } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { type DataQuery, SHOWN_QUERY_TABS } from '../composables/useDataQuery';
import { AdvancedQueryForm } from './AdvancedQueryForm';
import { AttributeQueryForm } from './AttributeQueryForm';
import { NaturalLanguageForm } from './NaturalLanguageForm';
import { notifyOutcome, notifySubmit } from './query-messages';
import styles from './QueryPanel.module.scss';
import { SpatialQueryForm } from './SpatialQueryForm';

/**
 * 查询面板（左侧）：标题是专题名，下面是查询方式的按钮组（高级查询暂时隐藏），底部是查询和重置（各占一半）；按钮的结构和排列参考旧页面
 * （2026-10-29）。建设中的专题只有说明。收起时是左上角的竖条，窄屏时让给结果由页面决定
 */
export const QueryPanel = defineComponent({
  name: 'QueryPanel',
  props: {
    query: { type: Object as PropType<DataQuery>, required: true },
    collapsed: { type: Boolean, default: false }
  },
  emits: {
    'update:collapsed': (collapsed: boolean) => typeof collapsed === 'boolean'
  },
  setup(props, { emit }) {
    const element = ref<HTMLElement>();
    useMapOverlay(element, 'left');

    // 每次提交的第一个结果是新的对象：同一个查询再提交也会提示
    watch(
      () => props.query.result.outcome.value,
      outcome => {
        if (outcome) {
          notifyOutcome(outcome);
        }
      }
    );

    const submit = async () => {
      notifySubmit(await props.query.submit());
    };

    const renderBody = () => {
      const { query } = props;
      const { topic, result } = query;
      const hasResult = result.request.value !== null;
      const tab = query.tab.value;
      if (tab === 'attribute') {
        return <AttributeQueryForm topic={topic} form={query.attribute} hasResult={hasResult} />;
      }
      if (tab === 'spatial') {
        return <SpatialQueryForm topic={topic} form={query.spatial} hasResult={hasResult} />;
      }
      if (tab === 'advanced') {
        return <AdvancedQueryForm topic={topic} form={query.advanced} hasResult={hasResult} />;
      }
      return (
        topic.natural &&
        query.natural && (
          <NaturalLanguageForm config={topic.natural} natural={query.natural} attribute={query.attribute} />
        )
      );
    };

    // 查询方式排成一组按钮，等宽占满一行（旧页面的分段按钮）
    const renderModes = () => (
      <div class={styles.modes}>
        <ElRadioGroup
          class="radio-group-block"
          size="small"
          aria-label="查询方式"
          modelValue={props.query.tab.value}
          onUpdate:modelValue={value => {
            const mode = SHOWN_QUERY_TABS.find(item => item.id === value);
            if (mode) {
              props.query.changeTab(mode.id);
            }
          }}
        >
          {SHOWN_QUERY_TABS.map(item => (
            <ElRadioButton key={item.id} value={item.id}>
              {item.label}
            </ElRadioButton>
          ))}
        </ElRadioGroup>
      </div>
    );

    // 查询在前、重置在后，各占一半（同旧页面，也同筛选栏的"查询 / 重置"）
    const renderFooter = () => (
      <div class={styles.footer}>
        <ElButton type="primary" loading={props.query.busy.value} onClick={submit}>
          查询
        </ElButton>
        <ElButton disabled={props.query.natural?.parsing.value === true} onClick={props.query.reset}>
          重置
        </ElButton>
      </div>
    );

    return () => {
      const { topic } = props.query;
      const building = topic.layers.length === 0;
      return (
        <div ref={element} class={styles.root} data-query-panel>
          {props.collapsed && (
            <button
              type="button"
              class={styles.strip}
              aria-label={`展开${topic.title}`}
              onClick={() => emit('update:collapsed', false)}
            >
              <SvgIcon class={styles.stripIcon} name="panel-expand" size={16} />
              <span class={styles.stripLabel}>数据查询</span>
            </button>
          )}
          <MxPanel floating headerTone="muted" class={styles.panel} v-show={!props.collapsed}>
            {{
              header: () => <MxTitle level="panel">{topic.title}</MxTitle>,
              actions: () => (
                <button
                  type="button"
                  class={styles.collapse}
                  aria-label={`收起${topic.title}`}
                  onClick={() => emit('update:collapsed', true)}
                >
                  <SvgIcon name="panel-collapse" size={16} />
                </button>
              ),
              subheader: building ? undefined : renderModes,
              default: () =>
                building ? (
                  <div class={styles.building}>
                    <span class={styles.badge}>建设中</span>
                    <p>该专题的数据还在建设中，暂无可查询的图层</p>
                  </div>
                ) : (
                  renderBody()
                ),
              footer: building ? undefined : renderFooter
            }}
          </MxPanel>
        </div>
      );
    };
  }
});
