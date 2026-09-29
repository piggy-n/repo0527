# 0009. 关闭 tsc 的增量检查

- 状态：已接受
- 日期：2026-09-29
- 取代：ADR 0003 中"`tsc -b` 配合 `noEmit` 时要开启 `incremental`"这一条约定，0003 的其余内容不变

## 背景

阶段一按 ADR 0003 给 `tsconfig.app.json`、`tsconfig.node.json` 开启了 `incremental`，让 `tsc -b` 跳过没有变化的文件。

阶段二验证 `ImportMetaEnv` 的严格模式时发现，TS 7.0.2 的增量检查在 `declare global` 文件变化后，不会重新检查依赖这些全局类型的文件。在 `shared/config/import-meta-env.ts` 上可以稳定复现两个方向的错误结果：

| 步骤 | 增量检查的结果 | 正确结果 |
|---|---|---|
| 关闭 `strictImportMetaEnv` | 仍然报"变量名不存在"（误报） | 不报错 |
| 重新开启 | 不报错（漏报） | 报错 |

同样的状态用 `tsc -b --force` 或非增量检查，结果都正确。用 `declare module 'vue-router'` 扩充 `RouteMeta` 做同样的实验，增量检查结果正确，所以问题只出现在全局扩充上。

CI 每次从零检查，不受影响；受影响的是本地的 `pnpm typecheck`，其中漏报会让错误代码在本地通过检查。

耗时对比（`apps/web` 当前规模）：增量约 0.85 秒，全量约 1.1～1.2 秒。

## 候选方案

1. 从 tsconfig 中去掉 `incremental`：`tsc -b` 在 `noEmit` 下每次都全量检查，不管是通过脚本还是手动运行，结果都正确
2. 保留 tsconfig，只把 `typecheck` 脚本改为 `tsc -b --force`：手动运行 `tsc -b` 时仍可能得到过期结果
3. 保留增量检查，在文档里提醒修改 `declare global` 文件后手动 `--force`：依赖人记住，忘记时会漏报

## 决定

选方案 1。暂不向 TypeScript 上报。

`tsBuildInfoFile` 保留：不开 `incremental` 时，build 模式仍会写一份只含根文件和 `package.json` 列表的记录，用来判断项目是否需要重查，不包含逐个文件的检查信息。不指定位置时它会出现在 tsconfig 旁边，所以继续放在 `node_modules/.tmp/`。

## 后果

- 好处：本地和 CI 的类型检查结果一致，不再有过期结果；也不再需要"删除 `.tmp` 后重跑"这类排查步骤
- 代价：每次检查多约 0.3 秒。项目变大后差距会增加，届时再权衡
- 重新开启的条件：升级 TS 后，用上表的步骤复测（`docs/config/tsconfig.md` 中有具体做法），增量检查结果正确时，写新的 ADR 恢复
