# 资源的登记：分类、标注、最小显示级别

现状底图的资源目录来自后端（ADR 0041），新资源不改前端也会出现在资源图层面板里，但只有默认样式：按在树里的顺序取一种颜色、不按属性分类，不限最小显示级别，不能开标注。要分类、开标注、限级别，就要在前端按资源的 `code` 登记。登记不分年份，对这个资源的所有年份都生效。

后端加了资源、换了一台后端、或者重新切片以后，按下面"新增资源或重新采样"做：先用只读的探查脚本看清后端的字段和取值，人工确认后再改代码。

## 登记在哪里

| 内容 | 文件（`apps/yzt/` 下） | 规则 | ADR |
|---|---|---|---|
| 分类字典：取值、名称、颜色 | `src/features/resource-map/class-dictionaries.ts` | 一个字典最多 10 项（配色板 10 种颜色，`fromPalette`）；同一取值在点层、面层同色 | 0123 |
| 按属性配色 | `src/features/resource-map/style-registry.ts` 的 `RESOURCE_STYLES` | 一个资源一行：`valueRule(字段, 字典)`，点层比面层少的取值用 `pickEntries` 只列实际有的；地类用 `landuse-code` 加 `only` | 0123、0124 |
| 瓦片里的图层名例外 | `style-registry.ts` 的 `SOURCE_LAYER_EXCEPTIONS` | 默认等于 `<code>_<年份>`，不一样时登记，否则地图上什么也不画 | 0041 |
| 标注字段 | `src/features/resource-map/label-fields.ts` 的 `ROWS`、`FIELD_NAMES` | 一个资源一行，第一个是默认字段；只列瓦片里有的、业务上看得懂的 | 0160 |
| 最小显示级别 | `src/features/resource-map/resource-min-zooms.json`，发布目录里的同名文件可以直接换 | 单张瓦片解压后 6 MB | 0132、0137 |
| 默认符号 | `src/features/resource-map/resource-symbol-defaults.json` | 只由 `symbols:import` 写入（[storage.md](../modules/storage.md)"发布的默认符号"） | 0154 |
| 规则清单 | `style-registry.test.ts` 的 `RULE_CODES`，`tools/probe-resource-classes/report.ts` 的 `CURRENT_RULE_FIELDS`，`tools/probe-resource-classes/tile-check.test.ts` 里 `rules` 的个数 | 加、删分类规则时三处一起改，测试保证和登记表一致 | 0123 |

## 新增资源或重新采样

### 先选范围

| 范围 | 什么时候选 | 要做的 |
|---|---|---|
| 只处理新资源 | 后端加了资源，时间紧 | 下面的步骤只看新的 `code` |
| 新资源和新年份 | 老资源多了年份，尤其是新的一年成了面板默认显示的年份（最新一年） | 步骤做完以后，再做"新年份的覆盖检查" |
| 全部重测 | 换了后端、重新切片，或者怀疑缓存里的结果过时 | 第 1 步不复制缓存；或者对要重测的资源加 `--refresh --codes=…` |

探查脚本只读后端，结果写进缓存（`raw/` 下一个瓦片集一个文件）。再次运行时跳过缓存里有的瓦片集，只请求新的，所以同一台后端以后再探查都用同一个输出目录。报错的瓦片集也会写进缓存，下次不会重试，要看后端修好了没有时对它们加 `--refresh --codes=…`。

### 步骤

"谁"一列：用户是能连上后端、能登录系统的人，探查要用登录的 token，由用户在自己的终端运行（token 不写进任何输出）；开发者是做登记的人或 AI。命令都是在 `C:\work\repo0527` 下的 PowerShell。

