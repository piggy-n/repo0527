import { readFileSync, writeFileSync } from 'node:fs';

// 根配置路径与原始文本，用于保留 UTF-8、缩进和换行
const manifestPath = new URL('../package.json', import.meta.url);
const source = readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(source.replace(/^\uFEFF/, ''));
const packageManager = manifest.devEngines?.packageManager;

if (packageManager?.name !== 'pnpm' || typeof packageManager.version !== 'string') {
  throw new Error('需要先配置 devEngines.packageManager 为 pnpm');
}

// self-update 解析出的稳定版本，只保留所属大版本的范围
const versionMatch = /^\^?([1-9]\d*)(?:\.\d+\.\d+)?$/.exec(packageManager.version);
if (!versionMatch) {
  throw new Error(`无法识别 pnpm 稳定版本：${packageManager.version}`);
}
const majorRange = `^${versionMatch[1]}`;

if (packageManager.version !== majorRange) {
  // 仅替换唯一匹配的版本字段，遇到歧义时停止，避免修改其他字段
  const versionFields = [...source.matchAll(/"version"\s*:\s*("(?:[^"\\]|\\.)*")/g)]
    .filter((field) => JSON.parse(field[1]) === packageManager.version);
  if (versionFields.length !== 1) {
    throw new Error('无法唯一定位 pnpm 版本字段，请检查 package.json');
  }
  const field = versionFields[0];
  const offset = field.index + field[0].length - field[1].length;
  const updated = source.slice(0, offset) + JSON.stringify(majorRange)
    + source.slice(offset + field[1].length);
  writeFileSync(manifestPath, updated, 'utf8');
}

console.log(`pnpm 版本范围已设置为 ${majorRange}`);
