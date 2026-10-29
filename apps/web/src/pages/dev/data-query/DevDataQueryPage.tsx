import { ElRadioButton, ElRadioGroup } from 'element-plus';
import { defineComponent, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { QUERY_TOPICS, type TopicId } from '@/features/data-query/topics';
import { RouteName } from '@/shared/router/route-names';
import { DataQueryPage } from '../../data-query/DataQueryPage';
import styles from './DevDataQueryPage.module.scss';

const TOPIC_IDS = Object.keys(QUERY_TOPICS) as TopicId[];

/**
 * 数据查询的实测页：挂真实的页面，请求真实的查询接口和瓦片（这几个接口不校验登录，开发页不登录）；
 * 导出接口未登录时后端报错，导出在登录后的业务页验收
 */
export const DevDataQueryPage = defineComponent({
  name: 'DevDataQueryPage',
  setup() {
    const topic = ref<TopicId>('space-monitoring');

    return () => (
      <div class={styles.root}>
        <div class={styles.bar}>
          <strong>数据查询实测</strong>
          <span>专题</span>
          <ElRadioGroup
            size="small"
            modelValue={topic.value}
            onUpdate:modelValue={value => (topic.value = TOPIC_IDS.find(id => id === value) ?? topic.value)}
          >
            {TOPIC_IDS.map(id => (
              <ElRadioButton key={id} value={id}>
                {QUERY_TOPICS[id].title}
              </ElRadioButton>
            ))}
          </ElRadioGroup>
          <span>真实接口，不登录</span>
          <RouterLink class={styles.link} to={{ name: RouteName.devTheme }}>
            主题预览
          </RouterLink>
        </div>
        <div class={styles.stage}>
          <DataQueryPage topic={topic.value} />
        </div>
      </div>
    );
  }
});
