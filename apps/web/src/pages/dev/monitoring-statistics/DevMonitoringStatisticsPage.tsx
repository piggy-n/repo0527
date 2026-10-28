import { QueryClient, VUE_QUERY_CLIENT } from '@tanstack/vue-query';
import { ElButton, ElCheckbox, ElRadioButton, ElRadioGroup } from 'element-plus';
import { defineComponent, onUnmounted, provide, ref, shallowRef } from 'vue';
import { RouterLink } from 'vue-router';
import { Role } from '@/shared/auth/roles';
import type { SessionGuard } from '@/shared/auth/session-guard';
import { RouteName } from '@/shared/router/route-names';
import { SpaceMonitoringStatisticsPage } from '../../space-monitoring-statistics/SpaceMonitoringStatisticsPage';
import { createDemoApi, type DemoSwitches } from './demo-api';
import styles from './DevMonitoringStatisticsPage.module.scss';

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

const LATENCIES = [0, 300, 2000] as const;

const CREATE_RESULTS: readonly { readonly value: DemoSwitches['createResult']; readonly label: string }[] = [
  { value: 'accepted', label: '成功' },
  { value: 'rejected', label: '被拒绝' },
  { value: 'uncertain', label: '无响应' }
];

// 样例不登录：写操作的会话核对总是通过
const DEMO_GUARD: SessionGuard = {
  capture: () => 'demo',
  isCurrent: () => true,
  assertCurrent: () => undefined
};

/**
 * 基本统计的组件样例：真实页面换上固定数据的接口，不请求后端。2025 年有已统计完的组合、处理中的区级和没有任务的组合，
 * 2026 年只有可选项；提交后 3 秒开始、25 秒统计完
 */
export const DevMonitoringStatisticsPage = defineComponent({
  name: 'DevMonitoringStatisticsPage',
  setup() {
    const demo = shallowRef(createDemoApi());
    const round = ref(0);
    const role = ref<Role>(Role.admin);
    const restore = () => {
      demo.value = createDemoApi();
      round.value++;
    };

    return () => {
      const { switches } = demo.value;
      const toggle = (key: 'overviewFails' | 'reportFails', label: string) => (
        <ElCheckbox modelValue={switches[key]} onChange={value => (switches[key] = value === true)}>
          {label}
        </ElCheckbox>
      );
      return (
        <div class={styles.root}>
          <div class={styles.bar}>
            <strong>基本统计样例</strong>
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
            <span>开始统计</span>
            <ElRadioGroup
              size="small"
              modelValue={switches.createResult}
              onUpdate:modelValue={value => {
                const option = CREATE_RESULTS.find(item => item.value === value);
                if (option) {
                  switches.createResult = option.value;
                }
              }}
            >
              {CREATE_RESULTS.map(option => (
                <ElRadioButton key={option.value} value={option.value}>
                  {option.label}
                </ElRadioButton>
              ))}
            </ElRadioGroup>
            {toggle('overviewFails', '总览失败')}
            {toggle('reportFails', '状态查询失败')}
            <span>角色</span>
            <ElRadioGroup
              size="small"
              modelValue={role.value}
              onUpdate:modelValue={value => (role.value = value === Role.user ? Role.user : Role.admin)}
            >
              <ElRadioButton value={Role.admin}>管理员</ElRadioButton>
              <ElRadioButton value={Role.user}>普通用户</ElRadioButton>
            </ElRadioGroup>
            <ElButton size="small" onClick={restore}>
              还原样例
            </ElButton>
            <RouterLink class={styles.link} to={{ name: RouteName.devTheme }}>
              主题预览
            </RouterLink>
          </div>
          <div class={styles.stage}>
            <IsolatedQueries key={round.value}>
              <SpaceMonitoringStatisticsPage api={demo.value.api} sessionGuard={DEMO_GUARD} role={role.value} />
            </IsolatedQueries>
          </div>
        </div>
      );
    };
  }
});
