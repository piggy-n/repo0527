import { SwitchButton } from '@element-plus/icons-vue';
import { ElDropdown, ElDropdownItem, ElDropdownMenu, ElMessage, ElMessageBox } from 'element-plus';
import { storeToRefs } from 'pinia';
import { computed, defineComponent, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { roleLabel } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { navigate } from '@/shared/router/navigate';
import { RouteName } from '@/shared/router/route-names';
import { endSession } from '../../session-end';
import styles from './UserMenu.module.scss';

/**
 * 头部右侧的用户菜单：按角色显示"管理员"或"普通用户"（2026-10-30 用户要求，不显示姓名），下拉菜单里另有登录名和退出登录；
 * 修改密码、修改头像在迁移对应功能时再加
 */
export const UserMenu = defineComponent({
  name: 'UserMenu',
  setup() {
    const router = useRouter();
    const session = useSessionStore();
    const { user } = storeToRefs(session);
    const name = computed(() => (user.value ? roleLabel(user.value.role) : ''));

    // ElMessageBox 不随组件卸载关闭（例如确认框打开期间登录过期、在其他标签页退出），卸载时关掉本组件打开的确认框
    let confirmOpen = false;
    let unmounted = false;
    onBeforeUnmount(() => {
      unmounted = true;
      if (confirmOpen) {
        ElMessageBox.close();
      }
    });

    const logout = async () => {
      const token = session.token;
      confirmOpen = true;
      try {
        await ElMessageBox.confirm('确定要退出登录吗？', '提示', { type: 'warning' });
      } catch {
        // 点了取消或关闭，或组件卸载时被关闭
        return;
      } finally {
        confirmOpen = false;
      }
      // 确认期间组件已卸载，或会话已经结束、更换：会话结束时已经跳转和提示过，这里不再重复
      if (unmounted || session.token !== token) {
        return;
      }
      endSession();
      // replace：退出后按后退键不会回到业务页（回去也会被路由守卫拦下）
      if (await navigate(router, { name: RouteName.login, replace: true })) {
        ElMessage.success('已退出登录');
      }
    };

    return () =>
      user.value && (
        <ElDropdown trigger="click" placement="bottom-end">
          {{
            default: () => (
              <button type="button" class={styles.trigger}>
                <span class={styles.name}>{name.value}</span>
                <SvgIcon name="nav-arrow-color" size={16} />
                <span class={styles.avatar}>
                  <SvgIcon name="auth-user" size={18} />
                </span>
              </button>
            ),
            dropdown: () => (
              <ElDropdownMenu>
                <div class={styles.who}>
                  <strong>{name.value}</strong>
                  <span>{user.value?.loginName}</span>
                </div>
                <ElDropdownItem icon={SwitchButton} onClick={logout}>
                  退出登录
                </ElDropdownItem>
              </ElDropdownMenu>
            )
          }}
        </ElDropdown>
      );
  }
});
