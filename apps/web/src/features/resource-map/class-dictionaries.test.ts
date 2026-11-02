// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  COMMERCE_TYPES,
  HOUSING_TYPES,
  landuseColor,
  MEDICAL_TYPES,
  PARK_TYPES,
  pickEntries,
  SCHOOL_TYPES,
  TRANSPORT_LAND_TYPES,
  TRANSPORT_STATION_TYPES,
  UTILITY_TYPES,
  WELFARE_TYPES
} from './class-dictionaries';

describe('分类字典', () => {
  it('取部分取值时用字典里同一项，按给出的顺序：同一取值在点层、面层同色', () => {
    expect(pickEntries(SCHOOL_TYPES, '08H213', '08H212')).toStrictEqual([SCHOOL_TYPES[2], SCHOOL_TYPES[1]]);
  });

  it('字典里没有的取值直接报错：写错的编码不能悄悄归入"其他"', () => {
    expect(() => pickEntries(SCHOOL_TYPES, '08H999')).toThrow('字典里没有取值 08H999');
  });

  it('颜色取地类表，历史地类也有；地类表里没有的名称直接报错', () => {
    expect(landuseColor('水田')).toBe('rgb(248, 208, 114)');
    expect(landuseColor('村庄用地')).toBe('rgb(236, 137, 138)');
    expect(() => landuseColor('有林地')).toThrow('地类表里没有 有林地');
  });

  it('监测类型代码（cc）是一张编码表：一个编码只在一个字典里（2026-11-01 探查，没有一码多名）', () => {
    const codes = [
      SCHOOL_TYPES,
      MEDICAL_TYPES,
      WELFARE_TYPES,
      UTILITY_TYPES,
      PARK_TYPES,
      TRANSPORT_STATION_TYPES,
      TRANSPORT_LAND_TYPES,
      COMMERCE_TYPES,
      HOUSING_TYPES
    ].flatMap(entries => entries.map(({ value }) => value));

    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toHaveLength(33);
  });
});
