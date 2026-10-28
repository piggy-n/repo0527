import { ElButton, ElMessage, ElOption, ElSelect } from 'element-plus';
import { defineComponent, ref } from 'vue';
import { MessagePanel } from '@/features/message-center/components/MessagePanel';
import type { MessageTarget } from '@/features/message-center/display';
import styles from './preview.module.scss';
import { type ListScene, type ReadScene, useMessageDemo } from './useMessageDemo';

type DemoRole = 'admin' | 'user';

const ROLES: [DemoRole, string][] = [
  ['admin', '管理员'],
  ['user', '普通用户']
];
const LIST_SCENES: [ListScene, string][] = [
  ['normal', '正常'],
  ['loading', '首次加载'],
  ['error', '加载失败'],
  ['empty', '没有消息']
];
const READ_SCENES: [ReadScene, string][] = [
  ['success', '成功'],
  ['error', '失败'],
  ['slow', '2 秒后成功']
];

// 和 app/layout/message-routes 的说明相同；页面不能导入 app
const UNAVAILABLE = '数据下载页面迁移后可用';

function describeTarget(target: MessageTarget): string {
  return target.kind === 'reports' ? '系统管理 · 统计报表' : `系统管理 · 资源审核，打开申请 ${target.applyId}`;
}

// 演示选项：一个标签加一个小号下拉
function renderOption<T extends string>(label: string, value: T, options: [T, string][], update: (value: T) => void) {
  return (
    <div class={styles.control}>
      <span>{label}</span>
      <ElSelect modelValue={value} onUpdate:modelValue={update} size="small" aria-label={label}>
        {options.map(([key, text]) => (
          <ElOption key={key} value={key} label={text} />
        ))}
      </ElSelect>
    </div>
  );
}

/** 消息的组件样例：正式的 MessagePanel 放在和弹框一样的外框里；数据固定，已读只在内存里改，不请求接口 */
export const DevMessageCenterPage = defineComponent({
  name: 'DevMessageCenterPage',
  setup() {
    const demo = useMessageDemo({ onReadError: reason => ElMessage.error(reason) });
    const role = ref<DemoRole>('admin');
    const lastTarget = ref<MessageTarget | null>(null);

    // 正式页面里能不能去由路由的 meta.roles 决定：两种目标现在都只有管理员能去
    const unavailableReason = () => (role.value === 'admin' ? null : UNAVAILABLE);

    return () => (
      <main class={styles.page}>
        <section class={styles.controlsBar}>
          <h1>消息 · 组件样例</h1>
          <p class={styles.hint}>
            弹框里的内容是正式组件 <code>MessagePanel</code>；顶栏的按钮、弹框外壳和跳转在 <code>app/layout</code> 的{' '}
            <code>HeaderMessages</code>，登录后在任意页面的顶栏右侧查看。最近一次跳转：
            <code>{lastTarget.value ? describeTarget(lastTarget.value) : '无'}</code>
          </p>
          <div class={styles.controls}>
            {renderOption('角色', role.value, ROLES, value => {
              role.value = value;
            })}
            {renderOption('列表状态', demo.listScene.value, LIST_SCENES, value => {
              demo.listScene.value = value;
            })}
            {renderOption('标记已读', demo.readScene.value, READ_SCENES, value => {
              demo.readScene.value = value;
            })}
            <ElButton size="small" onClick={demo.receive}>
              收到一条新消息
            </ElButton>
          </div>
        </section>
        <div class={styles.stage}>
          <div class={styles.frame}>
            <MessagePanel
              center={demo.center}
              unavailableReason={unavailableReason}
              onOpen={(target: MessageTarget) => {
                lastTarget.value = target;
              }}
            />
          </div>
        </div>
      </main>
    );
  }
});
