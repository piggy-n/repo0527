import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import { required } from '@/shared/testing/required';
import { type LayerServicesOwner, useLayerServices } from '../composables/useLayerServices';
import { useLayerServiceStore } from '../store';
import { resourceRow } from '../test-data';
import { ResourceServiceDialogs } from './ResourceServiceDialogs';

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

const row = resourceRow();

function host() {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().start({
    token: createTestJwtExpiringAt(Date.now() + 3_600_000),
    user: { loginName: 'admin', role: Role.admin }
  });
  let owner: LayerServicesOwner | undefined;
  mount(
    defineComponent(() => {
      const services = useLayerServices();
      owner = services;
      return () => <ResourceServiceDialogs owner={services} />;
    }),
    { attachTo: document.body, global: { plugins: [pinia] } }
  );
  return { owner: required(owner, '服务弹窗的拥有者'), store: useLayerServiceStore() };
}

function dialog(title: string): HTMLElement {
  return required(document.querySelector<HTMLElement>(`[role="dialog"][aria-label="${title}"]`), `「${title}」弹窗`);
}

async function click(root: HTMLElement, text: string) {
  const buttons = [...root.querySelectorAll('button')];
  required(buttons.find(button => button.textContent?.trim() === text), `「${text}」按钮`).click();
  await flushPromises();
}

function input(root: HTMLElement, placeholder: string): HTMLInputElement {
  return required(root.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`), `「${placeholder}」输入框`);
}

async function fill(root: HTMLElement, placeholder: string, value: string) {
  const element = input(root, placeholder);
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  await flushPromises();
}

describe('ResourceServiceDialogs', () => {
  it('从空列表新增：必填校验拦住空表单，保存后列表不关闭并显示派生的坐标系和格式', async () => {
    const { owner, store } = host();
    owner.openList(row, 'map');
    await flushPromises();
    const list = dialog('地图服务列表');
    expect(list.textContent).toContain('暂无地图服务');
    expect(list.textContent).toContain('地类图斑 · 2022');

    await click(list, '新增');
    const form = dialog('新增地图服务');
    await click(form, '确定');
    // Element 的表单项各自延迟 100 毫秒显示校验提示，两条提示可能不在同一轮出现，要一起等
    await vi.waitFor(() => {
      expect(form.textContent).toContain('请输入服务名称');
      expect(form.textContent).toContain('请输入服务地址');
    });
    expect(store.items(row.id, 'map')).toEqual([]);

    await fill(form, '请输入服务名称', '年度地图服务');
    await fill(form, '请输入服务地址', 'https://example.invalid/wms');
    await click(form, '确定');
    await vi.waitFor(() => expect(owner.formOpen.value).toBe(false));
    expect(owner.listOpen.value).toBe(true);
    expect(list.textContent).toContain('年度地图服务');
    expect(list.textContent).toContain('EPSG:4490');
    expect(list.textContent).toContain('PNG');
  });

  it('输入法选字时的回车不提交，普通回车提交', async () => {
    const { owner, store } = host();
    owner.openForm(row, 'interface');
    await flushPromises();
    const form = dialog('新增数据接口');
    await fill(form, '请输入接口名称', '查询接口');
    await fill(form, '请输入接口地址', 'https://example.invalid/query');
    const address = input(form, '请输入接口地址');

    address.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    await flushPromises();
    expect(store.items(row.id, 'interface')).toEqual([]);

    address.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(store.items(row.id, 'interface')).toHaveLength(1));
  });

  it('编辑后取消不改原记录；删除取消后保留，确认后回到空列表；年份为空的资源标题只有名称', async () => {
    const { owner, store } = host();
    const yearless = resourceRow({ year: null });
    store.save(yearless.id, 'interface', {
      name: '查询接口',
      type: 'JSON',
      url: 'https://example.invalid/query',
      status: 'disabled'
    });
    owner.openList(yearless, 'interface');
    await flushPromises();
    const list = dialog('数据接口列表');
    expect(list.textContent).toContain('已停用');
    expect(list.textContent).not.toContain('·');

    await click(list, '编辑');
    const form = dialog('编辑数据接口');
    await fill(form, '请输入接口名称', '取消的名称');
    await click(form, '取消');
    expect(store.items(yearless.id, 'interface')[0].name).toBe('查询接口');

    await click(list, '删除');
    await click(dialog('删除数据接口'), '取消');
    expect(store.items(yearless.id, 'interface')).toHaveLength(1);
    await click(list, '删除');
    expect(dialog('删除数据接口').textContent).toContain('确定删除接口「查询接口」吗？');
    await click(dialog('删除数据接口'), '删除');
    expect(store.items(yearless.id, 'interface')).toEqual([]);
    expect(list.textContent).toContain('暂无数据接口');
  });
});
