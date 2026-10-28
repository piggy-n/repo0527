// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { required } from '@/shared/testing/required';
import { QUERY_LAYERS } from './config';
import { recordText, resultColumns } from './result-fields';

describe('查询结果的字段与文本', () => {
  it('使用业务字段和公共名称，排除几何并保留额外返回字段', () => {
    const layer = QUERY_LAYERS.city[0];
    const name = required(layer.fields.find(field => field.code === 'NAME'), '学校名称字段');
    const rows = [
      { name: '学校', geom: '长坐标', BSM: '001' },
      { name: '学校二', extra: '新增属性' }
    ];
    expect(resultColumns(layer, rows)).toEqual([
      { code: 'name', label: name.label },
      { code: 'BSM', label: '标识码' },
      { code: 'extra', label: 'extra' }
    ]);
  });

  it('保留 0 和 false，空值留给统一表格占位样式', () => {
    expect(recordText(0)).toBe('0');
    expect(recordText(false)).toBe('false');
    expect(recordText(null)).toBe('');
    expect(recordText(undefined)).toBe('');
  });

  it('含标签的字符串仍按原文交给文本插槽，不拼接 HTML', () => {
    expect(recordText('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
    expect(recordText({ name: '学校' })).toBe('{"name":"学校"}');
  });
});
