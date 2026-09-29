import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type IconFileSystem, syncIcons } from './sync.ts';

const square = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path fill="#333" d="M0 0h8v8H0z"/></svg>';

let root = '';

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// 真实的文件操作，只把改名换成"文件已被其他进程改名"
const alreadyRenamed: IconFileSystem = {
  existsSync: path => fs.existsSync(path),
  readdirSync: path => fs.readdirSync(path),
  readFileSync: (path, encoding) => fs.readFileSync(path, encoding),
  renameSync: () => {
    throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
  },
  writeFileSync: (path, data) => fs.writeFileSync(path, data)
};

describe('syncIcons 与其他进程同时处理', () => {
  it('改名时文件已经不存在：跳过，不报错也不记入报告', () => {
    root = fs.mkdtempSync(join(tmpdir(), 'yzt-icons-race-'));
    const dir = join(root, 'icons');
    const registryPath = join(root, 'icons.json');
    fs.mkdirSync(dir);
    fs.writeFileSync(join(dir, 'Drop_Test.svg'), square);
    fs.writeFileSync(join(dir, 'ok.svg'), square);

    const report = syncIcons({ dir, registryPath }, { write: true, fileSystem: alreadyRenamed });

    expect(report.errors).toEqual([]);
    expect(report.renamed).toEqual([]);
    expect(Object.keys(JSON.parse(fs.readFileSync(registryPath, 'utf8')) as object)).toEqual(['ok']);
  });
});
