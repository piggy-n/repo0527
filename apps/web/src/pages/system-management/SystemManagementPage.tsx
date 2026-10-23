import { defineComponent, type PropType, watch } from 'vue';
import { useRouter } from 'vue-router';
import { fetchSystemFile, type SystemDownloadTarget, type SystemSection } from '@/features/system-management/api';
import { SystemManagementView } from '@/features/system-management/components/SystemManagementView';
import { useApplicationAudit } from '@/features/system-management/composables/useApplicationAudit';
import { useSystemList } from '@/features/system-management/composables/useSystemList';
import { useDownloads } from '@/shared/file-transfer/useDownloads';
import { navigate } from '@/shared/router/navigate';
import { RouteName } from '@/shared/router/route-names';

// 切换菜单时重建筛选与详情，下载任务由上层持有，仍能查看进度和取消
const SystemSectionContent = defineComponent({
  name: 'SystemSectionContent',
  props: {
    section: { type: String as PropType<SystemSection>, required: true },
    applicationId: String,
    downloads: { type: Object as PropType<ReturnType<typeof useDownloads<SystemDownloadTarget>>>, required: true }
  },
  setup(props) {
    const router = useRouter();
    const list = useSystemList(props.section);
    const audit = useApplicationAudit();

    // 消息入口只负责打开详情，审核权限仍由服务端详情状态决定；消费后清除一次性参数
    watch(() => props.applicationId, id => {
      if (props.section === 'audit' && id) {
        audit.open(id);
        void navigate(router, { name: RouteName.systemManagement, params: { section: '' }, replace: true });
      }
    }, { immediate: true });

    function select(section: SystemSection) {
      void navigate(router, {
        name: RouteName.systemManagement,
        params: { section: section === 'reports' ? 'statistical-report' : '' }
      });
    }

    return () => (
      <SystemManagementView
        section={props.section}
        list={list}
        audit={audit}
        downloads={props.downloads}
        onSelect={select}
      />
    );
  }
});

export const SystemManagementPage = defineComponent({
  name: 'SystemManagementPage',
  props: {
    section: { type: String as PropType<SystemSection>, required: true },
    applicationId: String
  },
  setup(props) {
    const downloads = useDownloads(fetchSystemFile);
    return () => (
      <SystemSectionContent
        key={props.section}
        section={props.section}
        applicationId={props.applicationId}
        downloads={downloads}
      />
    );
  }
});