| 步骤 | 命令或做法 | 产物 | 验收 | 谁 |
|---|---|---|---|---|
| 1 建输出目录 | 每台后端一个目录，见表下的命令。新后端第一次探查时，从上一台后端的目录复制 `raw/` 当缓存（同名瓦片集默认数据一样，只请求新的）；每次探查前都记一次快照 | `local/probe/resource-classes-<站点>/`、`raw-before.txt` | 目录在，快照里的个数和 `raw/` 一样 | 开发者 |
| 2 取 token、确认后端在跑 | 浏览器登录那台服务器的系统，F12 控制台运行 `JSON.parse(localStorage.getItem('yzt.session')).token`；`curl.exe -s -o NUL -w "%{http_code}" http://<主机>:<端口>/backend/` | token（只放在终端里） | 返回 401、404 这类就是在跑；502 是后端没起来，先找服务器那边 | 用户 |
| 3 探查 | `$env:YZT_PROBE_TOKEN = '<token>'`，再运行 `pnpm --filter yzt probe:resource-classes --base-url=http://<主机>:<端口>/backend "--out=$out"`。走 nginx 的 `/backend`，后端端口从开发机不一定连得上 | `summary.md`、`candidates.csv`、`report.json`、`raw/` | 结束时打印概览，"网络失败 0 个" | 用户 |
| 4 找出新的 | 快照和 `raw/` 比出这次新请求的瓦片集（命令见表下）；按 `code` 分：没见过的是新资源，见过的是新年份；`report.json` 里没有、登记表里有的是从树里去掉的 | 新资源、新年份、去掉的资源三张清单 | 新请求的瓦片集都归了类 | 开发者 |
| 5 看每个新资源 | `candidates.csv` 里它的几行，加 `raw/<code>_<年份>.json`：总条数和抽样数、每个字段的填写率和取值、各级别瓦片的要素数和字段、`sourceLayers`、报错。先看是不是改名：新资源和去掉的资源年份、条数、字段都一样，就只是换了编码 | 每个新资源的情况 | 报错的、没数据的单独列出，交给后端 | 开发者 |
| 6 定样式和标注 | 按下面"分类字段怎么选""标注字段怎么选"列一张确认表：资源、数据情况、建议的样式、建议的标注字段 | 确认表 | 用户确认，或者说"按推荐定" | 开发者提议，用户定 |
| 7 确认取值列全（可选） | 要分类、抽样数又小于总条数时：`--enumerate=<code>:<字段> --years=latest "--out=$out"`（同第 3 步的 token 和地址） | `distinct-values.json` | 枚举完的取值都在字典里 | 用户跑，开发者核对 |
| 8 改代码 | 按"登记在哪里"改；改名的把旧 `code` 的登记改成新的；分类规则三处清单一起改 | 代码改动 | `pnpm typecheck`、`pnpm lint`、`pnpm test:changed` 通过；故意删掉一条新规则，测试因断言失败 | 开发者 |
| 9 最小显示级别（可选） | `--tile-cost --codes=<新资源的 code，逗号分隔> "--out=$out"` | 建议的 `resource-min-zooms.json` | 确认后按 [deployment.md](../deployment.md)"调整资源的最小显示级别"替换，值同步回仓库 | 用户跑，开发者核对 |
| 10 页面上看 | 部署后在现状底图勾上新资源，放大到有数据的地方 | 无 | 颜色、图例、标注都对 | 用户 |

第 1 步，新后端第一次（`<站点>`、`<上一台>` 换成实际的，如 `15-111`）：

```powershell
$out = 'C:\work\repo0527\local\probe\resource-classes-<站点>'
New-Item -ItemType Directory -Force "$out\raw" | Out-Null
Copy-Item 'C:\work\repo0527\local\probe\resource-classes-<上一台>\raw\*' "$out\raw\"
```

每次探查前记快照（同一台后端再探查时，只设 `$out`、记快照）：

```powershell
Get-ChildItem "$out\raw" -Name | Set-Content "$out\raw-before.txt" -Encoding ascii
```

第 4 步，列出这次新请求的瓦片集：

