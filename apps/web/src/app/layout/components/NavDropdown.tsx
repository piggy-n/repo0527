import { ArrowRight } from '@element-plus/icons-vue';
import { ElIcon, ElPopover, type PopoverInstance } from 'element-plus';
import { computed, defineComponent, type PropType, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { isNavItemActive, type NavDropdown as NavDropdownItem, type NavLinkTarget, type NavMenu } from '../menus';
import styles from './HeaderNav.module.scss';

/** 下拉的导航项：两级下拉左列是分组，悬停或聚焦分组时右列显示该组的页面；一层下拉只有一列页面 */
export const NavDropdown = defineComponent({
  name: 'NavDropdown',
  props: {
    item: { type: Object as PropType<NavDropdownItem | NavMenu>, required: true }
  },
  setup(props) {
    const route = useRoute();
    const router = useRouter();
    const popoverRef = ref<PopoverInstance>();
    const groups = computed(() => (props.item.kind === 'dropdown' ? props.item.groups : []));

    // 默认显示当前页面所在的分组
    const initialGroup = () =>
      Math.max(
        groups.value.findIndex(group => group.links.some(link => link.route === route.name)),
        0
      );
    const activeGroup = ref(initialGroup());
    const links = computed(() =>
      props.item.kind === 'menu' ? props.item.links : (groups.value[activeGroup.value]?.links ?? [])
    );
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

    // 新标签页打开的页面（驾驶舱）用普通链接交给浏览器，当前页面不变，点完关上面板
    const renderLink = (link: NavLinkTarget) =>
      link.newTab ? (
        <a
          key={link.route}
          href={router.resolve({ name: link.route }).href}
          target="_blank"
          rel="noopener"
          class={styles.option}
          onClick={() => popoverRef.value?.hide()}
        >
          {link.label}
        </a>
      ) : (
        <RouterLink
          key={link.route}
          to={{ name: link.route }}
          class={[styles.option, link.route === route.name && styles.optionActive]}
        >
          {link.label}
        </RouterLink>
      );

    const renderLinks = () => (
      <div class={[styles.links, props.item.kind === 'menu' && styles.single]}>{links.value.map(renderLink)}</div>
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
          default: () =>
            props.item.kind === 'menu' ? (
              renderLinks()
            ) : (
              <div class={styles.panel}>
                <div class={styles.groups}>
                  {groups.value.map((group, index) => (
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
                {renderLinks()}
              </div>
            )
        }}
      </ElPopover>
    );
  }
});
