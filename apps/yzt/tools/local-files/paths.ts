import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');

/** 未入库的本地文件（模型、原型、探查结果、实测数据）下的路径；worktree 用 YZT_LOCAL_DIR 指回主目录（ADR 0141） */
export function localPath(...segments: string[]): string {
  return resolve(REPO_ROOT, process.env.YZT_LOCAL_DIR || 'local', ...segments);
}
