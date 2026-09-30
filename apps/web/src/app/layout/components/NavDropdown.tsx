import { ArrowRight } from '@element-plus/icons-vue';
import { ElIcon, ElPopover, type PopoverInstance } from 'element-plus';
import { computed, defineComponent, type PropType, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { isNavItemActive, type NavDropdown as NavDropdownItem } from '../menus';
import styles from './HeaderNav.module.scss';

/** 两级下拉的导航项：左列是分组，悬停或聚焦分组时右列显示该组的页面 */
export const NavDropdown = defineComponent({
  name: 'NavDropdown',
  props: {
    item: { type: Object as PropType<NavDropdownItem>, required: true }
  },
  setup(props) {
    const route = useRoute();
    const popoverRef = ref<PopoverInstance>();

    // 默认显示当前页面所在的分组
    const initialGroup = () =>
      Math.max(
        props.item.groups.findIndex(group => group.links.some(link => link.route === route.name)),
        0
      );
    const activeGroup = ref(initialGroup());
    const links = computed(() => props.item.groups[activeGroup.value]?.links ?? []);
    const selectGroup = (index: number) => {
      activeGroup.value = index;
    };

    // 跳转后关闭面板，下次打开时回到当前页面所在的分组
    watch(
      () => route.name,
      () => {
        popoverRef.value?.hide();
        activeGroup.value = initialGroup();
      }
    );

    return () => (
      <ElPopover ref={popoverRef} trigger="click" placement="bottom" width="auto">
        {{
          reference: () => (
            <button
              type="button"
              class={[styles.item, isNavItemActive(props.item, route.name) && styles.active]}
            >
              <SvgIcon class={styles.icon} name={props.item.icon} size={20} />
              {props.item.label}
              <SvgIcon name="nav-arrow-color" size={16} />
            </button>
          ),
          default: () => (
            <div class={styles.panel}>
              <div class={styles.groups}>
                {props.item.groups.map((group, index) => (
                  <button
                    key={group.label}
                    type="button"
                    class={[styles.option, index === activeGroup.value && styles.optionActive]}
                    onMouseenter={() => selectGroup(index)}
                    onFocus={() => selectGroup(index)}
                  >
                    {group.label}
                    <ElIcon>
                      <ArrowRight />
                    </ElIcon>
                  </button>
                ))}
              </div>
              <div class={styles.links}>
                {links.value.map(link => (
                  <RouterLink
                    key={link.route}
                    to={{ name: link.route }}
                    class={[styles.option, link.route === route.name && styles.optionActive]}
                  >
                    {link.label}
                  </RouterLink>
                ))}
              </div>
            </div>
          )
        }}
      </ElPopover>
    );
  }
});