```powershell
Compare-Object (Get-Content "$out\raw-before.txt") (Get-ChildItem "$out\raw" -Name) | Where-Object SideIndicator -eq '=>' | ForEach-Object InputObject
```

- 探查只在南京、苏州、徐州、扬州四个点上采样 7、9、11、14 级，数据只在别的市（如宿迁、无锡）的资源常常只在 z7 看到要素，高级别的字段要在第 10 步看
- 第 7、9 步可以省，省了在 backlog 里记一行，上线前补

### 分类字段怎么选

ADR 0123 第 2 节的规则，加上几次探查的经验：

- 先看有没有同类的资源已经分了类：同一份数据的点层、面层共用一个字典（产业面、产业点共用 `INDUSTRY_SPACE_TYPES`）；已有字典里有同样的编码就复用，不另起颜色
- 字段的先后：编码（如 `cc`，和名称 `ccn` 一一对应）先于类型名称（`type` 这类），再其次是别的字段
- 取值 2～10 个：配色板只有 10 种颜色。多于 10 个时用统一样式，或者只挑主要的几类、其余归"其他"（要用户定）
- 一个取值占 95% 以上、或者只有一个取值：统一样式（产业空间（宿迁）面 97% 是工业空间）
- 不用这些字段：
  - 城市监测图层里的 `dlbm`、`dlmc`：那是变更前的地类，不是这个图层的类别
  - 地址匹配的级别（如 `ppjb`：门址、门牌号、兴趣点）、数据来源、文件名这类过程字段
  - 只填了"是"的标记（专精特新、高新技术企业这类，填写率很低）
  - 每个市一个取值的行政区（13 个，超过 10 种颜色）
  - 复合取值多的（用 `/` 拼接，如"停车场/应急避难场所"）：要先定归并规则
- 探查脚本给的"建议"只是按字段名、取值个数打的分，要人判断（2026-11-18 它建议过 `ppjb`）

### 标注字段怎么选

ADR 0160 的规则：

- 只列瓦片里有的：看 `raw/` 里各级别瓦片的字段，不能只看属性；属性里有、瓦片里没有的，打开标注是空的
- 第一个是默认字段：有名称时用名称（企业名称、研发中心名称……），没有时用最能区分要素的（如行业）
- 列业务上看得懂的：名称、类型、行业、类别名称、地类名称、编号
- 不列：个人姓名（如负责人 `fzr`）、统一社会信用代码、地址、电话、注册资本、人数、面积、日期、坐标、`guid`、`id` 这类标识
- 叫法：`FIELD_NAMES` 里有的直接写字段名；这个资源里叫法不同的写成 `[字段, 叫法]`（如 `['type', '行业']`）；新字段在 `FIELD_NAMES` 里加
- 瓦片里的数值常是字符串（"-9999.0"、"1.0"），标注只把 "-9999" 当作空，所以数值字段不做标注

## 新年份的覆盖检查

分类规则和标注字段按 `code` 对所有年份生效。老资源多了年份时，新的年份可能：分类字段不在了；出现字典里没有的取值（地图和图例里画成"其他"）；标注字段在某几级瓦片里没有。用下面这个一次性的测试，按真实的登记表对探查结果求值：

1. 把代码存成 `apps/yzt/src/features/resource-map/zz-probe-coverage.tmp.test.ts`
2. 运行（`PROBE_ONLY_NEW` 为 `1` 时只看快照以后新请求的瓦片集，不设时看全部）：

```powershell
$env:PROBE_OUT = $out; $env:PROBE_ONLY_NEW = '1'
pnpm --filter yzt exec vitest run --project unit src/features/resource-map/zz-probe-coverage.tmp.test.ts --maxWorkers=1
Remove-Item apps\yzt\src\features\resource-map\zz-probe-coverage.tmp.test.ts
```

3. 结果在 `$out\coverage.md`：第一行是个数，然后是没有取到数据（报错或为空）的瓦片集，最后是有问题的表

