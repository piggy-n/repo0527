import { MxTitle } from '@mx/ui';
import { MapCanvas, useMap, useMapOverlay } from '@mx/map-vue';
import { ElButton, ElDialog, ElInput, ElMessage, ElTooltip } from 'element-plus';
import { computed, defineComponent, type PropType, ref, type VNodeChild, watch } from 'vue';
import { type IconName, SvgIcon } from '@/shared/icons/SvgIcon';
import { JIANGSU_MAP_OPTIONS } from '@/shared/map/backend-request';
import type { Boundaries } from '@/shared/map/boundary/useBoundaries';
import { BoxSelectOverlay } from '@/shared/map/box-select/BoxSelectOverlay';
import { JIANGSU_ZOOM_RANGE } from '@/shared/map/jiangsu';
import { MapStatusNotice } from '@/shared/map/MapStatusNotice';
import { MAP_TOOLTIP_PROPS } from '@/shared/map/tooltip';
import { MapViewControls } from '@/shared/map/view-controls/MapViewControls';
import { SCROLL_ZOOM_RATES } from '@/shared/map/view-controls/zoom';
import type { ScopeEditor } from '../composables/useScopeEditor';
import { AREA_COLOR, COVER_FULL_COLOR, COVER_PARTIAL_COLOR } from '../map/colors';
import { AreaAnalysisPanel } from './AreaAnalysisPanel';
import { AreaFilePicker } from './AreaFilePicker';
import styles from './ScopeAreaDialog.module.scss';

interface ToolButton {
  readonly key: string;
  readonly label: string;
  readonly icon: IconName;
  readonly pressed?: boolean;
  readonly disabled?: boolean;
  /** 不能用时的原因，写进提示 */
  readonly reason?: string;
  readonly onClick: () => void;
}

function renderButton(button: ToolButton) {
  const content = (
    <button
      key={button.key}
      type="button"
      class={styles.tool}
      // 窄屏只显示图标：名称写在 aria-label 和悬停提示里
      aria-label={button.label}
      title={button.reason ? undefined : button.label}
      aria-pressed={button.pressed}
      disabled={button.disabled}
      onClick={button.onClick}
    >
      <SvgIcon name={button.icon} />
      <span>{button.label}</span>
    </button>
  );
  return button.reason ? (
    <ElTooltip {...MAP_TOOLTIP_PROPS} key={button.key} content={button.reason} placement="bottom">
      {/* 禁用的按钮收不到鼠标事件，提示挂在外层 */}
      <span class={styles.toolWrap}>{content}</span>
    </ElTooltip>
  ) : (
    content
  );
}

/** 地图上的工具栏和图例：登记为贴上、下边的悬浮元素，定位时避开 */
const MapChrome = defineComponent({
  name: 'ScopeMapChrome',
  props: {
    editor: { type: Object as PropType<ScopeEditor>, required: true }
  },
  setup(props) {
    const toolbar = ref<HTMLElement | null>(null);
    const legend = ref<HTMLElement | null>(null);
    useMapOverlay(toolbar, 'top');
    useMapOverlay(legend, 'bottom');

    return () => {
      const { editor } = props;
      const draft = editor.draft.value;
      const busy = editor.busy.value;
      const drawing = editor.draw.active.value;
      const editing = editor.edit.active.value;
      const editReason = !draft
        ? '先上传或绘制范围'
        : !editor.canEdit.value
          ? '范围太复杂，不能逐点编辑，可以重新绘制或上传'
          : undefined;
      const buttons: ToolButton[] = [
        {
          key: 'polygon',
          label: '绘制多边形',
          icon: 'geometry-polygon',
          pressed: drawing === 'polygon',
          onClick: () => {
            editor.edit.stop();
            editor.draw.toggle('polygon');
          }
        },
        {
          key: 'rectangle',
          label: '绘制矩形',
          icon: 'draw-rectangle',
          pressed: drawing === 'rectangle',
          onClick: () => {
            editor.edit.stop();
            editor.draw.toggle('rectangle');
          }
        },
        {
          key: 'edit',
          label: '编辑节点',
          icon: 'vertex-edit',
          pressed: editing,
          disabled: editReason !== undefined || busy,
          reason: editReason,
          onClick: () => {
            editor.draw.stop();
            editor.edit.toggle();
          }
        }
      ];
      const after: ToolButton[] = [
        ...(editing && editor.edit.selected.value
          ? [
              {
                key: 'remove-vertex',
                label: '删除节点',
                icon: 'trash' as const,
                onClick: () => {
                  if (editor.edit.removeSelected() === 'minimum') {
                    ElMessage.warning('每个环至少要保留 3 个节点');
                  }
                }
              }
            ]
          : []),
        { key: 'undo', label: '撤销', icon: 'undo', disabled: !editor.canUndo.value, onClick: editor.undo },
        { key: 'clear', label: '清除', icon: 'map-clear', disabled: !draft, onClick: editor.clear }
      ];
      return [
        <div key="toolbar" ref={toolbar} class={styles.toolbar} role="toolbar" aria-label="范围工具">
          <AreaFilePicker onPick={editor.upload}>
            {{
              default: ({ open }: { readonly open: () => void }) =>
                renderButton({ key: 'upload', label: '上传文件', icon: 'file-upload', onClick: open })
            }}
          </AreaFilePicker>
          <i class={styles.divider} />
          {buttons.map(button => renderButton(button))}
          <i class={styles.divider} />
          {after.map(button => renderButton(button))}
        </div>,
        <div key="legend" ref={legend} class={styles.legend}>
          <span>
            <i class={styles.swatch} style={{ background: COVER_FULL_COLOR }} />
            完整覆盖
          </span>
          <span>
            <i class={styles.swatch} style={{ background: COVER_PARTIAL_COLOR }} />
            部分覆盖
          </span>
          <span>
            <i class={[styles.swatch, styles.outline]} style={{ borderColor: AREA_COLOR }} />
            自定义范围
          </span>
        </div>
      ];
    };
  }
});

