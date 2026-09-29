import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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

/** 检查模式下是否一切已是最新 */
export function isUpToDate(report: SyncReport): boolean {
  return !report.renamed.length && !report.normalized.length && !report.registryChanged && !report.errors.length;
}

/** 规范化目录中的全部图标并生成注册表；write 为 false 时只报告需要做什么，不改动文件 */
export function syncIcons({ dir, registryPath }: IconsOptions, { write }: { write: boolean }): SyncReport {
  const report: SyncReport = { renamed: [], normalized: [], registryChanged: false, errors: [] };
  const registry: Record<string, { viewBox: string; attrs?: Record<string, string>; body: string }> = {};
  const files = readdirSync(dir)
    .filter(file => file.toLowerCase().endsWith('.svg'))
    .toSorted();

  for (const file of files) {
    const name = toIconName(basename(file, '.svg'));
    if (!name) {
      report.errors.push(`${file}：文件名无法转换为短横线命名（含中文或特殊字符），请手动改名`);
      continue;
    }
    if (name in registry) {
      report.errors.push(`${file}：转换后的名字 ${name} 与其他文件重复`);
      continue;
    }

    let icon: NormalizedIcon;
    try {
      icon = normalizeIcon(readFileSync(join(dir, file), 'utf8'), name, isMulticolor(name));
    } catch (error) {
      report.errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }

    const target = `${name}.svg`;
    if (file !== target) {
      report.renamed.push({ from: file, to: target });
      if (write) {
        // 用 rename 而不是写新文件再删旧文件：Windows 上只改大小写时新旧路径是同一个文件
        renameSync(join(dir, file), join(dir, target));
      }
    }
    const targetPath = join(dir, write ? target : file);
    if (readFileSync(targetPath, 'utf8') !== icon.svg) {
      report.normalized.push(name);
      if (write) {
        writeFileSync(targetPath, icon.svg);
      }
    }

    const { viewBox, attrs, body } = icon;
    registry[name] = attrs ? { viewBox, attrs, body } : { viewBox, body };
  }

  // 按规范化后的名字排序，输出与原始文件名无关
  const sorted = Object.fromEntries(Object.entries(registry).toSorted(([a], [b]) => (a < b ? -1 : 1)));
  const content = `${JSON.stringify(sorted, null, 2)}\n`;
  if (!existsSync(registryPath) || readFileSync(registryPath, 'utf8') !== content) {
    report.registryChanged = true;
    if (write) {
      writeFileSync(registryPath, content);
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
