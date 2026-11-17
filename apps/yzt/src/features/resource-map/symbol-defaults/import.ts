import { z } from 'zod';
import { classItems } from '../classification';
import { labelFieldsOf } from '../label-fields';
import {
  compactLabel,
  LABEL_KEYS,
  LABEL_PLACEMENTS,
  type LabelField,
  type LabelOverride,
  type LabelPlacement,
  PLACEMENTS_OF
} from '../labels';
import {
  CODE_DEFAULT_MODE,
  fromStoredSymbols,
  layerMode,
  pruneOverride,
  RESOURCE_SYMBOLS_PREFERENCE,
  RESOURCE_SYMBOLS_VERSION,
  type ResourceSymbolOverride,
  type StoredSymbols,
  storedSymbolsSchema,
  type SymbolMode,
  type SymbolOverrides
} from '../resource-symbols';
import { resourceStyle } from '../style-registry';
import { SYMBOL_FIELDS, type SymbolField, type SymbolOverride } from '../symbols';
import type { ImportSymbolDefaults } from './contract';

// 发布的默认符号的导入（ADR 0154）：把某个用户在页面上调好的符号合并进 resource-symbol-defaults.json。
// 只给 symbols:import 用，页面不导入

/** 控制台片段（export-snippet.js）导出的文件 */
const exportSchema = z.object({
  kind: z.literal('yzt-resource-symbols'),
  exportedAt: z.string(),
  entries: z.array(z.object({ key: z.string(), record: z.unknown() }))
});

// 偏好的存储外壳（use-preference.ts）：版本单独核对，值按页面的 schema 校验
const recordSchema = z.object({ version: z.unknown(), value: z.unknown() });

const MODE_LABELS: Readonly<Record<SymbolMode, string>> = { uniform: '统一样式', classified: '分类样式' };

// 报告里的字段名，和符号编辑器的叫法一致
const FIELD_LABELS: Readonly<Record<SymbolField, string>> = {
  shape: '形状',
  size: '大小',
  fillColor: '填充色',
  strokeColor: '描边色',
  strokeWidth: '描边宽度',
  color: '颜色',
  width: '线宽',
  dash: '线型',
  fillStyle: '填充方式',
  patternColor: '纹理颜色',
  outlineColor: '描边色',
  outlineWidth: '描边宽度',
  outlineDash: '描边线型'
};

// 写入文件和报告里的字段顺序：点、线、面
const FIELDS: readonly SymbolField[] = [...new Set(Object.values(SYMBOL_FIELDS).flat())];

// 报告里标注的字段名，和标注编辑器的叫法一致（ADR 0160）
const LABEL_FIELD_LABELS: Readonly<Record<LabelField, string>> = {
  field: '字段',
  font: '字体',
  size: '字号',
  color: '颜色',
  haloColor: '描边色',
  haloWidth: '描边宽度',
  placement: '放置',
  minzoom: '最小显示级别',
  maxzoom: '最大显示级别',
  overlap: '压盖'
};

const compareText = (a: string, b: string) => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};

interface Account {
  readonly login: string;
  readonly record: unknown;
}