/**
 * 自定义监测范围的弹窗（ADR 0121）：左边地图（上传、绘制、逐点编辑，文件可以拖进来），右边 AI 范围分析；
 * 底栏是范围的名称和确定。关上时卸载地图画布：页面同一时间只有一个画布
 */
export const ScopeAreaDialog = defineComponent({
  name: 'ScopeAreaDialog',
  props: {
    editor: { type: Object as PropType<ScopeEditor>, required: true },
    /** 页面的行政区边界拥有者（ADR 0128）：和结果地图共用，勾选的级别不随弹窗关闭改变 */
    boundaries: { type: Object as PropType<Boundaries>, required: true },
    /** 现在能不能放地图画布：计算和结果阶段打开时，要等结果地图卸下（ADR 0129） */
    canvasReady: { type: Boolean, default: true }
  },
  setup(props) {
    const { view } = useMap();
    const dragging = ref(false);
    // 弹窗关上时地图随内容卸载，下次打开时浮层是关着的
    const boundariesOpen = ref(false);
    watch(props.editor.open, open => {
      if (!open) {
        boundariesOpen.value = false;
      }
    });
    // 逐点编辑没有框选的矩形，只借用浮层显示鼠标旁的提示
    const editHint = { boxDraft: computed(() => null), hint: props.editor.edit.hint };

    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      dragging.value = false;
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length > 0) {
        props.editor.upload(files);
      }
    };
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault();
        dragging.value = true;
      }
    };
    const onDragLeave = (event: DragEvent) => {
      // 移到地图里的子元素上也会触发，只有真的离开地图时才收起
      const target = event.currentTarget;
      const next = event.relatedTarget;
      if (!(target instanceof HTMLElement) || !(next instanceof Node) || !target.contains(next)) {
        dragging.value = false;
      }
    };

    const renderFooter = (): VNodeChild => {
      const { editor } = props;
      return (
        <div class={styles.footer}>
          <div class={styles.nameField}>
            <span>范围名称</span>
            <ElInput
              class={styles.nameInput}
              aria-label="范围名称"
              modelValue={editor.name.value}
              maxlength={30}
              placeholder="上传或绘制后填写"
              disabled={!editor.draft.value}
              onUpdate:modelValue={(value: string) => editor.setName(value)}
            />
          </div>
          <ElButton onClick={editor.cancel}>取消</ElButton>
          <ElButton type="primary" disabled={!editor.canConfirm.value} onClick={editor.confirm}>
            使用此范围
          </ElButton>
        </div>
      );
    };

    return () => {
      const { editor } = props;
      return (
        <ElDialog
          class={['dialog-panel-header', 'dialog-flush-body', styles.dialog]}
          title="自定义监测范围"
          width="min(1200px, calc(100vw - 64px))"
          top="4vh"
          appendToBody
          destroyOnClose
          closeOnClickModal={false}
          // Esc 留给地图上的工具（退出绘制、编辑），弹窗用关闭按钮和"取消"关上
          closeOnPressEscape={false}
          modelValue={editor.open.value}
          beforeClose={done => {
            editor.cancel();
            done();
          }}
        >
          {{
            header: () => <MxTitle level="panel">自定义监测范围</MxTitle>,
            default: () => (
              <div class={styles.body}>
                <div
                  class={styles.map}
                  onDragover={onDragOver}
                  onDragleave={onDragLeave}
                  onDrop={onDrop}
                >
                  {/* 视图就绪、定位好了才淡入：看不到上一次的位置（ADR 0131） */}
                  <div class={[styles.canvas, view.value && styles.canvasShown]}>
                    {props.canvasReady && <MapCanvas mapOptions={JIANGSU_MAP_OPTIONS} scrollZoomRates={SCROLL_ZOOM_RATES} />}
                  </div>
                  <MapStatusNotice />
                  <MapChrome editor={editor} />
                  <BoxSelectOverlay pick={editor.draw} />
                  <BoxSelectOverlay pick={editHint} />
                  <div class={styles.corner}>
                    <MapViewControls
                      goToDefaultView={editor.overview}
                      zoomRange={JIANGSU_ZOOM_RANGE}
                      boundaries={props.boundaries}
                      boundariesOpen={boundariesOpen.value}
                      onUpdate:boundariesOpen={open => (boundariesOpen.value = open)}
                    />
                  </div>
                  {dragging.value && <div class={styles.drop}>松开鼠标上传范围文件</div>}
                </div>
                <AreaAnalysisPanel class={styles.analysis} editor={editor} />
              </div>
            ),
            footer: renderFooter
          }}
        </ElDialog>
      );
    };
  }
});
