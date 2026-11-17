import { type Cell, formatDecimals, isPercentFormat, type Workbook } from './xlsx.ts';

// 综合分析驾驶舱的数据口径：「指标数值」里 2025 年的现状值和全省汇总，层级按「指标字典」的一级、二级分类和指标类型

export const LAND_SPACE_YEAR = 2025;

const VALUE_SHEET = '指标数值';
const DICTIONARY_SHEET = '指标字典';
const VALUE_TYPES: ReadonlySet<string> = new Set(['现状值', '全省汇总']);
const PROVINCE = '江苏省';
// 公安派出所5分钟出警覆盖率不进驾驶舱（用户 2026-11-16）
const EXCLUDED: ReadonlySet<string> = new Set(['M51']);
const NOT_APPLICABLE = '不适用';
const DIMENSIONLESS = '无量纲';
const PERCENT = '%';
const DEFAULT_PRECISION = 2;
const INDEX_CODE = /^I\d+$/;
const MEASURE_CODE = /^M\d+$/;

// 一级分类对应的 id，也是一级图标 dashboard-<id> 的后半
const DOMAIN_IDS: Readonly<Record<string, string>> = {
  生活宜居便利性: 'livability',
  公共资源人均享有度: 'public-resources',
  公共服务均衡普惠性: 'public-services',
  城市安全韧性: 'urban-safety',
  交通网络通达性: 'transport',
  建筑与住宅规模结构合理性: 'building'
};

export interface City {
  readonly code: string;
  readonly name: string;
}

export interface LandSpacePart {
  readonly id: string;
  readonly name: string;
}

export interface LandSpaceIndicator {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly precision: number;
  readonly parts: readonly LandSpacePart[];
}

export interface LandSpaceSubIndex {
  readonly id: string;
  readonly name: string;
  readonly indexId: string;
  readonly indexName: string;
  readonly unit: string;
  readonly precision: number;
  readonly hasValues: boolean;
  readonly indicators: readonly LandSpaceIndicator[];
}

export interface LandSpaceDomain {
  readonly id: string;
  readonly name: string;
  readonly indexId: string;
  readonly indexName: string;
  readonly unit: string;
  readonly precision: number;
  readonly subIndices: readonly LandSpaceSubIndex[];
}

export interface LandSpaceFile {
  readonly source: string;
  readonly year: number;
  readonly domains: readonly LandSpaceDomain[];
  /** 值的 id（指数、指标编码，分项是"编码:分项"）→ 市的区划码 → 值；不适用、空白为 null */
  readonly values: Readonly<Record<string, Readonly<Record<string, number | null>>>>;
  /** 全省汇总，只收有数的 */
  readonly province: Readonly<Record<string, number>>;
}

interface TableRow {
  readonly number: number;
  text(header: string): string;
  cell(header: string): Cell | undefined;
}

// 表头所在的行是第一行含全部 headers 的行，列按表头名称取，不依赖列的位置
function readTable(book: Workbook, sheet: string, headers: readonly string[]): TableRow[] {
  const rows = [...book.sheet(sheet)];
  const headerAt = rows.findIndex(([, row]) => {
    const names = new Set([...row.values()].map(cell => String(cell.value).trim()));
    return headers.every(header => names.has(header));
  });
  const headerRow = rows[headerAt]?.[1];
  if (!headerRow) {
    throw new Error(`工作表「${sheet}」里找不到表头：${headers.join('、')}`);
  }
  const columns = new Map([...headerRow].map(([column, cell]) => [String(cell.value).trim(), column]));
  const columnOf = (header: string) => {
    const column = columns.get(header);
    if (column === undefined) {
      throw new Error(`工作表「${sheet}」没有表头「${header}」`);
    }
    return column;
  };
  return rows.slice(headerAt + 1).map(([number, row]) => ({
    number,
    cell: header => row.get(columnOf(header)),
    text: header => {
      const value = row.get(columnOf(header))?.value;
      return value === undefined ? '' : String(value).trim();
    }
  }));
}

interface Definition {
  readonly code: string;
  readonly domain: string;
  readonly group: string;
  readonly name: string;
  readonly type: string;
  readonly unit: string;
}

interface Reading {
  readonly row: number;
  readonly code: string;
  /** 市的区划码；全省汇总为 null */
  readonly cityCode: string | null;
  readonly part: string;
  readonly value: number | null;
  readonly format: string | undefined;
}

