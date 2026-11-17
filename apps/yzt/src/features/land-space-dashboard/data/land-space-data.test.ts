// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { required } from '@/shared/testing/required';
import data from './land-space-2025.json';
import { LAND_SPACE_DATA, LAND_SPACE_DOMAINS, LAND_SPACE_YEAR, partValueId } from './land-space-data';

const NANJING = '320100';
const TAIZHOU = '321200';
const AIRPORT = '与机场之间距离';

const subIndices = LAND_SPACE_DOMAINS.flatMap(domain => domain.subIndices);
const indicators = subIndices.flatMap(sub => sub.indicators);

function domainOf(indexId: string) {
  return required(LAND_SPACE_DOMAINS.find(domain => domain.indexId === indexId), `一级指数为 ${indexId} 的一级`);
}

function indicatorOf(id: string) {
  return required(indicators.find(indicator => indicator.id === id), `三级 ${id}`);
}

function valueOf(cityCode: string, indicatorId: string, partId: string | null = null) {
  return LAND_SPACE_DATA.value(LAND_SPACE_YEAR, cityCode, partValueId(indicatorId, partId));
}

describe('综合分析的指标目录', () => {
  it('6 个一级按「指标字典」的顺序，各自的二级数量', () => {
    expect(LAND_SPACE_DOMAINS.map(domain => domain.name)).toEqual([
      '生活宜居便利性',
      '公共资源人均享有度',
      '公共服务均衡普惠性',
      '城市安全韧性',
      '交通网络通达性',
      '建筑与住宅规模结构合理性'
    ]);
    expect(LAND_SPACE_DOMAINS.map(domain => domain.indexId)).toEqual(['I01', 'I09', 'I17', 'I20', 'I21', 'I27']);
    expect(LAND_SPACE_DOMAINS.map(domain => domain.subIndices.length)).toEqual([7, 7, 2, 1, 5, 1]);
  });

  it('二级的名称取「二级分类」', () => {
    expect(domainOf('I01').subIndices.map(sub => sub.name)).toEqual([
      '教育便利性',
      '就医便利性',
      '文化活动便利性',
      '体育活动便利性',
      '养老便利性',
      '休闲便利性',
      '交通出行便利性'
    ]);
  });

  it('剔除了 M51：目录、各市的值和全省值里都没有', () => {
    expect(indicators.map(indicator => indicator.id)).not.toContain('M51');
    expect(domainOf('I20').subIndices.flatMap(sub => sub.indicators.map(indicator => indicator.id))).toEqual([
      'M48',
      'M49',
      'M50'
    ]);
    const valueIds = [...Object.keys(data.values), ...Object.keys(data.province)];
    expect(valueIds).toContain('M50');
    expect(valueIds.filter(id => id.split(':')[0] === 'M51')).toEqual([]);
  });

  it('只有体育活动便利性、养老便利性、城乡融合水平没有二级指数值', () => {
    const withoutValues = ['I05', 'I06', 'I26'];
    expect(subIndices.filter(sub => !sub.hasValues).map(sub => sub.indexId)).toEqual(withoutValues);
    for (const city of JIANGSU_CITIES) {
      expect(withoutValues.map(indexId => valueOf(city.code, indexId))).toEqual([null, null, null]);
    }
  });

  it('城市安全韧性和建筑与住宅规模结构合理性的一级指数也是它唯一的二级', () => {
    for (const indexId of ['I20', 'I27']) {
      const [sub, ...rest] = domainOf(indexId).subIndices;
      expect(rest).toEqual([]);
      expect(required(sub, `${indexId} 的二级`)).toMatchObject({ indexId, hasValues: true });
    }
  });

  it('只有交通干线、交通枢纽便捷度有分项', () => {
    expect(indicators.filter(indicator => indicator.parts.length > 0).map(indicator => indicator.id)).toEqual([
      'M62',
      'M63'
    ]);
    expect(indicatorOf('M62').parts.map(part => part.name)).toEqual([
      '与一级公路之间距离',
      '与二级公路之间距离',
      '与高速公路之间距离'
    ]);
    expect(indicatorOf('M63').parts.map(part => part.name)).toEqual([
      '与客运中心之间距离',
      AIRPORT,
      '与港口之间距离',
      '与火车站之间距离'
    ]);
  });

  it('单位「无量纲」换成空字符串', () => {
    expect(LAND_SPACE_DOMAINS.map(domain => domain.unit)).toEqual(['', '', '', '', '', '']);
    expect(indicatorOf('M40').unit).toBe('');
    expect(indicatorOf('M62').unit).toBe('km');
  });

  it('名称末尾和单位相同的括号去掉，标题拼单位时不重复', () => {
    expect(indicatorOf('M77')).toMatchObject({ name: '城乡职住用地比例', unit: '1:X' });
    expect(indicatorOf('M49').name).toBe('人均应急避难场所（地上）面积');
  });
});

