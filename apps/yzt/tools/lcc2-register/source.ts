import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { ToolError } from './errors.ts';
import { parseIndex, parsePoses } from './lcc2-data.ts';
import type { RegisterInput } from './register.ts';

// 读模型的文件。相对路径的规则和开发服务器的 /3dt/ 一样（docs/config/local-files.md），本机和 HTTP 只在这里分开

/** 一个文件最长读多久（毫秒） */
const REQUEST_TIMEOUT = 120_000;

// 响应是这些类型时一定不是要的文件：网页是错误页或回退到 index.html，JSON 是后端的错误
const NOT_JSON_FILE = ['text/html'];
const NOT_MESH = ['text/html', 'application/json'];

export interface SourceOptions {
  /** 相对路径在本机时的根目录（local/3dt） */
  readonly localRoot: string;
  /** 环境变量 YZT_3DT_PROXY：给了时相对路径从 <proxy>/3dt/ 读 */
  readonly proxy: string | undefined;
  /** 一个文件最长读多久（毫秒），默认两分钟 */
  readonly timeout?: number;
}

export interface ModelData extends RegisterInput {
  /** 索引在哪里（本机路径或地址），打印用 */
  readonly location: string;
  readonly meshes: AsyncIterable<{ readonly name: string; readonly bytes: Uint8Array }>;
}

interface ModelFile {
  /** 打印和报错用的位置 */
  readonly location: string;
  read(): Promise<Uint8Array>;
}

interface Source {
  readonly index: ModelFile;
  /** 相对索引所在目录的文件 */
  file(path: string, notExpected: readonly string[]): ModelFile;
}

function localFile(path: string, hint: string): ModelFile {
  return {
    location: path,
    read: async () => {
      try {
        return await readFile(path);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          throw new ToolError(`找不到 ${path}${hint}`, { cause: error });
        }
        throw error;
      }
    }
  };
}

function localSource(indexPath: string, hint: string): Source {
  const root = dirname(indexPath);
  return {
    index: localFile(indexPath, hint),
    file: (path) => localFile(join(root, path), hint)
  };
}

// 报错里的地址把中文还原，看得出是哪个模型
function readable(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

// fetch 失败时 message 只有 fetch failed，真正的原因在 cause 里
function networkReason(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause instanceof Error && cause.message) {
    return cause.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function httpFile(url: URL, notExpected: readonly string[], timeout: number, hint: string): ModelFile {
  const location = readable(url.href);
  const failure = (reason: string, cause?: unknown) => new ToolError(`读不到 ${location}：${reason}${hint}`, { cause });
  return {
    location,
    read: async () => {
      try {
        // 超时包括读响应体的时间：连上以后不再发数据也算
        const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
        const type = response.headers.get('content-type') ?? '';
        if (!response.ok || notExpected.some((value) => type.includes(value))) {
          // 读完响应体连接才放回去，进程才能马上退出；这种响应都很短
          await response.arrayBuffer();
          throw failure(
            response.ok
              ? `服务器返回的是 ${type}，不是模型的文件，地址可能不对，或者路径不存在时回退到了页面`
              : `HTTP ${response.status}`
          );
        }
        return new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        if (error instanceof ToolError) {
          throw error;
        }
        if (error instanceof DOMException && error.name === 'TimeoutError') {
          throw failure(`${timeout / 1000} 秒内没有读完`, error);
        }
        throw failure(networkReason(error), error);
      }
    }
  };
}

function httpSource(indexUrl: URL, timeout: number, hint: string): Source {
  return {
    index: httpFile(indexUrl, NOT_JSON_FILE, timeout, hint),
    file: (path, notExpected) => httpFile(new URL(encodePath(path), indexUrl), notExpected, timeout, hint)
  };
}

// 每一段都编码：文件名有中文，相对路径里不能被当成协议或查询串
const encodePath = (path: string) =>
  path
    .split(/[\\/]+/)
    .filter((part) => part !== '' && part !== '.')
    .map(encodeURIComponent)
    .join('/');

function httpUrl(text: string, name: string): URL {
  const url = URL.parse(text);
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new ToolError(`${name} 要是 http:// 或 https:// 开头的地址：${text}`);
  }
  return url;
}

function openSource(target: string, options: SourceOptions): Source {
  const { localRoot, proxy, timeout = REQUEST_TIMEOUT } = options;
  if (/^https?:\/\//i.test(target)) {
    return httpSource(httpUrl(target, '索引'), timeout, '');
  }
  if (isAbsolute(target)) {
    return localSource(target, '');
  }
  if (proxy) {
    const base = httpUrl(proxy, 'YZT_3DT_PROXY');
    const root = base.href.endsWith('/') ? base : new URL(`${base.href}/`);
    return httpSource(new URL(`3dt/${encodePath(target)}`, root), timeout, `（YZT_3DT_PROXY 是 ${proxy}）`);
  }
  return localSource(
    join(localRoot, target),
    `（相对路径从 ${localRoot} 下找，worktree 里设 YZT_LOCAL_DIR 指回主目录，模型在服务器上时设 YZT_3DT_PROXY）`
  );
}

// 读 JSON 文件并校验：格式不对时说是哪个文件
async function readJson<T>(file: ModelFile, parse: (text: string) => T): Promise<T> {
  const text = new TextDecoder().decode(await file.read());
  try {
    return parse(text);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = z.prettifyError(error).split(/\r?\n/).join('；');
      throw new ToolError(`${file.location} 的内容不对：${issues}`, { cause: error });
    }
    if (error instanceof SyntaxError) {
      throw new ToolError(`${file.location} 不是合法的 JSON：${error.message}`, { cause: error });
    }
    throw error;
  }
}

// 一次读一个，register 解析完才读下一个：大模型有 79 个、约 200 MB，内存里只留一个，同一时间只有一个请求
async function* readMeshes(source: Source, files: readonly string[]) {
  for (const file of files) {
    // oxlint-disable-next-line no-await-in-loop -- 有意一个一个读，内存里只留一个文件
    yield { name: file, bytes: await source.file(file, NOT_MESH).read() };
  }
}

/** 读配准要的文件：target 是相对路径、绝对路径或完整的地址；网格读取时才取，边读边交 */
export async function readModel(target: string, options: SourceOptions): Promise<ModelData> {
  const source = openSource(target, options);
  const index = await readJson(source.index, parseIndex);
  const trajectory = await readJson(source.file('info/poses.json', NOT_JSON_FILE), parsePoses);
  const { meshFiles } = index.root;
  if (meshFiles.length === 0) {
    throw new ToolError('索引的 root.meshFiles 是空的：这份数据没有碰撞网格，没法拟合和核对');
  }
  return { location: source.index.location, index, trajectory, meshes: readMeshes(source, meshFiles) };
}