const codeNumber = (code: string) => Number(code.slice(1));
const displayUnit = (unit: string) => (unit === DIMENSIONLESS ? '' : unit);
// 百分比格式存的是小数（0.5748 显示 57.48%），乘 100 与单位 % 一致；按 15 位有效数字取整，去掉乘法的浮点尾数
const toPercent = (value: number) => Number((value * 100).toPrecision(15));

// 名称末尾已经带着单位（城乡职住用地比例（1:X））时去掉，界面用 withUnit 统一拼单位
function nameWithoutUnit(name: string, unit: string): string {
  const suffix = `（${unit}）`;
  return unit !== '' && name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}

/** 分项的值 id：不带分项（综合）就是指标编码 */
export const partValueId = (code: string, part: string) => (part === '' ? code : `${code}:${part}`);

function readDefinitions(book: Workbook): Definition[] {
  return readTable(book, DICTIONARY_SHEET, ['编码', '一级分类', '二级分类', '指标名称', '指标类型', '单位'])
    .map(row => ({
      code: row.text('编码'),
      domain: row.text('一级分类'),
      group: row.text('二级分类'),
      name: row.text('指标名称'),
      type: row.text('指标类型'),
      unit: row.text('单位')
    }))
    .filter(({ code }) => (INDEX_CODE.test(code) || MEASURE_CODE.test(code)) && !EXCLUDED.has(code));
}

function readingValue(cell: Cell | undefined, unit: string, where: string): number | null {
  if (cell === undefined) {
    return null;
  }
  if (typeof cell.value === 'string' && ['', NOT_APPLICABLE].includes(cell.value.trim())) {
    return null;
  }
  if (typeof cell.value !== 'number') {
    throw new Error(`${where}的数值「${String(cell.value)}」不是数字，也不是「${NOT_APPLICABLE}」`);
  }
  // 格式和单位对得上才能确定存的是小数还是百分数
  const percent = isPercentFormat(cell.format);
  if (percent !== (unit === PERCENT)) {
    throw new Error(`${where}的单位「${unit}」和数字格式「${cell.format}」不一致：百分比格式只用于单位 ${PERCENT}`);
  }
  return percent ? toPercent(cell.value) : cell.value;
}

function readReadings(book: Workbook, definitions: ReadonlyMap<string, Definition>, cities: readonly City[]) {
  const cityCodes = new Map(cities.map(({ code, name }) => [name, code]));
  const readings: Reading[] = [];
  const seen = new Set<string>();
  const rows = readTable(book, VALUE_SHEET, ['编码', '地区', '年份／期间', '数据类型', '分项', '数值', '单位']);
  for (const row of rows) {
    const code = row.text('编码');
    const selected = VALUE_TYPES.has(row.text('数据类型')) && row.text('年份／期间') === String(LAND_SPACE_YEAR);
    if (!selected || !(INDEX_CODE.test(code) || MEASURE_CODE.test(code)) || EXCLUDED.has(code)) {
      continue;
    }
    const where = `「${VALUE_SHEET}」第 ${row.number} 行`;
    const definition = definitions.get(code);
    if (!definition) {
      throw new Error(`${where}的编码 ${code} 不在「${DICTIONARY_SHEET}」里`);
    }
    if (row.text('单位') !== definition.unit) {
      throw new Error(`${where}的单位「${row.text('单位')}」和「${DICTIONARY_SHEET}」的「${definition.unit}」不一致`);
    }
    const region = row.text('地区');
    const cityCode = region === PROVINCE ? null : cityCodes.get(region);
    if (cityCode === undefined) {
      throw new Error(`${where}的地区「${region}」既不是${PROVINCE}，也不是区划目录里的市`);
    }
    const part = row.text('分项');
    const key = `${code}|${cityCode ?? PROVINCE}|${part}`;
    if (seen.has(key)) {
      throw new Error(`${where}重复：${region}的 ${partValueId(code, part)} 已经有一条`);
    }
    seen.add(key);
    const cell = row.cell('数值');
    const value = readingValue(cell, definition.unit, where);
    readings.push({ row: row.number, code, cityCode, part, value, format: cell?.format });
  }
  return readings;
}

// 一个编码各单元格格式显示的小数位里最多的；都读不到时用默认
function precisionOf(readings: readonly Reading[]): number {
  const decimals = readings.flatMap(({ format }) => {
    const value = format === undefined ? null : formatDecimals(format);
    return value === null ? [] : [value];
  });
  return decimals.length > 0 ? Math.max(...decimals) : DEFAULT_PRECISION;
}

