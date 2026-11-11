// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Rolldown } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectNotices, thirdPartyNoticesPlugin } from './vite-plugin.ts';

// pnpm 安装后包所在的目录；suffix 是 peer 依赖不同时目录名上多出的部分
const store = (name: string, version = '1.0.0', suffix = '') =>
  `node_modules/.pnpm/${name.replace('/', '+')}@${version}${suffix}/node_modules/${name}`;

describe('third-party-notices', () => {
  let root: string;

  const write = (path: string, content = path) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  const install = (name: string, files: Record<string, string>, version = '1.0.0', suffix = '') => {
    const directory = store(name, version, suffix);
    write(`${directory}/package.json`, JSON.stringify({ name, version }));
    for (const [path, content] of Object.entries(files)) {
      write(`${directory}/${path}`, content);
    }
  };
  const moduleId = (name: string, version = '1.0.0', suffix = '') =>
    join(root, store(name, version, suffix), 'dist/index.js');

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'third-party-notices-'));
    const splat = { LICENSE: 'Apache License', NOTICE: 'Splat NOTICE', 'licenses/LICENSE-d3': 'BSD 3-Clause' };
    install('splat', splat);
    install('splat', splat, '1.0.0', '_three@0.187.0');
    install('splat', { LICENSE: 'Apache License', NOTICE: 'Splat 2 NOTICE' }, '2.0.0');
    install('plain', { LICENSE: 'MIT' });
    install('plain', { LICENSE: 'Apache License', NOTICE: 'plain 2 NOTICE' }, '2.0.0');
    install('@scope/noticed', { 'NOTICE.txt': 'NOTICE' });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('collectNotices', () => {
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

    it('同一个包打进了两个版本时每个都检查：先出现的版本没有 NOTICE 也拦得住后一个', () => {
      expect(() => collectNotices([moduleId('plain'), moduleId('plain', '2.0.0')], {})).toThrow(
        '产物包含带 NOTICE 的 plain'
      );
    });

    it('清单里的包打进了两个版本时报错，同一版本的几个目录只带一份', () => {
      expect(() => collectNotices([moduleId('splat'), moduleId('splat', '2.0.0')], { splat: ['NOTICE'] })).toThrow(
        '产物包含 splat 的两个版本（1.0.0、2.0.0）'
      );
      const sameVersion = [moduleId('splat', '1.0.0', '_three@0.187.0'), moduleId('splat')];
      expect(collectNotices(sameVersion, { splat: ['NOTICE'] })).toEqual([
        { fileName: 'licenses/splat/NOTICE', source: 'Splat NOTICE' }
      ]);
    });

    it('清单里的文件不存在时报错（升级后改了文件名）', () => {
      expect(() => collectNotices([moduleId('splat')], { splat: ['THIRD_PARTY_LICENSES.md'] })).toThrow(
        'splat 里没有 THIRD_PARTY_LICENSES.md'
      );
    });
  });

  describe('thirdPartyNoticesPlugin', () => {
    it('看所有分块（包括动态分块）的模块，跳过资源文件，把许可文件作为资源输出', async () => {
      const plugin = thirdPartyNoticesPlugin({ splat: ['LICENSE', 'NOTICE'] });
      const hook = plugin.generateBundle;
      if (typeof hook !== 'function') {
        throw new TypeError('generateBundle 应该是函数');
      }
      const bundle = {
        'assets/index.js': { type: 'chunk', isEntry: true, moduleIds: [join(root, 'src/main.ts')] },
        'assets/map-three.js': { type: 'chunk', isEntry: false, isDynamicEntry: true, moduleIds: [moduleId('splat')] },
        'assets/index.css': { type: 'asset', fileName: 'assets/index.css', source: '' }
      } as unknown as Rolldown.OutputBundle;
      const emitted: unknown[] = [];
      const context = {
        emitFile: (file: unknown) => {
          emitted.push(file);
          return '';
        }
      } as unknown as ThisParameterType<typeof hook>;
      await hook.call(context, {} as Rolldown.NormalizedOutputOptions, bundle, false);
      expect(emitted).toEqual([
        { type: 'asset', fileName: 'licenses/splat/LICENSE', source: 'Apache License' },
        { type: 'asset', fileName: 'licenses/splat/NOTICE', source: 'Splat NOTICE' }
      ]);
    });

    it('只在构建时生效', () => {
      expect(thirdPartyNoticesPlugin().apply).toBe('build');
    });
  });
});
