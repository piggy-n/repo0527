# 城市体检指标：目录与取值（shared/city-indicators）

城市体检驾驶舱和指标智能推演共用的指标目录和市级数字。2026-10-28 从 `features/city-dashboard` 移来（ADR 0105 第 4 条）：features 之间不能互相导入，第二个使用方出现后上移到 shared。2026-11-03 起 32 项指标换成《城市国土空间监测成果简报》的数据（ADR 0130）。

```
shared/city-indicators/
├─ indicator-catalog.json   96 项指标（旧项目 data.json、data2.json 归并，口径见 city-dashboard.md"数据口径"）
├─ catalog.ts               Indicator、CategoryId 类型，INDICATORS，INDICATOR_CATEGORIES（四类及名称），requireIndicator
├─ report-values.json       简报的原数：年份 → 指标 → 市编码 → 值（2026、2025，32 项，13 市；A-15 的 2025 保留但不读取）
├─ indicator-value.ts       indicatorValue(cityCode, indicator, year)、indicatorValueSource(id, year)：页面用的取值
├─ indicator-profiles.ts    每项指标的参考量级、城市特征、年变化与演变方式，createProfileValue（内部使用）
├─ mock-value.ts            mockIndicatorValue(cityCode, indicator, year)：原 mock，给取值函数折算和回退
└─ stable-random.ts         stableRandom(key)：按键的固定伪随机数，生成规则和推演模型的区县分解、撒点共用
```

## 用法

```ts
import { requireIndicator } from '@/shared/city-indicators/catalog';
import { indicatorValue } from '@/shared/city-indicators/indicator-value';

indicatorValue('320100', requireIndicator('B-65'), 2026); // 49.6，简报的南京市
```

- 页面只用 `indicatorValue`，不直接用 `mockIndicatorValue`
- 同样的市、年份、指标永远得到同一个值，跨自然年后既有年份不漂移
- 保留指标之间的约束：建筑合计等于分项（A-16、G01-6），生活圈并集不小于交集（A09-2 ≥ A-30）
- 百分比不超过 100，全部不小于 0；不在城市名单里的市没有城市特征，也没有简报值

## 数据来源

来源：《城市国土空间监测成果简报》第 3 章，13 个市各一张"城市体检评估主要指标表"（图 3-2、3-4 …… 3-26）。简报写明是"各地提交省级核查的……（非最终成果）"，有终稿时换 `report-values.json`。

| 年份 | 简报有的 32 项 | 其余 64 项 |
| --- | --- | --- |
| 2026、2025 | 简报的数 | 原 mock |
| 2024 及以前 | 简报 2025 × mock(该年) ÷ mock(2025) | 原 mock |
| 2027 及以后 | 简报 2026 × mock(该年) ÷ mock(2026) | 原 mock |

折算按目录精度取整，百分比不超过 100；原 mock 在基准年是 0 时保持基准值不变。有两处例外：

- A-15：只用简报的 2026，2025 及以前也从 2026 折算，因为简报两年口径不同（见下面的口径说明）
- 超高层的两个分项 D02-3-1、D02-3-2：简报只有合计 A-16，住宅分项按原 mock 的占比取整，其余归非住宅

**简报有的 32 项**（编码、名称、单位、统计范围都和目录一致）：

| 类别 | 编码 |
| --- | --- |
| AI 计算页也用（12 项） | A-14、A-15、A-31、A-32、A-33、A-34、A-35、A-36、A-39、B-14、B-61、B-65 |
| 只有驾驶舱用（20 项） | A-13、A-16、A-20、A-30、A-37、A-38、B-11、B-12、B-19、B-21、B-28、B-29、B-34、B-35、B-47、B-57、B-58、B-59、B-60、B-63 |

**AI 计算页里简报没有、仍是 mock 的 10 项**：D01-5、A08-1、A08-2、B08-2、F03-2、F03-4、A02-1、B02-6、B03-3、B07-2。简报的要素表有广场、停车场等面积，但没有人口等分母，不据此推算。

**简报里的口径说明**（脚注）：

- A-15：2026 年不再采集微型消防站，简报从 2025 年约 90% 降到 2026 年约 50%，不是真实下降。页面不照搬这一步（用户 2026-11-03 决定，ADR 0130 第 7 条）：2025 及以前按 2026 的口径折算，所以南京 2025 是 49.63，不是简报的 92.2。驾驶舱 2026 年用满五档
- A-13、A-38、B-21、B-59、B-63：规程上是全域指标，因要素只在城区采集，暂按城区计算
- B-19：目前统计的是要素个数
- 南京要素表：2026 年按全域统计、2025 年按城区统计。指标表的南京仍写城区

除 A-15 外，页面都照简报显示。

**全省值**：简报的全省平均是 13 市简单平均；驾驶舱的平均同样按城市算，AI 计算页的全省值按住宅用地、面积、人口加权，所以不相等（B-65：57.12 与 57.34）。

## 各页面自己保留的

- 驾驶舱：开放年份、城市名单与标签锚点（`features/city-dashboard/catalog.ts`），带分组指标列表的 `CATEGORIES`，十年记录的构建与查询（`data/mock-data.ts`，记录的 `dataSource` 标明来源）。驾驶舱的 `model.ts` 从这里转出 `Indicator`、`CategoryId`，各处仍从 `model.ts` 取
- 指标智能推演：区县分解、推演模型与参数（S3，见 [indicator-simulation.md](indicator-simulation.md)）。区县值由市的值反推，简报没有区县数据

## 测试

- `catalog.test.ts`：96 项、编码不重复、四类各自的项数、来源字段；缺项抛错
- `indicator-value.test.ts`：简报数据的形状与精度；2026、2025 等于简报；其余年份的折算、基准年为 0、取值范围；A-15 的例外；其余 62 项和原 mock 全等；合计与分项、并集与交集的约束；来源。逐个改坏折算的基准年、上限、0 的保护、分项的分配、A-15 的例外后都有断言失败
- `mock-value.test.ts`：原 mock 同样的输入同一个值；约束；取值范围
- 驾驶舱的 `data/mock-data.test.ts`：原 mock 的全部 12480 个值和六年分档仍和旧 master-demo 的摘要比对；记录都来自 `indicatorValue` 并标明来源
- 推演模型的 `calculator.test.ts`：标准口径下市值和 `indicatorValue` 完全相等

把简报抄进 `report-values.json` 时，用 2026 − 2025 对照简报的"变化量"、13 市重算的平均、最大、最小、中位数对照简报的全省统计，都一致。
