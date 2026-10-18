import { ElButton } from 'element-plus';
import { computed, defineComponent, type PropType, ref, shallowRef } from 'vue';
import type { ViewKind } from '@yzt/map-core';
import { SwitchableMapCanvas, type MapViewSwitchState, type SwitchableMapCanvasHandle, provideMap } from '@yzt/map-vue';
import styles from './DevCesiumPage.module.scss';
import { INITIAL_SAMPLE_STYLE_STATE, sampleStyleGroup } from './sample-style';
import { sampleOverlayGroups } from './sample-overlays';

/** 二三维基础样式的验证入口：共享样式、相机与生命周期 */
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
    const sample = shallowRef(INITIAL_SAMPLE_STYLE_STATE);
    const overlays = computed(() => sampleOverlayGroups(sample.value));
    const state = shallowRef<MapViewSwitchState>({ current: null, target: '2d', status: 'loading' });
    const map = provideMap({
      groups: ['sample', 'selection', 'region-clip', 'region', 'measure'],
      camera: { center: [119.2, 32.8], zoom: 4, bearing: 0, pitch: 0 }
    });
    map.bindStyle({
      sample: () => sampleStyleGroup(sample.value),
      selection: () => overlays.value.selection,
      'region-clip': () => overlays.value['region-clip'],
      region: () => overlays.value.region,
      measure: () => overlays.value.measure
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
          <strong>Cesium · 3D.3c</strong>
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
            control.flyTo({ center: [118.8, 32.05], zoom: 11, bearing: 25, pitch: 40 }, { duration: 300 });
          })}>定位到南京</ElButton>
          <ElButton disabled={!mounted.value} onClick={() => map.runCameraOperation(control => {
            control.fitBounds([116.3, 30.7, 121.9, 35.2], { pitch: 0, duration: 300 });
          })}>江苏范围</ElButton>
          <ElButton onClick={() => { sample.value = { ...sample.value, visible: !sample.value.visible }; }}>
            {sample.value.visible ? '隐藏样例' : '显示样例'}
          </ElButton>
          <ElButton onClick={() => {
            sample.value = { ...sample.value, alternateColors: !sample.value.alternateColors };
          }}>样例变色</ElButton>
          <ElButton onClick={() => { sample.value = { ...sample.value, rasterAbove: !sample.value.rasterAbove }; }}>
            {sample.value.rasterAbove ? '栅格移到面下' : '栅格移到面上'}
          </ElButton>
          <span
            data-cesium-state={mounted.value ? state.value.status : 'disposed'}
            data-current-view={mounted.value ? state.value.current ?? '' : ''}
          >
            {mounted.value && state.value.current ? (state.value.current === '2d' ? '二维 · ' : '三维 · ') : ''}
            {statusText()}
          </span>
        </header>
        <p class={styles.description}>
          点击“定位到南京”查看本地花纹、虚线、高亮与带洞区划遮罩；两个视图共用显隐、配色和叠放顺序
        </p>
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
