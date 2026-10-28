import { QueryClient, VUE_QUERY_CLIENT } from '@tanstack/vue-query';
import { ElButton, ElCheckbox, ElRadioButton, ElRadioGroup } from 'element-plus';
import { defineComponent, onUnmounted, provide, ref, shallowRef } from 'vue';
import { RouterLink } from 'vue-router';
import type { SessionGuard } from '@/shared/auth/session-guard';
import { RouteName } from '@/shared/router/route-names';
import { SpaceMonitoringIndicatorsPage } from '../../space-monitoring-indicators/SpaceMonitoringIndicatorsPage';
import { createDemoApi } from './demo-api';
import styles from './DevMonitoringIndicatorsPage.module.scss';

// 样例用自己的查询缓存，和真实页面的同名 key 互不影响；还原样例时随组件一起换掉
const IsolatedQueries = defineComponent({
  name: 'IsolatedQueries',
  setup(_, { slots }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
    provide(VUE_QUERY_CLIENT, client);
    onUnmounted(() => client.clear());
    return () => slots.default?.();
  }
});

const LATENCIES = [0, 500, 2000] as const;

// 样例不登录：写操作的会话核对总是通过
const DEMO_GUARD: SessionGuard = {
  capture: () => 'demo',
  isCurrent: () => true,
  assertCurrent: () => undefined
};

/**
 * 监测指标的组件样例：真实页面换上固定数据的接口，地图、底图和行政区是真的，不请求后端；
 * 成果的矢量瓦片没有数据，地图上只有区划定位，子图层的显隐、改色在面板和图例上看
 */
export const DevMonitoringIndicatorsPage = defineComponent({
  name: 'DevMonitoringIndicatorsPage',
  setup() {
    const demo = shallowRef(createDemoApi());
    const round = ref(0);
    const restore = () => {
      demo.value = createDemoApi();
      round.value++;
    };

    return () => {
      const { switches } = demo.value;
      const toggle = (key: 'treeFails' | 'treeEmpty' | 'progressFails' | 'resultFails', label: string) => (
        <ElCheckbox modelValue={switches[key]} onChange={value => (switches[key] = value === true)}>
          {label}
        </ElCheckbox>
      );
      return (
        <div class={styles.root}>
          <div class={styles.bar}>
            <strong>监测指标样例</strong>
            <span>接口延迟</span>
            <ElRadioGroup
              size="small"
              modelValue={switches.latency}
              onUpdate:modelValue={value => (switches.latency = Number(value))}
            >
              {LATENCIES.map(value => (
                <ElRadioButton key={value} value={value}>
                  {value} ms
                </ElRadioButton>
              ))}
            </ElRadioGroup>
            {toggle('treeFails', '指标树失败')}
            {toggle('treeEmpty', '指标树为空')}
            {toggle('progressFails', '进度查询失败')}
            {toggle('resultFails', '成果加载失败')}
            <ElButton size="small" onClick={restore}>
              还原样例
            </ElButton>
            <RouterLink class={styles.link} to={{ name: RouteName.devTheme }}>
              主题预览
            </RouterLink>
          </div>
          <div class={styles.stage}>
            <IsolatedQueries key={round.value}>
              <SpaceMonitoringIndicatorsPage api={demo.value.api} sessionGuard={DEMO_GUARD} />
            </IsolatedQueries>
          </div>
        </div>
      );
    };
  }
});
