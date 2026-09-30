import { ArrowDown, SwitchButton } from '@element-plus/icons-vue';
import { ElDropdown, ElDropdownItem, ElDropdownMenu, ElIcon, ElMessage, ElMessageBox } from 'element-plus';
import { storeToRefs } from 'pinia';
import { defineComponent } from 'vue';
import { useRouter } from 'vue-router';
import { roleLabel } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { RouteName } from '@/shared/router/route-names';
import styles from './UserMenu.module.scss';

/** 头部右侧的用户菜单：显示名、角色与退出登录；修改密码、修改头像在迁移对应功能时再加 */
export const UserMenu = defineComponent({
  name: 'UserMenu',
  setup() {
    const router = useRouter();
    const session = useSessionStore();
    const { user, displayName } = storeToRefs(session);

    const logout = async () => {
      try {
        await ElMessageBox.confirm('确定要退出登录吗？', '提示', { type: 'warning' });
      } catch {
        // 点了取消或关闭
        return;
      }
      session.clear();
      // replace：退出后按后退键不会回到业务页（回去也会被路由守卫拦下）
      await router.replace({ name: RouteName.login });
      ElMessage.success('已退出登录');
    };

    return () =>
      user.value && (
        <ElDropdown trigger="click" placement="bottom-end">
          {{
            default: () => (
              <button type="button" class={styles.trigger}>
                <span class={styles.name}>{displayName.value}</span>
                <ElIcon class={styles.arrow}>
                  <ArrowDown />
                </ElIcon>
                <span class={styles.avatar}>
                  <SvgIcon name="auth-user" size={18} />
                </span>
              </button>
            ),
            dropdown: () => (
              <ElDropdownMenu>
                <div class={styles.who}>
                  <strong>{displayName.value}</strong>
                  <span>
                    {user.value?.loginName} · {user.value && roleLabel(user.value.role)}
                  </span>
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