// 分项是市的现状值里出现过的非空分项，按表里的先后
function partsOf(code: string, readings: readonly Reading[]): LandSpacePart[] {
  const parts = new Set<string>();
  for (const reading of readings) {
    if (reading.cityCode !== null && reading.part !== '') {
      parts.add(reading.part);
    }
  }
  for (const reading of readings) {
    if (reading.part !== '' && !parts.has(reading.part)) {
      throw new Error(`「${VALUE_SHEET}」第 ${reading.row} 行：${code} 的全省分项「${reading.part}」在各市里没有`);
    }
  }
  return [...parts].map(part => ({ id: part, name: part }));
}

/** 把工作簿转成驾驶舱的数据；cities 是区划目录的 13 个市，决定值的城市顺序 */
export function buildLandSpaceFile(book: Workbook, source: string, cities: readonly City[]): LandSpaceFile {
  const definitions = readDefinitions(book);
  const byCode = new Map(definitions.map(definition => [definition.code, definition]));
  const readings = readReadings(book, byCode, cities);
  const readingsOf = (code: string) => readings.filter(reading => reading.code === code);
  const values: Record<string, Record<string, number | null>> = {};
  const province: Record<string, number> = {};
  const assigned = new Set<string>();

  // 一个值 id 只要有一个市有记录，就把 13 个市都写上，缺的为 null
  const collect = (code: string, part: string) => {
    const own = readingsOf(code).filter(reading => reading.part === part);
    const id = partValueId(code, part);
    if (own.some(reading => reading.cityCode !== null)) {
      values[id] = Object.fromEntries(
        cities.map(city => [city.code, own.find(reading => reading.cityCode === city.code)?.value ?? null])
      );
    }
    const total = own.find(reading => reading.cityCode === null)?.value;
    if (total !== undefined && total !== null) {
      province[id] = total;
    }
  };
  const hasValues = (code: string) => Object.values(values[code] ?? {}).some(value => value !== null);

  const indicatorsOf = (domain: string, group: string): LandSpaceIndicator[] =>
    definitions
      .filter(item => MEASURE_CODE.test(item.code) && item.domain === domain && item.group === group)
      .toSorted((a, b) => codeNumber(a.code) - codeNumber(b.code))
      .map(item => {
        assigned.add(item.code);
        const own = readingsOf(item.code);
        const parts = partsOf(item.code, own);
        collect(item.code, '');
        for (const part of parts) {
          collect(item.code, part.id);
        }
        const unit = displayUnit(item.unit);
        const name = nameWithoutUnit(item.name, unit);
        return { id: item.code, name, unit, precision: precisionOf(own), parts };
      });

  const domains = definitions
    .filter(item => INDEX_CODE.test(item.code) && item.type.includes('一级'))
    .map((index): LandSpaceDomain => {
      const id = DOMAIN_IDS[index.domain];
      if (id === undefined) {
        throw new Error(`一级分类「${index.domain}」没有对应的 id，在 DOMAIN_IDS 里补上`);
      }
      collect(index.code, '');
      const subIndices = definitions
        .filter(item => INDEX_CODE.test(item.code) && item.domain === index.domain && item.type.includes('二级'))
        .map((sub): LandSpaceSubIndex => {
          if (sub.code !== index.code) {
            collect(sub.code, '');
          }
          return {
            id: sub.code,
            name: sub.group,
            indexId: sub.code,
            indexName: sub.name,
            unit: displayUnit(sub.unit),
            precision: precisionOf(readingsOf(sub.code)),
            hasValues: hasValues(sub.code),
            indicators: indicatorsOf(index.domain, sub.group)
          };
        });
      if (subIndices.length === 0) {
        throw new Error(`一级「${index.domain}」下没有二级指数`);
      }
      return {
        id,
        name: index.domain,
        indexId: index.code,
        indexName: index.name,
        unit: displayUnit(index.unit),
        precision: precisionOf(readingsOf(index.code)),
        subIndices
      };
    });

  const domainNames = new Set(domains.map(domain => domain.name));
  const orphans = definitions.filter(
    item => MEASURE_CODE.test(item.code) && domainNames.has(item.domain) && !assigned.has(item.code)
  );
  if (orphans.length > 0) {
    throw new Error(`这些单一指标找不到同名二级分类的二级指数：${orphans.map(item => item.code).join('、')}`);
  }
  return { source, year: LAND_SPACE_YEAR, domains, values, province };
}
