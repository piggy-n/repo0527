// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectNotices } from './vite-plugin.ts';

// pnpm 安装后包所在的目录
const store = (name: string) => `node_modules/.pnpm/${name.replace('/', '+')}@1.0.0/node_modules/${name}`;

describe('collectNotices', () => {
  let root: string;

  const write = (path: string, content = path) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  const moduleId = (name: string) => join(root, store(name), 'dist/index.js');

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'third-party-notices-'));
    write(`${store('splat')}/LICENSE`, 'Apache License');
    write(`${store('splat')}/NOTICE`, 'Splat NOTICE');
    write(`${store('splat')}/licenses/LICENSE-d3`, 'BSD 3-Clause');
    write(`${store('plain')}/LICENSE`, 'MIT');
    write(`${store('@scope/noticed')}/NOTICE.txt`, 'NOTICE');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('清单里的包打进产物时，按清单从安装的包里取文件，放在 licenses/<包名>/ 下', () => {
    const files = collectNotices([moduleId('splat'), join(root, store('splat'), 'dist/worker.js')], {
      splat: ['LICENSE', 'NOTICE', 'licenses/LICENSE-d3']
    });
    expect(files).toEqual([
      { fileName: 'licenses/splat/LICENSE', source: 'Apache License' },
      { fileName: 'licenses/splat/NOTICE', source: 'Splat NOTICE' },
      { fileName: 'licenses/splat/licenses/LICENSE-d3', source: 'BSD 3-Clause' }
    ]);
  });

  it('清单里的包没打进产物时不带它的文件，不带 NOTICE 的包不用列出', () => {
    const moduleIds = [moduleId('plain'), join(root, 'src/main.ts'), '\0vite/preload-helper.js'];
    expect(collectNotices(moduleIds, { splat: ['NOTICE'] })).toEqual([]);
  });

  it('插件生成的 \\0 开头的模块也按后面的路径找包', () => {
    expect(collectNotices([`\0${moduleId('splat')}?commonjs-proxy`], { splat: ['NOTICE'] })).toEqual([
      { fileName: 'licenses/splat/NOTICE', source: 'Splat NOTICE' }
    ]);
  });

  it('带 NOTICE 的包打进了产物却不在清单里时报错，写明包名', () => {
    expect(() => collectNotices([moduleId('plain'), moduleId('@scope/noticed')], {})).toThrow(
      '产物包含带 NOTICE 的 @scope/noticed'
    );
  });

  it('清单里的文件不存在时报错（升级后改了文件名）', () => {
    expect(() => collectNotices([moduleId('splat')], { splat: ['THIRD_PARTY_LICENSES.md'] })).toThrow(
      'splat 里没有 THIRD_PARTY_LICENSES.md'
    );
  });
});