```ts
// @vitest-environment node
// 一次性：探查结果对现有分类规则、标注字段的覆盖（docs/config/resource-registry.md"新年份的覆盖检查"），跑完删掉
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createExpression,
  type ExpressionSpecification,
  type StylePropertySpecification
} from '@maplibre/maplibre-gl-style-spec';
import { it } from 'vitest';
import { classExpression, OTHER_ITEM } from './classification';
import { labelFieldsOf } from './label-fields';
import { resourceStyle } from './style-registry';

interface FieldStats {
  readonly values?: Record<string, number>;
  readonly types?: Record<string, number>;
}
interface Stats {
  readonly fields?: Record<string, FieldStats>;
}
interface Tileset {
  readonly code: string;
  readonly year: number;
  readonly attributes?: { readonly stats?: Stats };
  readonly tiles?: readonly { readonly zoom: number; readonly features: number; readonly stats?: Stats }[];
}

// 同 style-registry.ts 的 CLASS_KEY_SPEC：规则求出取值的键，没覆盖的是 $other
const CLASS_KEY_SPEC = {
  type: 'string',
  'property-type': 'data-driven',
  expression: { interpolated: false, parameters: ['zoom', 'feature'] },
  transition: false
} as const satisfies StylePropertySpecification;

// 探查记下的类型只有数字时按数字求值：MapLibre 的 match 不跨类型
const typed = (value: string, stats: FieldStats | undefined): string | number =>
  stats?.types && Object.keys(stats.types).join() === 'number' ? Number(value) : value;

it('覆盖检查', () => {
  const out = process.env.PROBE_OUT ?? '';
  const beforeFile = process.env.PROBE_BEFORE ?? join(out, 'raw-before.txt');
  const onlyNew = process.env.PROBE_ONLY_NEW === '1' && existsSync(beforeFile);
  const before = new Set(onlyNew ? readFileSync(beforeFile, 'utf8').split(/\r?\n/) : []);
  const rows: string[] = [];
  const empty: string[] = [];
  const names = readdirSync(join(out, 'raw')).filter(name => name.endsWith('.json') && !before.has(name));
  for (const name of names.sort()) {
    const tileset = JSON.parse(readFileSync(join(out, 'raw', name), 'utf8')) as Tileset;
    const attributes = tileset.attributes?.stats?.fields ?? {};
    const tiles = (tileset.tiles ?? []).filter(tile => tile.features > 0);
    const problems: string[] = [];
    const rule = resourceStyle(tileset.code).color;
    if (Object.keys(attributes).length === 0 && tiles.length === 0) {
      // 报错（如"系统异常"）或者是空的：分不出字段在不在，单独列
      empty.push(`${tileset.code}_${tileset.year}`);
      continue;
    }
    if (rule) {
      const field = rule.kind === 'values' ? rule.property : rule.kind === 'landuse-code' ? 'dlbm' : 'dlmc';
      const sources = [attributes[field], ...tiles.map(tile => tile.stats?.fields?.[field])];
      if (sources.every(stats => stats === undefined)) {
        problems.push(`分类字段 ${field} 不在属性和瓦片里`);
      }
      const expression = classExpression(rule, item => item.key) as ExpressionSpecification;
      const parsed = createExpression(expression, 'class-key', CLASS_KEY_SPEC);
      if (parsed.result !== 'success') {
        throw new Error(`${tileset.code} 的规则解析不了`);
      }
      const uncovered = new Map<string, number>();
      for (const stats of sources) {
        for (const [value, count] of Object.entries(stats?.values ?? {})) {
          const key: unknown = parsed.value.evaluate(
            { zoom: 10 },
            { type: 'Point', properties: { [field]: typed(value, stats) } }
          );
          if (key === OTHER_ITEM) {
            uncovered.set(value, (uncovered.get(value) ?? 0) + count);
          }
        }
      }
      if (uncovered.size > 0) {
        const list = [...uncovered].map(([value, count]) => `${value}（${count}）`).join('、');
        problems.push(`${field} 画成"其他"的取值：${list}`);
      }
    }
    for (const { field } of tiles.length > 0 ? labelFieldsOf(tileset.code) : []) {
      const missing = tiles.filter(tile => !tile.stats?.fields?.[field]).map(tile => `z${tile.zoom}`);
      if (missing.length > 0) {
        problems.push(`标注字段 ${field} 不在 ${missing.join('、')} 的瓦片里`);
      }
    }
    if (problems.length > 0) {
      rows.push(`| ${tileset.code} | ${tileset.year} | ${problems.join('；')} |`);
    }
  }
  const table = ['| 资源 | 年份 | 问题 |', '|---|---|---|', ...rows].join('\n');
  const head = `${names.length} 个瓦片集，${rows.length} 个有问题，${empty.length} 个没有取到数据（报错或为空）`;
  writeFileSync(join(out, 'coverage.md'), `${head}\n\n没有取到数据：${empty.join('、') || '无'}\n\n${table}\n`);
});
```

