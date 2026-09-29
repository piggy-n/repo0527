#!/usr/bin/env node
import { describeReport, isUpToDate, syncIcons } from './sync.ts';

// 用法：yzt-icons <图标目录> <注册表 JSON> [--check]；--check 只检查不改动，有待处理的内容时退出码为 1
const args = process.argv.slice(2);
const check = args.includes('--check');
const [dir, registryPath] = args.filter(arg => arg !== '--check');
if (!dir || !registryPath) {
  console.error('用法：yzt-icons <图标目录> <注册表 JSON> [--check]');
  process.exit(1);
}

const report = syncIcons({ dir, registryPath }, { write: !check });
const lines = describeReport(report);
console.log(lines.length ? lines.map(line => `[icons] ${line}`).join('\n') : '[icons] 图标已是最新');
if (check && !isUpToDate(report)) {
  console.error('[icons] 以上内容尚未处理，请运行不带 --check 的命令');
}
process.exit(report.errors.length || (check && !isUpToDate(report)) ? 1 : 0);
