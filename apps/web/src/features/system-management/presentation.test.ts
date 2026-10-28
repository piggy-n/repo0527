// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { taskLabel } from './presentation';

describe('数据准备状态的文字', () => {
  it('已知状态显示中文，未知状态保留原值', () => {
    expect(taskLabel('success')).toBe('处理完成');
    expect(taskLabel('archived')).toBe('archived');
  });

  it('没有状态时为空，表格由全局样式显示"-"，不另写占位字符', () => {
    expect(taskLabel(null)).toBe('');
    expect(taskLabel(undefined)).toBe('');
    expect(taskLabel('')).toBe('');
  });
});
