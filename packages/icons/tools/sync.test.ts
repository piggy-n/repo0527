import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isUpToDate, syncIcons } from './sync.ts';

const square = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path fill="${color}" d="M0 0h8v8H0z"/></svg>`;

let root: string;
let dir: string;
let registryPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'yzt-icons-'));
  dir = join(root, 'icons');
  registryPath = join(root, 'icons.json');
  mkdirSync(dir);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function addFiles(files: Record<string, string>) {
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(dir, file), content);
  }
}

function readRegistry(): Record<string, { viewBox: string; body: string }> {
  const content: unknown = JSON.parse(readFileSync(registryPath, 'utf8'));
  return content as Record<string, { viewBox: string; body: string }>;
}

describe('syncIcons', () => {
  it('改名、规范化内容并按名字排序生成注册表', () => {
    addFiles({ 'UserAvatar.svg': square('#333'), 'map_layer.svg': square('red'), 'arrow.svg': square('blue') });

    const report = syncIcons({ dir, registryPath }, { write: true });

    expect(report.errors).toEqual([]);
    expect(report.renamed).toEqual([
      { from: 'UserAvatar.svg', to: 'user-avatar.svg' },
      { from: 'map_layer.svg', to: 'map-layer.svg' }
    ]);
    expect(readdirSync(dir).toSorted()).toEqual(['arrow.svg', 'map-layer.svg', 'user-avatar.svg']);
    expect(Object.keys(readRegistry())).toEqual(['arrow', 'map-layer', 'user-avatar']);
    expect(readFileSync(join(dir, 'user-avatar.svg'), 'utf8')).not.toContain('#333');
  });

  it('再次运行时没有任何变化', () => {
    addFiles({ 'UserAvatar.svg': square('#333') });
    syncIcons({ dir, registryPath }, { write: true });

    const report = syncIcons({ dir, registryPath }, { write: true });

    expect(isUpToDate(report)).toBe(true);
  });

  it('检查模式只报告，不改动文件', () => {
    addFiles({ 'UserAvatar.svg': square('#333') });

    const report = syncIcons({ dir, registryPath }, { write: false });

    expect(isUpToDate(report)).toBe(false);
    expect(report.renamed).toHaveLength(1);
    expect(report.normalized).toEqual(['user-avatar']);
    expect(report.registryChanged).toBe(true);
    expect(readdirSync(dir)).toEqual(['UserAvatar.svg']);
    expect(existsSync(registryPath)).toBe(false);
  });

  it('只改大小写时也能改名', () => {
    addFiles({ 'Arrow.svg': square('#333') });

    syncIcons({ dir, registryPath }, { write: true });

    expect(readdirSync(dir)).toEqual(['arrow.svg']);
  });

  it('中文文件名、转换后重名、无效 SVG 报错，其余图标照常处理', () => {
    addFiles({
      '图层.svg': square('#333'),
      'map_layer.svg': square('#333'),
      'MapLayer.svg': square('#333'),
      'broken.svg': '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>',
      'ok.svg': square('#333')
    });

    const report = syncIcons({ dir, registryPath }, { write: true });

    expect(report.errors).toHaveLength(3);
    expect(report.errors.join('\n')).toMatch(/图层\.svg：文件名无法转换/);
    expect(report.errors.join('\n')).toMatch(/map-layer 与其他文件重复/);
    expect(report.errors.join('\n')).toMatch(/broken：缺少 viewBox/);
    expect(Object.keys(readRegistry())).toEqual(['map-layer', 'ok']);
  });
});
