// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { classItems } from '../classification';
import committed from '../resource-symbol-defaults.json?raw';
import { fromStoredSymbols, storedSymbolsSchema } from '../resource-symbols';
import { resourceStyle } from '../style-registry';
import type { SymbolImportRequest } from './contract';
import { importSymbolDefaults, symbolDefaultsText } from './import';

const RED = 'rgba(255, 0, 0, 1)';
const BLUE = 'rgba(0, 0, 255, 1)';
const BLACK = 'rgba(0, 0, 0, 1)';

// 控制台片段导出的文件：每个账号一条，键是编码后的登录名加偏好名
function exportFile(accounts: Readonly<Record<string, unknown>>, extra: readonly unknown[] = []): string {
  const entries = Object.entries(accounts).map(([login, value]) => ({
    key: `${encodeURIComponent(login)}/resource-symbols`,
    record: { version: 1, value }
  }));
  const exportedAt = '2026-11-11T08:00:00.000Z';
  return JSON.stringify({ kind: 'yzt-resource-symbols', exportedAt, entries: [...entries, ...extra] });
}

function run(exported: string, current: unknown = {}, options: Partial<SymbolImportRequest> = {}) {
  return importSymbolDefaults({ exported, current: JSON.stringify(current), ...options });
}

const nextOf = (exported: string, current: unknown = {}, options: Partial<SymbolImportRequest> = {}): unknown =>
  JSON.parse(run(exported, current, options).next);

