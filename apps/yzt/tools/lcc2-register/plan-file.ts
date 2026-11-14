// 平面图写到文件（lcc2:register --plan）：相对路径放在 local/ 下，写不了时只报一行原因
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { ToolError } from './errors.ts';

/**
 * 写平面图，返回写到的文件：相对路径放在 localRoot 下（不入库），绝对路径原样，目录没有就建。
 * 目标是目录、只读、被占用这类文件错误抛 ToolError，带上路径和错误码
 */
export async function writePlan(target: string, svg: string, localRoot: string): Promise<string> {
  const file = isAbsolute(target) ? target : resolve(localRoot, target);
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, svg);
  } catch (error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
      const reason = error.code === 'EISDIR' ? '这是目录' : error.code;
      throw new ToolError(`写不了平面图 ${file}：${reason}`, { cause: error });
    }
    throw error;
  }
  return file;
}
