import { ElButton } from 'element-plus';
import { defineComponent, type PropType, ref, shallowRef } from 'vue';
import type { ViewKind } from '@yzt/map-core';
import { SwitchableMapCanvas, type MapViewSwitchState, type SwitchableMapCanvasHandle, provideMap } from '@yzt/map-vue';
import styles from './DevCesiumPage.module.scss';

/** 二三维切换的验证入口：本地底图、共享相机与生命周期 */
export const DevCesiumPage = defineComponent({
  name: 'DevCesiumPage',
  props: {
    assetBaseUrl: { type: String, required: true },
    prepareRuntime: { type: Function as PropType<(kind: ViewKind) => Promise<void>>, required: true }
  },
  setup(props) {
    const canvas = ref<SwitchableMapCanvasHandle>();
    const mounted = ref(true);
    const active = ref(true);
    const broken = ref(false);
    const hasCreated3d = ref(false);
    const state = shallowRef<MapViewSwitchState>({ current: null, target: '2d', status: 'loading' });
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

    // 只在首次三维加载时模拟失败，已缓存的视图不重新加载运行时
    const prepareRuntime = async (kind: ViewKind) => {
      if (kind === '3d' && broken.value) {
        throw new Error('模拟三维运行时加载失败');
      }
      await props.prepareRuntime(kind);
    };

    const updateState = (value: MapViewSwitchState) => {
      state.value = value;
      if (value.current === '3d') {
        hasCreated3d.value = true;
      }
    };

    // 解除故障后重试原目标，由切换拥有者决定是否重建
    const retry = () => {
      broken.value = false;
      void canvas.value?.retry();
    };

    return () => (
      <div class={styles.root}>
        <header class={styles.toolbar}>
          <strong>Cesium · 3D.2c</strong>
          <ElButton onClick={() => {
            mounted.value = !mounted.value;
            hasCreated3d.value = false;
            broken.value = false;
          }}>
            {mounted.value ? '释放画布' : '创建画布'}
          </ElButton>
          <ElButton disabled={!mounted.value} onClick={() => { void canvas.value?.switchTo('2d'); }}>
            二维
          </ElButton>
          <ElButton disabled={!mounted.value} onClick={() => { void canvas.value?.switchTo('3d'); }}>
            三维
          </ElButton>
          <ElButton disabled={!mounted.value} onClick={() => (active.value = !active.value)}>
            {active.value ? '暂停' : '恢复'}
          </ElButton>
          <ElButton disabled={!mounted.value} onClick={retry}>重试</ElButton>
          <ElButton disabled={!mounted.value || broken.value || hasCreated3d.value} onClick={() => {
            broken.value = true;
            void canvas.value?.switchTo('3d');
          }}>
            模拟首次三维加载失败
          </ElButton>
          <ElButton disabled={!mounted.value} onClick={() => map.runCameraOperation(control => {
            control.flyTo({ center: [118.8, 32.05], zoom: 10, bearing: 25, pitch: 40 }, { duration: 300 });
          })}>定位到南京</ElButton>
          <ElButton disabled={!mounted.value} onClick={() => map.runCameraOperation(control => {
            control.fitBounds([116.3, 30.7, 121.9, 35.2], { pitch: 0, duration: 300 });
          })}>江苏范围</ElButton>
          <span
            data-cesium-state={mounted.value ? state.value.status : 'disposed'}
            data-current-view={mounted.value ? state.value.current ?? '' : ''}
          >
            {mounted.value && state.value.current ? (state.value.current === '2d' ? '二维 · ' : '三维 · ') : ''}
            {statusText()}
          </span>
        </header>
        <p class={styles.description}>二维为空白底图，三维仅使用本地 Natural Earth II 底图与椭球地形；已创建的视图保留供切换复用</p>
        <p class={styles.description} data-session-camera>
          会话相机：{camera.value.center.map(value => value.toFixed(5)).join(', ')}
          {' · '}级别 {camera.value.zoom.toFixed(2)}
          {' · '}方位 {camera.value.bearing.toFixed(1)}°
          {' · '}俯角 {camera.value.pitch.toFixed(1)}°
        </p>
        {mounted.value && state.value.status === 'failed' && (
          <p class={styles.error} role="alert">
            {state.value.error instanceof Error ? state.value.error.message : '地图切换失败，请重试'}
          </p>
        )}
        <main class={styles.mapArea}>
          {mounted.value && (
            <SwitchableMapCanvas
              ref={canvas}
              assetBaseUrl={props.assetBaseUrl}
              prepareRuntime={prepareRuntime}
              active={active.value}
              onState={updateState}
            />
          )}
        </main>
      </div>
    );
  }
});
