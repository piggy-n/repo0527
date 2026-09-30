import { groupBy } from 'lodash-es';
import * as fs from 'node:fs';
import { basename, join } from 'node:path';
import { isMulticolor, toIconName } from './naming.ts';
import { normalizeIcon, type NormalizedIcon } from './normalize.ts';

export interface IconsOptions {
  /** 图标 SVG 所在目录，不含子目录 */
  dir: string;
  /** 生成的注册表 JSON */
  registryPath: string;
}

export interface SyncReport {
  renamed: { from: string; to: string }[];
  /** 内容被规范化的图标名 */
  normalized: string[];
  registryChanged: boolean;
  errors: string[];
}

/** syncIcons 用到的文件操作，默认是 Node 的 fs；测试时替换其中一项，模拟其他进程同时改动文件 */
export interface IconFileSystem {
  existsSync(path: string): boolean;
  readdirSync(path: string): string[];
  readFileSync(path: string, encoding: 'utf8'): string;
  renameSync(from: string, to: string): void;
  writeFileSync(path: string, data: string): void;
}

const nodeFileSystem: IconFileSystem = {
  existsSync: path => fs.existsSync(path),
  readdirSync: path => fs.readdirSync(path),
  readFileSync: (path, encoding) => fs.readFileSync(path, encoding),
  renameSync: (from, to) => fs.renameSync(from, to),
  writeFileSync: (path, data) => fs.writeFileSync(path, data)
};

interface SyncSettings {
  /** false 时只报告需要做什么，不改动文件 */
  write: boolean;
  fileSystem?: IconFileSystem;
}

/** 检查模式下是否一切已是最新 */
export function isUpToDate(report: SyncReport): boolean {
  return !report.renamed.length && !report.normalized.length && !report.registryChanged && !report.errors.length;
}

// git 的 core.autocrlf 会在 Windows 上把检出的文件改成 CRLF，比较时统一成 LF，否则检查会误报
function readText(fileSystem: IconFileSystem, path: string): string {
  return fileSystem.readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

// 规范化并按需改名一个文件，成功后才记入报告
function syncFile(dir: string, file: string, name: string, settings: Required<SyncSettings>, report: SyncReport) {
  const { write, fileSystem } = settings;
  const icon: NormalizedIcon = normalizeIcon(
    fileSystem.readFileSync(join(dir, file), 'utf8'),
    name,
    isMulticolor(name)
  );
  const target = `${name}.svg`;
  if (file !== target) {
    if (write) {
      // 用 rename 而不是写新文件再删旧文件：Windows 上只改大小写时新旧路径是同一个文件
      fileSystem.renameSync(join(dir, file), join(dir, target));
    }
    report.renamed.push({ from: file, to: target });
  }

  const targetPath = join(dir, write ? target : file);
  if (readText(fileSystem, targetPath) !== icon.svg) {
    if (write) {
      fileSystem.writeFileSync(targetPath, icon.svg);
    }
    report.normalized.push(name);
  }
  return icon;
}

// 同名的多个文件只处理已是规范名的那个，其余报错且不改名；都不是规范名时全部跳过，由人决定保留哪个
function pickFile(name: string, files: string[], report: SyncReport): string | undefined {
  if (files.length === 1) {
    return files[0];
  }
  const kept = files.find(file => file === `${name}.svg`);
  for (const file of files) {
    if (file !== kept) {
      const others = files.filter(other => other !== file).join('、');
      report.errors.push(`${file}：转换后的名字 ${name} 与 ${others} 重复，请手动改名`);
    }
  }
  return kept;
}

/** 规范化目录中的全部图标并生成注册表 */
export function syncIcons({ dir, registryPath }: IconsOptions, settings: SyncSettings): SyncReport {
  const resolved: Required<SyncSettings> = { fileSystem: nodeFileSystem, ...settings };
  const { write, fileSystem } = resolved;
  const report: SyncReport = { renamed: [], normalized: [], registryChanged: false, errors: [] };
  const registry: Record<string, { viewBox: string; attrs?: Record<string, string>; body: string }> = {};
  const files = fileSystem
    .readdirSync(dir)
    .filter(file => file.toLowerCase().endsWith('.svg'))
    .toSorted();

  const named: { file: string; name: string }[] = [];
  for (const file of files) {
    const name = toIconName(basename(file, '.svg'));
    if (name) {
      named.push({ file, name });
    } else {
      report.errors.push(`${file}：文件名无法转换为短横线命名（含中文或特殊字符），请手动改名`);
    }
  }

  // 先按转换后的名字分组查重，再改动文件：边改名边查重时，改名会覆盖排在后面的同名文件
  for (const [name, group] of Object.entries(groupBy(named, entry => entry.name))) {
    const file = pickFile(name, group.map(entry => entry.file), report);
    if (!file) {
      continue;
    }

    try {
      const { viewBox, attrs, body } = syncFile(dir, file, name, resolved, report);
      registry[name] = attrs ? { viewBox, attrs, body } : { viewBox, body };
    } catch (error) {
      // 处理途中文件被删除或被其他进程改名（例如同时开着两个开发服务器）时跳过；改名后的文件会触发下一次同步
      if (!isMissingFile(error)) {
        report.errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  // 按规范化后的名字排序，输出与原始文件名无关
  const sorted = Object.fromEntries(Object.entries(registry).toSorted(([a], [b]) => (a < b ? -1 : 1)));
  const content = `${JSON.stringify(sorted, null, 2)}\n`;
  if (!fileSystem.existsSync(registryPath) || readText(fileSystem, registryPath) !== content) {
    report.registryChanged = true;
    if (write) {
      fileSystem.writeFileSync(registryPath, content);
    }
  }
  return report;
}

/** 把报告整理成给人看的文字，没有变化时返回空数组 */
export function describeReport(report: SyncReport): string[] {
  return [
    ...report.renamed.map(({ from, to }) => `改名：${from} → ${to}`),
    ...(report.normalized.length ? [`规范化：${report.normalized.join('、')}`] : []),
    ...(report.registryChanged ? ['注册表已更新'] : []),
    ...report.errors.map(error => `错误：${error}`)
  ];
}
