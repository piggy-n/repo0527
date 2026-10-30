# 城市体检指标：目录与模拟值（shared/city-indicators）

城市体检驾驶舱和指标智能推演共用的指标目录和固定模拟值。2026-10-28 从 `features/city-dashboard` 移来（ADR 0105 第 4 条）：features 之间不能互相导入，第二个使用方出现后上移到 shared。

```
shared/city-indicators/
├─ indicator-catalog.json   96 项指标（旧项目 data.json、data2.json 归并，口径见 city-dashboard.md"数据口径"）
├─ catalog.ts               Indicator、CategoryId 类型，INDICATORS，INDICATOR_CATEGORIES（四类及名称），requireIndicator
├─ indicator-profiles.ts    每项指标的参考量级、城市特征、年变化与演变方式，createProfileValue（内部使用）
├─ mock-value.ts            mockIndicatorValue(cityCode, indicator, year)
└─ stable-random.ts         stableRandom(key)：按键的固定伪随机数，生成规则和推演模型的区县分解、撒点共用
```

## 用法

```ts
import { requireIndicator } from '@/shared/city-indicators/catalog';
import { mockIndicatorValue } from '@/shared/city-indicators/mock-value';

mockIndicatorValue('320100', requireIndicator('B-65'), 2026);
```

- 同样的市、年份、指标永远得到同一个值；以 2025 为参数锚点，跨自然年后既有年份不漂移
- 保留指标之间的约束：建筑合计等于分项（A-16、G01-6），生活圈并集不小于交集（A09-2 ≥ A-30）
- 百分比不超过 100，全部不小于 0；不在城市名单里的市没有城市特征
- 值是演示假设，不代表真实城市排名、业务阈值或统计结果

## 各页面自己保留的

- 驾驶舱：开放年份、城市名单与标签锚点（`features/city-dashboard/catalog.ts`），带分组指标列表的 `CATEGORIES`，十年记录的构建与查询（`data/mock-data.ts`）。驾驶舱的 `model.ts` 从这里转出 `Indicator`、`CategoryId`，各处仍从 `model.ts` 取
- 指标智能推演：区县分解、推演模型与参数（S3，见 [indicator-simulation.md](indicator-simulation.md)）

## 测试

- `catalog.test.ts`：96 项、编码不重复、四类各自的项数、来源字段；缺项抛错
- `mock-value.test.ts`：同样的输入同一个值；合计与分项、并集与交集的约束；取值范围
- 驾驶舱的 `data/mock-data.test.ts` 仍比对全部 12480 个值和六年分档与旧 master-demo 的摘要，移动前后一致。故意让 A-16 只算一个分项、去掉 A09-2 的约束，两边的用例都失败
