import type { ConditionField, InputOperator } from './layer-fields';
import type { NaturalLanguageRule } from './topics';

/** 条件之间的连接：写在前一个条件上，连接它和下一个（同旧页面） */
export type LinkType = 'AND' | 'OR';

/** 属性查询表单里的一个条件；多选的值是数组，其余是字符串，空字符串、空数组表示没填 */
export interface Condition {
  /** 列表里的身份：同一个字段删掉再加回来是新的条件 */
  readonly key: number;
  readonly field: ConditionField;
  readonly value: string | readonly string[];
  /** 输入框的运算符；其余类型为 null */
  readonly operator: InputOperator | null;
  readonly link: LinkType;
}

/** 新加的条件：值取字段的初始值，输入框默认第一个运算符 */
export function newCondition(field: ConditionField, key: number): Condition {
  const condition: Condition = { key, field, value: '', operator: null, link: 'AND' };
  if (field.type === 'multiple') {
    return { ...condition, value: field.initial ?? [] };
  }
  if (field.type === 'single') {
    return { ...condition, value: field.initial ?? '' };
  }
  return field.type === 'input' ? { ...condition, operator: field.operators[0] ?? null } : condition;
}

/** SQL 里的字符串：单引号写两次 */
export function quoteValue(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function isFilled({ value }: Condition): boolean {
  return typeof value === 'string' ? value !== '' : value.length > 0;
}

// 一个条件的表达式；LIKE、NOT 按包含、不包含拼（旧页面的 LIKE 不加通配符、NOT 拼出的 SQL 不合法，ADR 0104）
function expression({ field, value, operator }: Condition): string {
  if (typeof value !== 'string') {
    return `${field.field} IN (${value.map(quoteValue).join(',')})`;
  }
  if (operator === 'LIKE') {
    return `${field.field} LIKE ${quoteValue(`%${value}%`)}`;
  }
  if (operator === 'NOT') {
    return `${field.field} NOT LIKE ${quoteValue(`%${value}%`)}`;
  }
  return `${field.field} ${operator ?? '='} ${quoteValue(value)}`;
}

/** 接口的 conditions 参数：没填的条件跳过，其余按各自的连接拼起来；都没填时为空字符串 */
export function conditionsText(conditions: readonly Condition[]): string {
  const filled = conditions.filter(isFilled);
  return filled
    .map((condition, index) => {
      const text = expression(condition);
      return index < filled.length - 1 ? `${text} ${condition.link} ` : text;
    })
    .join('');
}

/** 面板上显示的 SQL：行政区划和条件，同旧页面"显示 SQL 语句"的写法 */
export function attributeSql(table: string, region: string | null, conditions: readonly Condition[]): string {
  const parts = [region === null ? '' : `xzqdm = ${quoteValue(region)}`, conditionsText(conditions)].filter(Boolean);
  return `SELECT * FROM ${table} WHERE ${parts.join(' AND ')}`;
}

/** 高级查询可以点击插入的运算符，同旧页面 */
export const ADVANCED_OPERATORS = ['<', '=', '>', '<=', '<>', '>=', 'LIKE', 'AND', 'OR', 'NOT'] as const;

/** 点击字段、运算符、唯一值时插入到 SQL 末尾；SQL 为空时先写 SELECT * FROM 表 WHERE */
export function insertToken(sql: string, table: string, token: string): string {
  return `${sql === '' ? `SELECT * FROM ${table} WHERE ` : sql}${token} `;
}

/** 高级查询解析出的接口参数；没写表名、也没选图层时 layerCode 为 null */
export interface AdvancedParams {
  readonly layerCode: string | null;
  readonly xzqdm: string;
  readonly conditions: string;
}

const REGION_PATTERN = String.raw`\bxzqdm\s*=\s*['"]?\d{6,}['"]?`;

// 从地址里复制来的 SQL 先解码；去掉末尾的分号
function normalizeSql(text: string): string {
  const raw = text.trim();
  if (/%(?:20|27|22|28|29|2C|3D|25)/i.test(raw)) {
    try {
      return decodeURIComponent(raw).replace(/;+$/, '').trim();
    } catch {
      // 不完整的百分号编码按原文处理
    }
  }
  return raw.replace(/;+$/, '').trim();
}

// 去掉首尾多余的连接符，避免接口再拼接时变成不合法的 SQL
function cleanConditions(text: string): string {
  return text
    .trim()
    .replace(/;+$/, '')
    .replace(/^\s*(AND|OR)\s+/i, '')
    .replace(/\s+(AND|OR)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 把输入框里的完整 SQL 或条件片段拆成接口参数（旧页面的规则）：表名取 FROM 后面的，没有时用选中的图层；
 * WHERE 里的 xzqdm 拆出来单独传，没有时用 fallbackRegion
 */
export function parseAdvancedSql(text: string, fallbackTable: string | null, fallbackRegion: string): AdvancedParams {
  const sql = normalizeSql(text);
  const select = /^\s*SELECT\s+\*\s+FROM\s+(\S+)(?:\s+WHERE\s+([\s\S]*))?\s*$/i.exec(sql);
  const layerCode = select?.[1]?.replace(/[`'"]/g, '') ?? fallbackTable;
  const where = select ? (select[2] ?? '') : sql.replace(/^\s*WHERE\s+/i, '');
  const region = new RegExp(REGION_PATTERN, 'i').exec(where);
  const xzqdm = region?.[0].match(/\d{6,}/)?.[0] ?? fallbackRegion;
  const conditions = region
    ? where
        .replace(new RegExp(String.raw`^\s*${REGION_PATTERN}\s+(AND|OR)\s+`, 'i'), '')
        .replace(new RegExp(String.raw`\s+(AND|OR)\s+${REGION_PATTERN}\s*$`, 'i'), '')
        .replace(new RegExp(String.raw`\s+(AND|OR)\s+${REGION_PATTERN}\s+(AND|OR)\s+`, 'i'), ' $2 ')
        .replace(new RegExp(String.raw`^\s*${REGION_PATTERN}\s*$`, 'i'), '')
    : where;
  return { layerCode, xzqdm, conditions: cleanConditions(conditions) };
}

const normalizeText = (text: string) => text.replace(/\s+/g, '');

/** 自然语言的模拟解析：先找示例原样相同的规则，再找包含全部关键词的；都没有时为 undefined */
export function matchNaturalRule(text: string, rules: readonly NaturalLanguageRule[]): NaturalLanguageRule | undefined {
  const input = normalizeText(text);
  return (
    rules.find(rule => rule.examples.some(example => normalizeText(example) === input)) ??
    rules.find(rule => rule.keywords.every(keyword => input.includes(normalizeText(keyword))))
  );
}