describe('综合分析的值', () => {
  it('只有 2025 一年', () => {
    expect(LAND_SPACE_DATA.years).toEqual([2025]);
    expect(LAND_SPACE_DATA.value(2024, NANJING, 'M62')).toBeNull();
  });

  it('和 Excel 里的原数一致', () => {
    expect(valueOf(NANJING, 'M62')).toBe(2.53286666666667);
    expect(valueOf(NANJING, 'M62', '与一级公路之间距离')).toBe(1.674);
    expect(valueOf(NANJING, 'M63', AIRPORT)).toBe(37.4015);
    expect(valueOf(TAIZHOU, 'M63', AIRPORT)).toBeNull();
    expect(LAND_SPACE_DATA.province(partValueId('M62', '与高速公路之间距离'))).toBe(5.69);
  });

  it('单位为 % 的值存成百分数，精度取格式 0.00% 显示的 2 位', () => {
    expect(indicatorOf('M66')).toMatchObject({ unit: '%', precision: 2 });
    // Excel 存的是 0.24599026548186
    expect(valueOf(NANJING, 'M66')).toBe(24.599026548186);
    expect(LAND_SPACE_DATA.province('M66')).toBe(26.9);
    const percents = indicators.filter(indicator => indicator.unit === '%');
    expect(percents).toHaveLength(33);
    expect(percents.filter(indicator => indicator.precision !== 2)).toEqual([]);
    // 都在 0～100 之间，也没有乘 100 留下的浮点尾数（如 31.540000000000003）
    const odd = percents.flatMap(indicator =>
      JIANGSU_CITIES.map(city => valueOf(city.code, indicator.id)).filter(
        value => value === null || value < 0 || value > 100 || value !== Number(value.toPrecision(15))
      )
    );
    expect(odd).toEqual([]);
  });

  it('每个三级和分项 13 个市都有值，只缺泰州与机场之间的距离', () => {
    const valueIds = indicators.flatMap(indicator =>
      [null, ...indicator.parts.map(part => part.id)].map(partId => partValueId(indicator.id, partId))
    );
    const missing = valueIds.flatMap(valueId => {
      const empty = JIANGSU_CITIES.filter(city => LAND_SPACE_DATA.value(LAND_SPACE_YEAR, city.code, valueId) === null);
      return empty.map(city => `${valueId}@${city.code}`);
    });
    expect(JIANGSU_CITIES).toHaveLength(13);
    expect(missing).toEqual([`${partValueId('M63', AIRPORT)}@${TAIZHOU}`]);
  });

  it('有指数值的一级、二级 13 个市都有值', () => {
    const indexIds = [
      ...LAND_SPACE_DOMAINS.map(domain => domain.indexId),
      ...subIndices.filter(sub => sub.hasValues).map(sub => sub.indexId)
    ];
    const missing = indexIds.flatMap(indexId =>
      JIANGSU_CITIES.filter(city => valueOf(city.code, indexId) === null).map(city => `${indexId}@${city.code}`)
    );
    expect(missing).toEqual([]);
  });
});
