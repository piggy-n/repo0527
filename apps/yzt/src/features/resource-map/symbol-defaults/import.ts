import { z } from 'zod';
import { classItems } from '../classification';
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
  const rule = resourceStyle(code).color;
  if (!rule) {
    if (person.items || person.mode) {
      skipped.push(`${code}：没有登记分类，只有统一样式，取值和样式方式用不上`);
    }
    return pruneOverride({ uniform });
  }
  const keys = new Set(classItems(rule).map(item => item.key));
  const entries = Object.entries(person.items ?? {});
  const unknown = entries.filter(([key]) => !keys.has(key)).map(([key]) => key);
  if (unknown.length > 0) {
    skipped.push(`${code}：取值 ${unknown.join('、')} 不在规则里`);
  }
  const items = mergeItems(current?.items, Object.fromEntries(entries.filter(([key]) => keys.has(key))));
  const mode = layerMode(person, layerMode(current, CODE_DEFAULT_MODE));
  return pruneOverride({ uniform, mode, items });
}

const shown = (value: string | number | undefined) => (value === undefined ? '代码默认' : String(value));

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
  return lines.length > 0 ? [code, ...lines] : [];
}

function fieldsOf(override: SymbolOverride): Record<string, string | number> {
  const entries = FIELDS.flatMap(field => {
    const value = override[field];
    return value === undefined ? [] : [[field, value] as const];
  });
  return Object.fromEntries(entries);
}

const byKey = ([a]: readonly [string, unknown], [b]: readonly [string, unknown]) => compareText(a, b);

/** 发布默认符号文件的固定格式：按 code、取值排序，字段按点、线、面的顺序，结尾换行 */
export function symbolDefaultsText(overrides: SymbolOverrides): string {
  const resources = [...overrides].toSorted(byKey).map(([code, { uniform, mode, items }]) => {
    const sortedItems = Object.entries(items ?? {}).toSorted(byKey);
    const value = {
      ...(uniform ? { uniform: fieldsOf(uniform) } : {}),
      ...(mode ? { mode } : {}),
      ...(items ? { items: Object.fromEntries(sortedItems.map(([key, item]) => [key, fieldsOf(item)])) } : {})
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
