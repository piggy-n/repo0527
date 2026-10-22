import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import * as api from './api';
import {
  useResourceDetailMutation, useResourceDirectoryMutation, useResourceImportMutation, useResourceStatusMutation
} from './queries';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('资源写入的会话边界', () => {
  it.each(['directory', 'detail', 'status', 'import'] as const)('%s 调度前换会话不发送旧操作', async kind => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const session = useSessionStore();
    const token = createTestJwtExpiringAt(Date.now() + 3600000);
    session.start({ token, user: { loginName: 'first', role: Role.admin } });
    const queryClient = new QueryClient();
    const requests = [
      vi.spyOn(api, 'changeResourceDirectory').mockResolvedValue(undefined),
      vi.spyOn(api, 'saveResourceDetail').mockResolvedValue(undefined),
      vi.spyOn(api, 'setResourceStatus').mockResolvedValue(undefined),
      vi.spyOn(api, 'importResourceExcel').mockResolvedValue(undefined)
    ];
    let submit!: () => Promise<unknown>;
    const wrapper = mount(defineComponent({ setup() {
      const directory = useResourceDirectoryMutation();
      const detail = useResourceDetailMutation();
      const status = useResourceStatusMutation();
      const importer = useResourceImportMutation();
      const operations = {
        directory: () => directory.mutateAsync({ change: { kind: 'remove', id: 'one' }, token }),
        detail: () => detail.mutateAsync({ change: { id: 'one', resourceName: '土地资源', attributes: [] }, token }),
        status: () => status.mutateAsync({ id: 'one', enabled: true, token }),
        import: () => importer.mutateAsync({ input: { file: new File(['test'], 'test.xlsx'), year: 2026 },
          token, onProgress: () => undefined })
      };
      submit = operations[kind];
      return () => null;
    } }), { global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] } });
    try {
      const done = submit();
      session.start({ token: createTestJwtExpiringAt(Date.now() + 7200000),
        user: { loginName: 'second', role: Role.admin } });
      await expect(done).rejects.toMatchObject({ kind: 'canceled' });
      for (const request of requests) {
        expect(request).not.toHaveBeenCalled();
      }
    } finally {
      wrapper.unmount();
      queryClient.clear();
    }
  });
});
