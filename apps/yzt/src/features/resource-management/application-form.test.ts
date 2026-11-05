// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { applicationRequest, createApplicationForm, formatsForLayer, matchDataLayer } from './application-form';
import { resourceRow } from './test-data';

describe('数据下载申请的表单', () => {
  it('按"数据集_图层_年份"的小写匹配可申请图层，对不上时留空', () => {
    expect(matchDataLayer(resourceRow({ datasetCode: 'BGDC', layerCode: 'DLTB', year: 2022 }))).toBe('bgdc_dltb_2022');
    expect(matchDataLayer(resourceRow({ datasetCode: 'cxjc', layerCode: 'cwjq', year: 2022 }))).toBe('');
    expect(matchDataLayer(resourceRow({ year: null }))).toBe('');
  });

  it('默认值：数据名称取资源名称，全省，从现在到一个月后，格式不预选', () => {
    const form = createApplicationForm(resourceRow({ name: '地类图斑' }), new Date(2026, 9, 27, 9, 5, 0));

    expect(form).toEqual({
      applyName: '地类图斑',
      layerCode: 'bgdc_dltb_2022',
      regionPath: ['320000'],
      startTime: '2026-10-27 09:05:00',
      endTime: '2026-11-27 09:05:00',
      formats: [],
      purpose: ''
    });
  });

  it('学校的两层可以申请全部五种格式，其余图层只有 Excel、SHP、GDB', () => {
    expect(formatsForLayer('csxhjctb_xxa_2022')).toEqual(['Excel', 'Word', 'Echarts', 'SHP', 'GDB']);
    expect(formatsForLayer('bgdc_dltb_2022')).toEqual(['Excel', 'SHP', 'GDB']);
  });

  it('提交的正文：区划取最后一级，格式转成小写逗号串，管理员固定发送默认处室', () => {
    const form = {
      ...createApplicationForm(resourceRow(), new Date(2026, 9, 27)),
      applyName: ' 地类图斑 ',
      regionPath: ['320000', '320100'],
      formats: ['Excel' as const, 'SHP' as const],
      purpose: ' 年度台账 '
    };

    expect(applicationRequest(form)).toEqual({
      applyName: '地类图斑',
      receiverDeptCode: 'jsdxzx',
      layerCode: 'bgdc_dltb_2022',
      startDate: '2026-10-27 00:00:00',
      endDate: '2026-11-27 00:00:00',
      xzqdm: '320100',
      dataFormats: 'excel,shp',
      applyPurpose: '年度台账'
    });
  });
});
