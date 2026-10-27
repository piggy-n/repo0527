import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, type EffectScope } from 'vue';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import { required } from '@/shared/testing/required';
import { type LayerServiceDraft, mapServiceMeta } from '../layer-services';
import { useLayerServiceStore } from '../store';
import { resourceRow } from '../test-data';
import { useLayerServices } from './useLayerServices';

const scopes: EffectScope[] = [];
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop());
  localStorage.clear();
  vi.unstubAllGlobals();
});

const row = resourceRow();
const draft: LayerServiceDraft = {
  name: ' 年度 WMS ',
  type: 'WMS',
  url: ' https://example.invalid/wms ',
  status: 'enabled'
};

function startSession(token = createTestJwtExpiringAt(Date.now() + 3_600_000)) {
  useSessionStore().start({ token, user: { loginName: 'admin', role: Role.admin } });
}

function host() {
  setActivePinia(createPinia());
  startSession();
  const scope = effectScope();
  scopes.push(scope);
  const owner = required(scope.run(useLayerServices), '服务弹窗的拥有者');
  return { owner, scope, store: useLayerServiceStore() };
}

describe('useLayerServiceStore', () => {
  it('按资源和类别分开保存，名称和地址去掉首尾空白；普通 HTTP 内网没有 randomUUID 也能新增', () => {
    const { store } = host();
    vi.stubGlobal('crypto', {});

    expect(store.save(row.id, 'map', draft)).toBe(true);
    expect(store.save(row.id, 'map', { ...draft, name: '第二个' })).toBe(true);

    const [first, second] = store.items(row.id, 'map');
    expect(first).toMatchObject({ name: '年度 WMS', url: 'https://example.invalid/wms' });
    expect(first.id).not.toBe(second.id);
    expect(store.items(row.id, 'interface')).toEqual([]);
    expect(store.items('layer-2', 'map')).toEqual([]);
  });

  it('空白的名称或地址、不属于该类别的类型、已删除的记录都不能保存', () => {
    const { store } = host();
    store.save(row.id, 'map', draft);
    const [saved] = store.items(row.id, 'map');

    expect(store.save(row.id, 'map', { ...draft, name: '  ' })).toBe(false);
    expect(store.save(row.id, 'map', { ...draft, url: '  ' })).toBe(false);
    expect(store.save(row.id, 'interface', draft)).toBe(false);
    expect(store.remove(row.id, 'map', saved.id)).toBe(true);
    expect(store.save(row.id, 'map', draft, saved.id)).toBe(false);
    expect(store.items(row.id, 'map')).toEqual([]);
  });

  it('地图服务按类型得到旧页面的坐标系和格式，数据接口没有', () => {
    expect(mapServiceMeta('MVT')).toEqual({ crs: 'EPSG:3857', format: 'PBF' });
    expect(mapServiceMeta('WMTS')).toEqual({ crs: 'EPSG:4490', format: 'WebMercator' });
    expect(mapServiceMeta('RESTful')).toBeNull();
  });
});

describe('useLayerServices', () => {
  it('表格上的加号直接打开新增表单，不打开列表；保存后数量增加', () => {
    const { owner } = host();

    owner.openForm(row, 'interface');

    expect(owner.listOpen.value).toBe(false);
    const editor = required(owner.editor.value, '新增表单');
    expect(editor.draft).toMatchObject({ name: '', type: 'JSON', status: 'enabled' });
    Object.assign(editor.draft, { name: '查询接口', url: 'https://example.invalid/query' });
    expect(owner.save(editor)).toBe(true);
    expect(owner.formOpen.value).toBe(false);
    expect(owner.count(row.id, 'interface')).toBe(1);
  });

  it('编辑的是副本：取消后原记录不变；表单关闭或重新打开后，旧的那份不能再保存', () => {
    const { owner, store } = host();
    store.save(row.id, 'map', draft);
    owner.openList(row, 'map');
    const [item] = owner.items.value;

    owner.edit(item);
    const cancelled = required(owner.editor.value, '编辑表单');
    cancelled.draft.name = '没有保存的名称';
    owner.closeForm();
    expect(owner.save(cancelled)).toBe(false);
    expect(owner.items.value[0].name).toBe('年度 WMS');
    expect(owner.listOpen.value).toBe(true);

    owner.edit(item);
    expect(owner.save(cancelled)).toBe(false);
    const reopened = required(owner.editor.value, '重新打开的表单');
    reopened.draft.type = 'MVT';
    expect(owner.save(reopened)).toBe(true);
    expect(owner.items.value).toHaveLength(1);
    expect(owner.items.value[0]).toMatchObject({ id: item.id, type: 'MVT' });
  });

  it('删除要确认：取消保留，确认只删这一条，重复确认不再删除', () => {
    const { owner, store } = host();
    store.save(row.id, 'map', draft);
    store.save(row.id, 'map', { ...draft, name: '第二个' });
    owner.openList(row, 'map');
    const [first] = owner.items.value;

    owner.requestRemoval(first);
    expect(owner.answerRemoval(false)).toBe(false);
    expect(owner.items.value).toHaveLength(2);

    owner.requestRemoval(first);
    expect(owner.answerRemoval(true)).toBe(true);
    expect(owner.answerRemoval(true)).toBe(false);
    expect(owner.items.value.map(item => item.name)).toEqual(['第二个']);
    expect(owner.listOpen.value).toBe(true);
  });

  it('离开页面后记录仍在；换会话时清空记录并关掉开着的弹窗', () => {
    const { owner, scope, store } = host();
    store.save(row.id, 'map', draft);
    owner.openList(row, 'map');
    scope.stop();
    expect(owner.listOpen.value).toBe(false);
    expect(store.items(row.id, 'map')).toHaveLength(1);

    const nextScope = effectScope();
    scopes.push(nextScope);
    const next = required(nextScope.run(useLayerServices), '重新进入页面的拥有者');
    next.openList(row, 'map');
    next.requestRemoval(next.items.value[0]);
    startSession(createTestJwtExpiringAt(Date.now() + 7_200_000));

    expect(store.records).toEqual({});
    expect(next.listOpen.value).toBe(false);
    expect(next.removalOpen.value).toBe(false);
    expect(next.answerRemoval(true)).toBe(false);
  });
});
