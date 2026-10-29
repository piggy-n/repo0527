import { MxTitle } from '@yzt/ui';
import { ElButton } from 'element-plus';
import { defineComponent, type PropType, ref } from 'vue';
import type { ShapeKind } from '@/shared/map/draw/shape-draw';
import { type IconName, SvgIcon } from '@/shared/icons/SvgIcon';
import type { SpatialForm } from '../composables/useSpatialForm';
import type { QueryTopic } from '../topics';
import { LayerField } from './LayerField';
import formStyles from './QueryForm.module.scss';
import styles from './SpatialQueryForm.module.scss';

type Method = ShapeKind | 'shp';

const METHODS: readonly { readonly id: Method; readonly label: string; readonly icon: IconName }[] = [
  { id: 'rectangle', label: '框选', icon: 'draw-rectangle' },
  { id: 'polygon', label: '多边形', icon: 'geometry-polygon' },
  { id: 'shp', label: 'shp文件导入', icon: 'file-upload' }
];

const SHAPE_NAMES: Readonly<Record<ShapeKind, string>> = { rectangle: '矩形', polygon: '多边形' };

/** 空间查询：图层和范围（框选、多边形或 shp）；画完且已选图层时由页面直接查询 */
export const SpatialQueryForm = defineComponent({
  name: 'SpatialQueryForm',
  props: {
    topic: { type: Object as PropType<QueryTopic>, required: true },
    form: { type: Object as PropType<SpatialForm>, required: true },
    hasResult: { type: Boolean, default: false }
  },
  setup(props) {
    const fileInput = ref<HTMLInputElement>();

    const choose = (method: Method) => {
      if (method === 'shp') {
        props.form.draw.stop();
        fileInput.value?.click();
        return;
      }
      props.form.draw.toggle(method);
    };

    const onFileChange = (event: Event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (file) {
        props.form.chooseFile(file);
      }
      // 同一个文件再选一次也触发 change
      input.value = '';
    };

    const renderScope = () => {
      const { draw, scope } = props.form;
      const active = draw.active.value;
      const current = scope.value;
      if (active !== null) {
        const action = active === 'rectangle' ? '拖动框选' : '单击绘制多边形';
        return <p class={styles.scope}>在地图上{action}，再次点击按钮取消</p>;
      }
      if (current === null) {
        return <p class={[styles.scope, styles.idle]}>尚未选择范围：框选、绘制多边形或导入 shp 文件</p>;
      }
      const text =
        current.kind === 'shape' ? `已绘制${SHAPE_NAMES[current.shape.kind]}范围` : `已选择文件：${current.file.file.name}`;
      return (
        <div class={styles.scope}>
          <span class={styles.scopeText} title={text}>
            {text}
          </span>
          <ElButton link type="primary" onClick={() => props.form.clearScope()}>
            清除
          </ElButton>
        </div>
      );
    };

    return () => {
      const active = props.form.draw.active.value;
      return (
        <div class={formStyles.form}>
          <section class={formStyles.section}>
            <MxTitle>查询图层</MxTitle>
            <LayerField
              topic={props.topic}
              layer={props.form.layer.value}
              hasResult={props.hasResult}
              onChange={(table: string) => props.form.setLayer(table)}
            />
          </section>
          <section class={formStyles.section}>
            <MxTitle>选择方式</MxTitle>
            <div class={styles.methods}>
              {METHODS.map(method => (
                <button
                  key={method.id}
                  type="button"
                  class={[styles.method, active === method.id && styles.current]}
                  aria-pressed={active === method.id}
                  onClick={() => choose(method.id)}
                >
                  <SvgIcon name={method.icon} size={20} />
                  <span>{method.label}</span>
                </button>
              ))}
            </div>
            {renderScope()}
            <p class={formStyles.hint}>画完且已选图层时直接查询，shp 可用 .zip 压缩包</p>
            <input ref={fileInput} type="file" accept=".zip,.shp" hidden onChange={onFileChange} />
          </section>
        </div>
      );
    };
  }
});