describe('importSymbolDefaults', () => {
  it('输入不对时说明原因：不是 JSON、不是导出文件、存储版本不同、通不过页面的校验', () => {
    expect(() => run('不是 JSON')).toThrow('导出文件不是 JSON');
    expect(() => run(JSON.stringify({ kind: 'other' }))).toThrow('导出文件的格式不对');
    const version2 = { key: 'zhangsan/resource-symbols', record: { version: 2, value: {} } };
    expect(() => run(exportFile({}, [version2]))).toThrow('账号 zhangsan 的符号是第 2 版的存储格式');
    expect(() => run(exportFile({ zhangsan: { a: { uniform: { size: 99 } } } }))).toThrow('通不过校验');
    expect(() => run(exportFile({ zhangsan: {} }), { a: { uniform: { size: 99 } } })).toThrow('发布的默认符号不合法');
  });

  it('只有一个账号时直接用；几个账号时要指定，指定的不在时列出有哪些；别的偏好不算', () => {
    const two = exportFile({ zhangsan: {}, 张三: { szy_kt: { uniform: { fillColor: BLUE } } } });

    expect(() => run(two)).toThrow('导出文件里有 2 个账号：zhangsan、张三，用 --login 选一个');
    expect(() => run(two, {}, { login: '李四' })).toThrow('导出文件里没有账号 李四，有：zhangsan、张三');
    expect(run(two, {}, { login: '张三' }).report[0]).toMatch(/^账号 张三，导出于 2026-11-11T08:00:00\.000Z/);
    const layers = { key: 'zhangsan/resource-layers', record: { version: 1, value: {} } };
    expect(() => run(exportFile({}, [layers]))).toThrow('导出文件里没有资源图层的符号');
  });

  it('现在的发布默认叠加这个用户的覆盖：他改过的字段用他的值，别的字段保留；报告逐个字段写旧值和新值', () => {
    const current = { bgdc_ccwjq: { uniform: { fillColor: RED, outlineWidth: 'L' } } };
    const exported = exportFile({
      zhangsan: { bgdc_ccwjq: { uniform: { fillColor: BLUE } }, csxhjctb_hydl: { items: { 河流: { width: 'L' } } } }
    });

    const result = run(exported, current);

    expect(JSON.parse(result.next)).toStrictEqual({
      bgdc_ccwjq: { uniform: { fillColor: BLUE, outlineWidth: 'L' } },
      csxhjctb_hydl: { items: { 河流: { width: 'L' } } }
    });
    expect(result.changed).toBe(true);
    expect(result.report).toStrictEqual([
      '账号 zhangsan，导出于 2026-11-11T08:00:00.000Z；导出的符号涉及 2 个资源，这次导入 2 个，2 个有变化',
      'bgdc_ccwjq',
      `  统一样式 · 填充色：${RED} → ${BLUE}`,
      'csxhjctb_hydl',
      '  河流 · 线宽：代码默认 → L',
      '没有登记分类的资源（1 个）：bgdc_ccwjq。资源目录来自后端，离线确认不了它们还在不在目录里，请对照页面上的图层核对'
    ]);
  });

  it('样式方式按这个用户看到的写：选过的、调过统一样式的是统一样式，只调过取值的是分类样式', () => {
    const exported = exportFile({
      zhangsan: {
        csxhjctb_hydl: { mode: 'uniform', uniform: { color: BLUE } },
        csxhjctb_gyssp: { uniform: { size: 'L' } }
      }
    });
    expect(nextOf(exported)).toStrictEqual({
      csxhjctb_gyssp: { uniform: { size: 'L' }, mode: 'uniform' },
      csxhjctb_hydl: { uniform: { color: BLUE }, mode: 'uniform' }
    });
    expect(run(exported).report).toContain('  样式方式：分类样式 → 统一样式');

    // 发布的默认已经是统一样式，这个用户只调过取值：他看到的是分类样式
    const current = { csxhjctb_hydl: { mode: 'uniform', uniform: { color: BLACK } } };
    const itemsOnly = exportFile({ zhangsan: { csxhjctb_hydl: { items: { 水渠: { color: BLUE } } } } });
    expect(nextOf(itemsOnly, current)).toStrictEqual({
      csxhjctb_hydl: { uniform: { color: BLACK }, mode: 'classified', items: { 水渠: { color: BLUE } } }
    });
    expect(run(itemsOnly, current).report).toContain('  样式方式：统一样式 → 分类样式');
  });

  it('取值不在规则里、没登记分类的资源带了取值或方式时跳过这些部分，报告里说明', () => {
    const exported = exportFile({
      zhangsan: {
        csxhjctb_hydl: { items: { 河流: { width: 'L' }, 运河: { width: 'S' } } },
        bgdc_ccwjq: { mode: 'uniform', uniform: { fillColor: BLUE }, items: { x: { fillColor: RED } } }
      }
    });

    const result = run(exported);

    expect(JSON.parse(result.next)).toStrictEqual({
      bgdc_ccwjq: { uniform: { fillColor: BLUE } },
      csxhjctb_hydl: { items: { 河流: { width: 'L' } } }
    });
    expect(result.report).toEqual(
      expect.arrayContaining([
        '跳过：',
        '  bgdc_ccwjq：没有登记分类，只有统一样式，取值和样式方式用不上',
        '  csxhjctb_hydl：取值 运河 不在规则里'
      ])
    );
  });

  it('只导入选中的资源，其他保持现在的发布默认；选了导出里没有的资源时报错', () => {
    const current = { szy_kt: { uniform: { fillColor: RED } } };
    const exported = exportFile({
      zhangsan: { bgdc_ccwjq: { uniform: { fillColor: BLUE } }, csxhjctb_hydl: { items: { 河流: { width: 'L' } } } }
    });

    const result = run(exported, current, { only: ['csxhjctb_hydl'] });

    expect(JSON.parse(result.next)).toStrictEqual({
      csxhjctb_hydl: { items: { 河流: { width: 'L' } } },
      szy_kt: { uniform: { fillColor: RED } }
    });
    expect(result.report[0]).toContain('这次导入 1 个，1 个有变化');
    expect(() => run(exported, current, { only: ['csxhjctb_hydl', 'nope'] })).toThrow('导出的符号里没有资源：nope');
  });

  it('文件格式固定：按 code、取值排序，字段按点、线、面的顺序；同样的符号再导入一次没有变化', () => {
    // 现在的发布默认先有的资源和取值排在合并结果的前面，写出时要重新排序
    const current = { csxhjctb_hydl: { items: { 河流: { width: 'L' } } } };
    const exported = exportFile({
      zhangsan: {
        csxhjctb_hydl: { items: { 水渠: { dash: 'dotted', color: RED } } },
        bgdc_ccwjq: { uniform: { outlineDash: 'dashed', fillColor: BLUE } }
      }
    });
    const { next } = run(exported, current);

    expect(next).toBe(
      `${JSON.stringify(
        {
          bgdc_ccwjq: { uniform: { fillColor: BLUE, outlineDash: 'dashed' } },
          csxhjctb_hydl: { items: { 水渠: { color: RED, dash: 'dotted' }, 河流: { width: 'L' } } }
        },
        null,
        2
      )}\n`
    );
    const again = run(exported, JSON.parse(next));
    expect(again.changed).toBe(false);
    expect(again.next).toBe(next);
    expect(again.report).toContain('和现在的发布默认符号相同，没有变化');
  });

  // 其他测试里这个文件换成了空的（src/test-setup.ts），这里读原文
  it('仓库里的发布默认符号通过页面的校验，取值都在规则里，是工具写出的固定格式', () => {
    const text = committed.replaceAll('\r\n', '\n');
    const value: unknown = JSON.parse(text);
    const stored = storedSymbolsSchema.parse(value);

    const unknownItems = Object.entries(stored).flatMap(([code, override]) => {
      const rule = resourceStyle(code).color;
      const keys = rule ? classItems(rule).map(item => item.key) : [];
      return Object.keys(override.items ?? {}).flatMap(key => (keys.includes(key) ? [] : [`${code} ${key}`]));
    });
    expect(unknownItems).toStrictEqual([]);
    expect(symbolDefaultsText(fromStoredSymbols(stored))).toBe(text);
  });
});
