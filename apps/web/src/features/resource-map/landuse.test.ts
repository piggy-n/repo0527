// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  LANDUSE_FALLBACK_COLOR,
  LANDUSE_GROUPS,
  LANDUSE_LEGACY_NAME_COLORS,
  LANDUSE_MEANINGS,
  URBAN_VILLAGE_CODE_NAMES
} from './landuse';
import { colorOf, defaultColorExpression, normalizeColor as color, parsesAsColor } from './test-expression';
import legacy from './test-fixtures/legacy-landuse.json';

const CLASSES = LANDUSE_GROUPS.flatMap(group => group.classes);
const BY_CODE = defaultColorExpression({ kind: 'landuse-code' });
const BY_NAME = defaultColorExpression({ kind: 'landuse-name' });
const classColor = (code: string) => color(CLASSES.find(item => item.code === code)?.color ?? '');

describe('地类配色表与旧项目一致', () => {
  it('编码表：13 个一级类、69 个二级类，编码、名称、颜色、可调整标记逐条一致', () => {
    expect(LANDUSE_GROUPS.map(({ code, name, classes }) => ({ code, name, children: classes }))).toStrictEqual(
      legacy.classTree
    );
    expect(CLASSES).toHaveLength(69);
  });

  it('历史名称表：6 个名称和颜色逐条一致；兜底色一致', () => {
    expect(LANDUSE_LEGACY_NAME_COLORS).toStrictEqual(legacy.legacyNameColors);
    expect(LANDUSE_FALLBACK_COLOR).toBe(legacy.fallbackColor);
  });

  it('编码到名称的对照：编码表的 69 项加城镇村编码 201～205（含 203A），与旧项目一致', () => {
    const codeToName = {
      ...Object.fromEntries(CLASSES.map(({ code, name }) => [code, name])),
      ...URBAN_VILLAGE_CODE_NAMES
    };

    expect(codeToName).toStrictEqual(legacy.codeToName);
  });

  it('地类的含义：69 条与旧项目逐条一致，每个二级类都有', () => {
    expect(LANDUSE_MEANINGS).toStrictEqual(legacy.meanings);
    expect(CLASSES.filter(item => !LANDUSE_MEANINGS[item.code])).toStrictEqual([]);
  });

  it('两个表达式都能被 MapLibre 解析：取值不重复（match 要求标签唯一）', () => {
    expect(parsesAsColor(BY_CODE)).toBe(true);
    expect(parsesAsColor(BY_NAME)).toBe(true);
  });
});

describe('地类图斑：按编码配色', () => {
  it('编码命中编码表：用编码的颜色，不看名称', () => {
    expect(colorOf(BY_CODE, { dlbm: '0101', dlmc: '水田' })).toBe(classColor('0101'));
    expect(colorOf(BY_CODE, { dlbm: '0201K', dlmc: '城市用地' })).toBe(classColor('0201K'));
  });

  it('编码没命中、名称是历史地类：用历史名称表的颜色', () => {
    expect(colorOf(BY_CODE, { dlbm: '201', dlmc: '城市用地' })).toBe(color('rgb(222, 103, 102)'));
  });

  it('编码没命中、名称也不在历史名称表（即使是编码表里的名称）：兜底色', () => {
    expect(colorOf(BY_CODE, { dlbm: '9999', dlmc: '未知' })).toBe(color(LANDUSE_FALLBACK_COLOR));
    expect(colorOf(BY_CODE, { dlbm: '9999', dlmc: '水田' })).toBe(color(LANDUSE_FALLBACK_COLOR));
    expect(colorOf(BY_CODE, {})).toBe(color(LANDUSE_FALLBACK_COLOR));
  });
});

describe('地类图斑（城镇村）：按名称配色', () => {
  it('有名称：按编码表的名称或历史名称配色', () => {
    expect(colorOf(BY_NAME, { dlbm: '0101', dlmc: '旱地' })).toBe(classColor('0103'));
    expect(colorOf(BY_NAME, { dlmc: '建制镇用地' })).toBe(color('rgb(224, 100, 94)'));
  });

  it('没有名称（实测的城镇村瓦片）：先把编码换成名称，城镇村编码（含 203A）换成历史名称', () => {
    expect(colorOf(BY_NAME, { dlbm: '0702' })).toBe(classColor('0702'));
    expect(colorOf(BY_NAME, { dlbm: '203A' })).toBe(color('rgb(236, 137, 138)'));
    expect(colorOf(BY_NAME, { dlbm: '205' })).toBe(color('rgb(199, 128, 11)'));
  });

  it('名称和编码都对应不上：兜底色', () => {
    expect(colorOf(BY_NAME, { dlbm: '201A' })).toBe(color(LANDUSE_FALLBACK_COLOR));
    expect(colorOf(BY_NAME, { dlmc: '未知', dlbm: '0101' })).toBe(color(LANDUSE_FALLBACK_COLOR));
    expect(colorOf(BY_NAME, {})).toBe(color(LANDUSE_FALLBACK_COLOR));
  });
});
