import { useMap } from '@yzt/map-vue';
import { ElButton, ElCheckbox } from 'element-plus';
import { defineComponent, type PropType, type VNode } from 'vue';
import type { CatalogNode } from '../catalog';
import type { ResourceLayers } from '../composables/useResourceLayers';
import { resourceNotices } from '../resource-notices';
import styles from './ResourceLayerList.module.scss';

// 没有资源的分类不显示：基础库下有十几个空分类
function hasResources(node: CatalogNode): boolean {
  return node.kind === 'resource' || node.children.some(hasResources);
}

/**
 * 资源图层的临时勾选列表（联调用，图层面板在 5C.2、界面在 5D）：只显示 useResourceLayers 的状态并调用它的操作。
 * 目录由页面的查询加载；还没有目录时显示加载中，或者失败与重试
 */
export const ResourceLayerList = defineComponent({
  name: 'ResourceLayerList',
  props: {
    layers: { type: Object as PropType<ResourceLayers>, required: true },
    /** 目录加载失败；已经有目录时照常显示它 */
    failed: { type: Boolean, default: false }
  },
  emits: {
    retry: () => true
  },
  setup(props, { emit }) {
    const camera = useMap().useCamera();

    const renderResource = (code: string): VNode | null => {
      const { state, configErrors, tileErrors, minzoomOf, setChecked } = props.layers;
      const resource = state.value.catalog?.resources.get(code);
      const display = state.value.displays.get(code);
      if (!resource || !display) {
        return null;
      }
      const notices = resourceNotices({
        checked: display.checked,
        configError: configErrors.value.has(code),
        tileError: tileErrors.value.has(code),
        minzoom: minzoomOf(code),
        zoom: camera.value.zoom
      });
      return (
        <li key={code} class={styles.resource} data-resource={code}>
          <ElCheckbox modelValue={display.checked} onUpdate:modelValue={value => setChecked(code, value === true)}>
            {resource.name}
          </ElCheckbox>
          {notices.map(notice => (
            <span key={notice} class={styles.notice}>
              {notice}
            </span>
          ))}
        </li>
      );
    };

    const renderNode = (node: CatalogNode): VNode | null => {
      if (node.kind === 'resource') {
        return renderResource(node.code);
      }
      if (!hasResources(node)) {
        return null;
      }
      return (
        <li key={node.id}>
          <span class={styles.categoryName}>{node.name}</span>
          <ul class={styles.list}>{node.children.map(renderNode)}</ul>
        </li>
      );
    };

    return () => {
      const { catalog } = props.layers.state.value;
      if (catalog) {
        return (
          <div class={styles.panel}>
            <ul class={styles.list}>{catalog.categories.map(renderNode)}</ul>
          </div>
        );
      }
      return (
        <div class={styles.panel}>
          {props.failed ? (
            <div class={styles.failure}>
              <span>资源目录加载失败</span>
              <ElButton size="small" onClick={() => emit('retry')}>
                重试
              </ElButton>
            </div>
          ) : (
            <span class={styles.loading}>正在加载资源目录…</span>
          )}
        </div>
      );
    };
  }
});