function parseJson(text: string, what: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch (error) {
    throw new Error(`${what}不是 JSON：${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

function parseWith<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`${what}\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

// 键是 encodeURIComponent 过的登录名加偏好名（shared/storage/preference-scope.ts）
function accountsOf(entries: z.infer<typeof exportSchema>['entries']): Account[] {
  const suffix = `/${RESOURCE_SYMBOLS_PREFERENCE}`;
  return entries.flatMap(({ key, record }) =>
    key.endsWith(suffix) ? [{ login: decodeURIComponent(key.slice(0, -suffix.length)), record }] : []
  );
}

function pickAccount(accounts: readonly Account[], login: string | undefined): Account {
  const names = accounts.map(account => account.login).join('、');
  if (login !== undefined) {
    const found = accounts.find(account => account.login === login);
    if (!found) {
      throw new Error(`导出文件里没有账号 ${login}，有：${names || '（没有）'}`);
    }
    return found;
  }
  const [first] = accounts;
  if (!first) {
    throw new Error('导出文件里没有资源图层的符号');
  }
  if (accounts.length > 1) {
    throw new Error(`导出文件里有 ${accounts.length} 个账号：${names}，用 --login 选一个`);
  }
  return first;
}

function storedOf({ login, record }: Account): StoredSymbols {
  const { version, value } = parseWith(recordSchema, record, `账号 ${login} 的记录格式不对：`);
  if (version !== RESOURCE_SYMBOLS_VERSION) {
    throw new Error(`账号 ${login} 的符号是第 ${String(version)} 版的存储格式，这个工具只认第 ${RESOURCE_SYMBOLS_VERSION} 版`);
  }
  return parseWith(storedSymbolsSchema, value, `账号 ${login} 的符号通不过校验（页面同样会整条作废）：`);
}

function mergeItems(
  base: Readonly<Record<string, SymbolOverride>> | undefined,
  top: Readonly<Record<string, SymbolOverride>>
): Record<string, SymbolOverride> {
  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(top)]);
  return Object.fromEntries([...keys].map(key => [key, { ...base?.[key], ...top[key] }]));
}

// 还有几何在用的放置方式；点以前的"上方"（top）用户 2026-11-16 去掉了，哪种几何都不用。离线不知道资源的几何，只滤掉这种
const OFFERED_PLACEMENTS: ReadonlySet<LabelPlacement> = new Set(Object.values(PLACEMENTS_OF).flat());

const offered = (placement: LabelPlacement | undefined) =>
  placement !== undefined && OFFERED_PLACEMENTS.has(placement) ? placement : undefined;

/**
 * 标注的新默认（ADR 0160）：现在的发布默认叠加这个用户的标注；没有登记标注字段的资源、不在登记里的字段跳过，
 * 不再提供的放置方式用现在的发布默认（同页面上 resolveLabel 的做法），原因记进 skipped
 */
function mergedLabel(
  code: string,
  person: LabelOverride | undefined,
  current: LabelOverride | undefined,
  skipped: string[]
): LabelOverride | undefined {
  if (!person) {
    return current;
  }
  const fields = labelFieldsOf(code);
  if (fields.length === 0) {
    skipped.push(`${code}：没有登记标注字段，标注用不上`);
    return current;
  }
  const known = person.field === undefined || fields.some(option => option.field === person.field);
  if (!known) {
    skipped.push(`${code}：标注字段 ${person.field} 不在登记里`);
  }
  const { placement } = person;
  if (placement !== undefined && !offered(placement)) {
    skipped.push(`${code}：标注的放置方式 ${LABEL_PLACEMENTS[placement]}（${placement}）已经不提供，用现在的默认`);
  }
  return compactLabel({
    ...current,
    ...person,
    field: known ? (person.field ?? current?.field) : current?.field,
    placement: offered(placement) ?? offered(current?.placement)
  });
}

/**
 * 一个资源的新默认：现在的发布默认叠加这个用户的覆盖，就是他在页面上看到的样子；样式方式按他看到的写。
 * 取值不在规则里、没登记分类的资源带了取值或方式时跳过这些部分，原因记进 skipped
 */
function mergedDefault(
  code: string,
  person: ResourceSymbolOverride,
  current: ResourceSymbolOverride | undefined,
  skipped: string[]
): ResourceSymbolOverride | undefined {
  const uniform = { ...current?.uniform, ...person.uniform };
  const label = mergedLabel(code, person.label, current?.label, skipped);
  const labelPart = label ? { label } : {};
  const rule = resourceStyle(code).color;
  if (!rule) {
    if (person.items || person.mode) {
      skipped.push(`${code}：没有登记分类，只有统一样式，取值和样式方式用不上`);
    }
    return pruneOverride({ uniform, ...labelPart });
  }
  const keys = new Set(classItems(rule).map(item => item.key));
  const entries = Object.entries(person.items ?? {});
  const unknown = entries.filter(([key]) => !keys.has(key)).map(([key]) => key);
  if (unknown.length > 0) {
    skipped.push(`${code}：取值 ${unknown.join('、')} 不在规则里`);
  }
  const items = mergeItems(current?.items, Object.fromEntries(entries.filter(([key]) => keys.has(key))));
  const mode = layerMode(person, layerMode(current, CODE_DEFAULT_MODE));
  return pruneOverride({ uniform, mode, items, ...labelPart });
}

const shown = (value: string | number | boolean | undefined) => (value === undefined ? '代码默认' : String(value));

function labelLines(before: LabelOverride | undefined, after: LabelOverride | undefined): string[] {
  return LABEL_KEYS.flatMap(key => {
    const from = before?.[key];
    const to = after?.[key];
    return from === to ? [] : [`  标注 · ${LABEL_FIELD_LABELS[key]}：${shown(from)} → ${shown(to)}`];
  });
}

function fieldLines(prefix: string, before: SymbolOverride | undefined, after: SymbolOverride | undefined): string[] {
  return FIELDS.flatMap(field => {
    const from = before?.[field];
    const to = after?.[field];
    return from === to ? [] : [`${prefix}${FIELD_LABELS[field]}：${shown(from)} → ${shown(to)}`];
  });
}

// 一个资源的差异：样式方式、统一样式、各取值，逐个字段写"旧 → 新"
function resourceLines(
  code: string,
  before: ResourceSymbolOverride | undefined,
  after: ResourceSymbolOverride | undefined
): string[] {
  const rule = resourceStyle(code).color;
  const lines: string[] = [];
  if (rule) {
    const from = layerMode(before, CODE_DEFAULT_MODE);
    const to = layerMode(after, CODE_DEFAULT_MODE);
    if (from !== to) {
      lines.push(`  样式方式：${MODE_LABELS[from]} → ${MODE_LABELS[to]}`);
    }
  }
  lines.push(...fieldLines('  统一样式 · ', before?.uniform, after?.uniform));
  const labels = new Map(rule ? classItems(rule).map(item => [item.key, item.label]) : []);
  const keys = new Set([...Object.keys(before?.items ?? {}), ...Object.keys(after?.items ?? {})]);
  for (const key of [...keys].toSorted(compareText)) {
    const label = labels.get(key);
    const name = label === undefined || label === key ? key : `${label}（${key}）`;
    lines.push(...fieldLines(`  ${name} · `, before?.items?.[key], after?.items?.[key]));
  }
  lines.push(...labelLines(before?.label, after?.label));
  return lines.length > 0 ? [code, ...lines] : [];
}

function fieldsOf(override: SymbolOverride): Record<string, string | number> {
  const entries = FIELDS.flatMap(field => {
    const value = override[field];
    return value === undefined ? [] : [[field, value] as const];
  });
  return Object.fromEntries(entries);
}

function labelFieldsOfOverride(label: LabelOverride): Record<string, string | number | boolean> {
  const entries = LABEL_KEYS.flatMap(key => {
    const value = label[key];
    return value === undefined ? [] : [[key, value] as const];
  });
  return Object.fromEntries(entries);
}

const byKey = ([a]: readonly [string, unknown], [b]: readonly [string, unknown]) => compareText(a, b);

/** 发布默认符号文件的固定格式：按 code、取值排序，字段按点、线、面的顺序，标注在最后，结尾换行 */
export function symbolDefaultsText(overrides: SymbolOverrides): string {
  const resources = [...overrides].toSorted(byKey).map(([code, { uniform, mode, items, label }]) => {
    const sortedItems = Object.entries(items ?? {}).toSorted(byKey);
    const value = {
      ...(uniform ? { uniform: fieldsOf(uniform) } : {}),
      ...(mode ? { mode } : {}),
      ...(items ? { items: Object.fromEntries(sortedItems.map(([key, item]) => [key, fieldsOf(item)])) } : {}),
      ...(label ? { label: labelFieldsOfOverride(label) } : {})
    };
    return [code, value] as const;
  });
  return `${JSON.stringify(Object.fromEntries(resources), null, 2)}\n`;
}

/** 把导出文件里一个账号的符号合并进发布的默认符号（ADR 0154） */
export const importSymbolDefaults: ImportSymbolDefaults = request => {
  const exported = parseWith(exportSchema, parseJson(request.exported, '导出文件'), '导出文件的格式不对：');
  const account = pickAccount(accountsOf(exported.entries), request.login);
  const currentStored = parseWith(storedSymbolsSchema, parseJson(request.current, '发布的默认符号'), '发布的默认符号不合法：');
  const current = fromStoredSymbols(currentStored);
  // 这个用户的覆盖是在当时的默认上记的：按现在仓库里的发布默认整理（前提是他用的部署和仓库一致）
  const person = fromStoredSymbols(storedOf(account), code => layerMode(current.get(code), CODE_DEFAULT_MODE));

  const missing = (request.only ?? []).filter(code => !person.has(code));
  if (missing.length > 0) {
    throw new Error(`账号 ${account.login} 导出的符号里没有资源：${missing.join('、')}`);
  }
  const codes = (request.only ?? [...person.keys()]).toSorted(compareText);

  const skipped: string[] = [];
  const next = new Map(current);
  for (const code of codes) {
    const override = person.get(code);
    const merged = override && mergedDefault(code, override, current.get(code), skipped);
    if (merged) {
      next.set(code, merged);
    } else {
      next.delete(code);
    }
  }

  const changes = codes.map(code => resourceLines(code, current.get(code), next.get(code)));
  const diff = changes.flat();
  const changedCount = changes.filter(lines => lines.length > 0).length;
  const unregistered = codes.filter(code => !resourceStyle(code).color);
  const report = [
    `账号 ${account.login}，导出于 ${exported.exportedAt}；导出的符号涉及 ${person.size} 个资源，` +
      `这次导入 ${codes.length} 个，${changedCount} 个有变化`,
    ...(diff.length > 0 ? diff : ['和现在的发布默认符号相同，没有变化']),
    ...(skipped.length > 0 ? ['跳过：', ...skipped.map(line => `  ${line}`)] : []),
    ...(unregistered.length > 0
      ? [
          `没有登记分类的资源（${unregistered.length} 个）：${unregistered.join('、')}。` +
            '资源目录来自后端，离线确认不了它们还在不在目录里，请对照页面上的图层核对'
        ]
      : [])
  ];
  return { report, next: symbolDefaultsText(next), changed: diff.length > 0 };
};
