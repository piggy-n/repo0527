// symbols:import 的命令行（tools/symbol-defaults/cli.ts）和 import.ts 之间的约定：只有普通数据，不导入别的模块，
// 命令行在 Node 里检查类型时读得了这个文件；import.ts 由 Vite 加载，用到页面的 schema 和登记表

export interface SymbolImportRequest {
  /** 控制台片段导出的文件内容 */
  readonly exported: string;
  /** 仓库里现在的 resource-symbol-defaults.json 的内容 */
  readonly current: string;
  /** 导出文件里有几个账号时选哪一个 */
  readonly login?: string;
  /** 只导入这些资源；不给时导入导出的全部资源 */
  readonly only?: readonly string[];
}

export interface SymbolImportResult {
  /** 给人看的报告：账号、逐项的差异、跳过的内容、离线核对不了的资源 */
  readonly report: readonly string[];
  /** 新的 resource-symbol-defaults.json 的内容，格式固定（按 code 排序） */
  readonly next: string;
  /** 和现在的发布默认符号相比有没有变化 */
  readonly changed: boolean;
}

/** import.ts 导出的入口；输入不对（不是 JSON、格式不对、选不出账号）时抛出说明原因的错误 */
export type ImportSymbolDefaults = (request: SymbolImportRequest) => SymbolImportResult;
