import { ElButton } from 'element-plus';
import { defineComponent, ref, shallowRef } from 'vue';
import { CesiumCanvas, type CesiumCanvasState, provideMap } from '@yzt/map-vue';
import styles from './DevCesiumPage.module.scss';

/** 三维接入的验证入口：本地底图、共享相机与生命周期 */
export const DevCesiumPage = defineComponent({
  name: 'DevCesiumPage',
  props: {
    assetBaseUrl: { type: String, required: true }
  },
  setup(props) {
    const canvas = ref<{ retry(): Promise<void> }>();
    const mounted = ref(true);
    const active = ref(true);
    const broken = ref(false);
    const state = shallowRef<CesiumCanvasState>({ status: 'loading' });
    const map = provideMap({
      groups: [],
      camera: { center: [119.2, 32.8], zoom: 4, bearing: 0, pitch: 0 }
    });
    const camera = map.useCamera();

    const statusText = () => {
      if (!mounted.value) {
        return '已释放';
      }
      if (state.value.status === 'loading') {
        return '加载中';
      }
      if (state.value.status === 'failed') {
        return '加载失败';
      }
      return active.value ? '已就绪' : '已暂停';
    };

    // 恢复正确的资源地址后由画布自动重建，其余失败直接重试
    const retry = () => {
      if (broken.value) {
        broken.value = false;
      } else {
        void canvas.value?.retry();
      }
    };

    return () => (
      <div class={styles.root}>
        <header class={styles.toolbar}>
          <strong>Cesium · 3D.2b</strong>
          <ElButton onClick={() => (mounted.value = !mounted.value)}>
            {mounted.value ? '释放画布' : '创建画布'}
          </ElButton>
          <ElButton disabled={!mounted.value} onClick={() => (active.value = !active.value)}>
            {active.value ? '暂停' : '恢复'}
          </ElButton>
          <ElButton disabled={!mounted.value} onClick={retry}>重新创建 / 重试</ElButton>
          <ElButton disabled={!mounted.value || broken.value} onClick={() => (broken.value = true)}>
            模拟底图加载失败
          </ElButton>
          <ElButton disabled={!mounted.value} onClick={() => map.runCameraOperation(control => {
            control.flyTo({ center: [118.8, 32.05], zoom: 10, bearing: 25, pitch: 40 }, { duration: 300 });
          })}>定位到南京</ElButton>
          <ElButton disabled={!mounted.value} onClick={() => map.runCameraOperation(control => {
            control.fitBounds([116.3, 30.7, 121.9, 35.2], { pitch: 0, duration: 300 });
          })}>江苏范围</ElButton>
          <span data-cesium-state={mounted.value ? state.value.status : 'disposed'}>
            {statusText()}
          </span>
        </header>
        <p class={styles.description}>仅使用随构建部署的 Natural Earth II 低精度底图与椭球地形</p>
        <p class={styles.description} data-session-camera>
          会话相机：{camera.value.center.map(value => value.toFixed(5)).join(', ')}
          {' · '}级别 {camera.value.zoom.toFixed(2)}
          {' · '}方位 {camera.value.bearing.toFixed(1)}°
          {' · '}俯角 {camera.value.pitch.toFixed(1)}°
        </p>
        {mounted.value && state.value.status === 'failed' && (
          <p class={styles.error} role="alert">{state.value.message}</p>
        )}
        <main class={styles.mapArea}>
          {mounted.value && (
            <CesiumCanvas
              ref={canvas}
              assetBaseUrl={broken.value ? `${props.assetBaseUrl}missing/` : props.assetBaseUrl}
              active={active.value}
              onState={value => (state.value = value)}
            />
          )}
        </main>
      </div>
    );
  }
});
