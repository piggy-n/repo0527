import { ElButton, ElOption, ElSelect, ElSwitch } from 'element-plus';
import { defineComponent, ref } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { SystemTitle } from '@/shared/system-title/SystemTitle';
import { HeaderBellPreview } from './HeaderBellPreview';
import type { Role } from './message-display';
import styles from './preview.module.scss';
import {
  type DetailStyle,
  type ListScene,
  type ReadScene,
  type UnavailableAction,
  useMessageDemo
} from './useMessageDemo';

const ROLES: [Role, string][] = [
  ['admin', '管理员'],
  ['user', '普通用户']
];
const DETAIL_STYLES: [DetailStyle, string][] = [
  ['inline', 'A：列表里看全文'],
  ['drill', 'B：点开看详情']
];
const UNAVAILABLE_ACTIONS: [UnavailableAction, string][] = [
  ['disabled', '禁用并说明'],
  ['hidden', '不显示']
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

const NAV_ITEMS = ['资源管理', '现状底图', '查询统计', '文件管理', '系统管理', 'AI对话'];

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

/** 消息弹框的交互原型：仿照真实顶栏放消息按钮，弹框和列表是要用的写法，数据固定、不请求接口 */
export const DevMessageCenterPage = defineComponent({
  name: 'DevMessageCenterPage',
  setup() {
    const demo = useMessageDemo();
    const header = ref<HTMLElement>();

    function renderControls() {
      return (
        <section class={styles.controlsBar}>
          <h1>消息弹框 · 交互原型</h1>
          <p class={styles.hint}>
            顶栏是仿照的（Logo、导航不能点），消息按钮、弹框和列表是要用的写法。已读只在内存里改；未读数正式实现时每 60
            秒刷新一次，这里用"收到一条新消息"模拟。最近一次跳转：<code>{demo.lastNavigation.value || '无'}</code>
          </p>
          {/* 演示选项可以收起，窄屏时给页面留出高度 */}
          <details class={styles.options} open>
            <summary>演示选项</summary>
            <div class={styles.controls}>
              {renderOption('角色', demo.role.value, ROLES, value => (demo.role.value = value))}
              {renderOption('列表与详情', demo.detailStyle.value, DETAIL_STYLES, value => {
                demo.detailStyle.value = value;
                demo.back();
              })}
              {renderOption('未迁移的入口', demo.unavailableAction.value, UNAVAILABLE_ACTIONS, value => {
                demo.unavailableAction.value = value;
              })}
              {renderOption('列表状态', demo.listScene.value, LIST_SCENES, value => (demo.listScene.value = value))}
              {renderOption('标记已读', demo.readScene.value, READ_SCENES, value => (demo.readScene.value = value))}
              <div class={styles.control}>
                <span>角标计入报表通知</span>
                <ElSwitch
                  modelValue={demo.countReports.value}
                  onUpdate:modelValue={(value: string | number | boolean) => (demo.countReports.value = value === true)}
                  size="small"
                />
              </div>
              <ElButton size="small" onClick={demo.receive}>
                收到一条新消息
              </ElButton>
            </div>
          </details>
        </section>
      );
    }

    function renderHeader() {
      return (
        <header ref={header} class={styles.appHeader}>
          <div class={styles.brand}>
            <span class={styles.logo} role="img" aria-label="一张图（江苏）" />
            <div class={styles.title}>
              <SystemTitle />
            </div>
          </div>
          <nav class={styles.nav} aria-label="仿照的导航">
            {NAV_ITEMS.map(item => (
              <span key={item} class={[styles.navItem, item === '文件管理' && styles.navItemActive]}>
                {item}
              </span>
            ))}
          </nav>
          <span class={styles.compactNav}>☰ 菜单</span>
          <div class={styles.user}>
            <HeaderBellPreview demo={demo} header={header.value} />
            <span class={styles.userName}>
              张三
              <SvgIcon name="nav-arrow-color" size={16} />
              <span class={styles.avatar}>
                <SvgIcon name="auth-user" size={18} />
              </span>
            </span>
          </div>
        </header>
      );
    }

    return () => (
      <main class={styles.page}>
        {renderControls()}
        <div class={styles.app}>
          {renderHeader()}
          <div class={styles.appMain}>
            <div class={styles.fakeAside} />
            <div class={styles.fakePanel}>
              <p>当前页面（示意）：打开消息弹框不离开这里，点业务按钮才跳转</p>
            </div>
          </div>
        </div>
      </main>
    );
  }
});