结果怎么处理：

| 结果 | 处理 | 例子（2026-11-17，15.111） |
|---|---|---|
| 新的取值画成"其他" | 问清名称后补进字典；已知的"其他"、复合取值不用管 | 福利机构 2026 年的 `08H223A`；文艺场馆的"其他""博物馆/展览馆" |
| 分类字段整年不在 | 记 backlog，交给后端或切片 | 殡葬设施 2022 年没有 `type` |
| 标注字段在某几级瓦片里没有 | 记 backlog：切片补上，或者提高标注的最小级别 | 城市道路、公路 2026 年 z9～z11 没有名称 |
| 取值全部画成"其他" | 多半是类型不对：探查记成数字、字典写的是字符串，改字典或规则 | 耕地等别的 `lyd` |
| 没有取到数据 | 列给后端（"系统异常"、年份列着却是空的） | 城市监测图层的 2021 年 |

- 地类规则这里只按 `dlbm` 求值。地图上 `dlbm` 没对上时还会按 `dlmc` 的历史地类名称再匹配一次，所以表里地类的取值（如 `1208`）不一定真的画成"其他"，要对一下 `dlmc`
- 只能查探查采样到的地方和级别；高级别和别的市的数据，在页面上看

## 检查清单

- 分类规则的三处清单（`RULE_CODES`、`CURRENT_RULE_FIELDS`、`tile-check.test.ts` 里 `rules` 的个数）和登记表一起改
- 改了编码的资源：旧 `code` 的登记（规则、标注、例外、最小级别）改成新的，不留两份
- 第 1 级检查通过（`pnpm typecheck`、`pnpm lint`、`pnpm test:changed`），故意删掉一条新规则时测试因断言失败
- backlog 记下：后端的问题（报错、列着却是空的年份、名称的笔误），没做的枚举和最小显示级别，没在页面上看过的
- 输出目录在 `local/` 下，不入库；同一台后端以后再探查继续用这个目录

## 探查记录

| 日期 | 后端 | 输出目录（`local/probe/` 下） | 结果 |
|---|---|---|---|
| 2026-11-01 | 192.168.153.194 | `resource-classes/` | 80 个资源，第一批分类规则（ADR 0123），后来到 51 个 |
| 2026-11-17 | 192.168.15.111 | `resource-classes-15-111/`（复制上一行的缓存） | 88 个资源，9 个新的：产业面、产业点加分类（共 53 个规则），7 个加标注，城镇开发边界全部报错 |
| 2026-11-18 | 192.168.15.111 | 同上 | 99 个资源：产业空间（宿迁）从 `sydc_*` 改成 `cydc_*`，新增企业查看（无锡），12 个只有 2019 年的资源没有数据 |
