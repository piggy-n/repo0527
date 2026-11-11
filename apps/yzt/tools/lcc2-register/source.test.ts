// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ToolError } from './errors.ts';
import { readModel, type SourceOptions } from './source.ts';

const NAME = '楚王山1号';
const ENCODED = '%E6%A5%9A%E7%8E%8B%E5%B1%B11%E5%8F%B7';
const RELATIVE = `${NAME}/lcc2-sog-result/${NAME}.lcc2`;
const PROXY = 'http://models.test:8088';
const INDEX_PATH = `/3dt/${ENCODED}/lcc2-sog-result/${ENCODED}.lcc2`;
const DIRECTORY = `/3dt/${ENCODED}/lcc2-sog-result`;

const INDEX = { epsg: 4548, offset: [1, 2, 3], root: { meshFiles: ['data/mesh/0.ply', 'data/mesh/1.ply'] } };
const POSES = { poses: [{ T: [1, 2, 3] }], fusionPoses: null };
const MESH_0 = new TextEncoder().encode('ply mesh 0');
const MESH_1 = new TextEncoder().encode('ply mesh 1');

// 键是请求的路径（编码后的原样）
type Responder = () => Response | Promise<Response>;
const binary = (bytes: Uint8Array) => () =>
  new HttpResponse(bytes, { headers: { 'Content-Type': 'application/octet-stream' } });
const indexResponse: Responder = () =>
  HttpResponse.text(JSON.stringify(INDEX), { headers: { 'Content-Type': 'application/octet-stream' } });
const posesResponse: Responder = () => HttpResponse.json(POSES);
const MODEL: Record<string, Responder> = {
  [INDEX_PATH]: indexResponse,
  [`${DIRECTORY}/info/poses.json`]: posesResponse,
  [`${DIRECTORY}/data/mesh/0.ply`]: binary(MESH_0),
  [`${DIRECTORY}/data/mesh/1.ply`]: binary(MESH_1)
};

const server = setupServer();
const requests: string[] = [];
const countMeshRequests = () => requests.filter((path) => path.includes('/data/mesh/')).length;

// 服务器按路径应答，别的路径 404（和 nginx 一样是 HTML 的错误页）
function serve(overrides: Record<string, Responder> = {}, origin = PROXY) {
  const files = { ...MODEL, ...overrides };
  server.use(
    http.get(`${origin}/*`, ({ request }) => {
      const { pathname } = new URL(request.url);
      requests.push(pathname);
      const responder = files[pathname];
      return responder ? responder() : new HttpResponse('<html>404</html>', { status: 404 });
    })
  );
}

let localRoot = '';
const options = (extra: Partial<SourceOptions> = {}): SourceOptions => ({ localRoot, proxy: undefined, ...extra });

function writeLocal(root: string, relative: string, content: string | Uint8Array) {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function writeLocalModel() {
  writeLocal(localRoot, RELATIVE, JSON.stringify(INDEX));
  writeLocal(localRoot, `${NAME}/lcc2-sog-result/info/poses.json`, JSON.stringify(POSES));
  writeLocal(localRoot, `${NAME}/lcc2-sog-result/data/mesh/0.ply`, MESH_0);
  writeLocal(localRoot, `${NAME}/lcc2-sog-result/data/mesh/1.ply`, MESH_1);
}

async function meshesOf(model: Awaited<ReturnType<typeof readModel>>) {
  const meshes: { name: string; text: string }[] = [];
  for await (const { name, bytes } of model.meshes) {
    meshes.push({ name, text: new TextDecoder().decode(bytes) });
  }
  return meshes;
}

// 读模型（包括全部网格）时的错：必须是命令行只打印一行的 ToolError
async function failureOf(target: string, extra: Partial<SourceOptions> = {}) {
  let error: unknown;
  try {
    await meshesOf(await readModel(target, options(extra)));
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(ToolError);
  const { message } = error as ToolError;
  expect(message).not.toContain('\n');
  return message;
}

const EXPECTED_MESHES = [
  { name: 'data/mesh/0.ply', text: 'ply mesh 0' },
  { name: 'data/mesh/1.ply', text: 'ply mesh 1' }
];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  localRoot = mkdtempSync(join(tmpdir(), 'lcc2-source-'));
  requests.length = 0;
});
afterEach(() => {
  server.resetHandlers();
  rmSync(localRoot, { recursive: true, force: true });
});
afterAll(() => server.close());

describe('readModel：从哪里读', () => {
  it('相对路径、没设代理：从本机目录读', async () => {
    writeLocalModel();
    const model = await readModel(RELATIVE, options());
    expect(model.location).toBe(join(localRoot, RELATIVE));
    expect(model.index.epsg).toBe(4548);
    expect(model.trajectory).toEqual([[1, 2, 3]]);
    expect(await meshesOf(model)).toEqual(EXPECTED_MESHES);
  });

  it('相对路径、设了代理：同一个路径从 <代理>/3dt/ 读，中文按段编码，本机目录不看', async () => {
    serve();
    const model = await readModel(RELATIVE, options({ proxy: PROXY }));
    expect(await meshesOf(model)).toEqual(EXPECTED_MESHES);
    expect(requests).toEqual([
      INDEX_PATH,
      `${DIRECTORY}/info/poses.json`,
      `${DIRECTORY}/data/mesh/0.ply`,
      `${DIRECTORY}/data/mesh/1.ply`
    ]);
    expect(model.location).toBe(`${PROXY}/3dt/${RELATIVE}`);
  });

  it('代理的地址以 / 结尾、相对路径用反斜杠：地址一样', async () => {
    serve();
    await readModel(RELATIVE.replaceAll('/', '\\'), options({ proxy: `${PROXY}/` }));
    expect(requests[0]).toBe(INDEX_PATH);
  });

  it('文件名里的 #、% 按段编码，不当成地址的一部分', async () => {
    serve({ '/3dt/a%23b%25c/x.lcc2': indexResponse, '/3dt/a%23b%25c/info/poses.json': posesResponse });
    await readModel('a#b%c/x.lcc2', options({ proxy: PROXY }));
    expect(requests).toEqual(['/3dt/a%23b%25c/x.lcc2', '/3dt/a%23b%25c/info/poses.json']);
  });

  it('绝对路径：设了代理也从本机读', async () => {
    writeLocalModel();
    const model = await readModel(join(localRoot, RELATIVE), options({ proxy: PROXY }));
    expect(await meshesOf(model)).toEqual(EXPECTED_MESHES);
    expect(requests).toEqual([]);
  });

  it('完整的地址：没设代理也从 HTTP 读，中文没编码时编码，同级的文件跟着它的目录', async () => {
    serve({}, 'http://other.test');
    const model = await readModel(`http://other.test/3dt/${RELATIVE}`, options());
    expect(await meshesOf(model)).toEqual(EXPECTED_MESHES);
    expect(requests[0]).toBe(INDEX_PATH);
    expect(requests[1]).toBe(`${DIRECTORY}/info/poses.json`);
  });

  it('完整的地址已经编码：不重复编码，代理不起作用', async () => {
    serve({}, 'http://other.test');
    await readModel(`http://other.test${INDEX_PATH}`, options({ proxy: PROXY }));
    expect(requests[0]).toBe(INDEX_PATH);
  });
});

describe('readModel：读取', () => {
  it('网格一个一个读：解析完一个才请求下一个，开始时不请求', async () => {
    serve();
    const model = await readModel(RELATIVE, options({ proxy: PROXY }));
    expect(countMeshRequests()).toBe(0);

    const iterator = model.meshes[Symbol.asyncIterator]();
    await iterator.next();
    expect(countMeshRequests()).toBe(1);
    await iterator.next();
    expect(countMeshRequests()).toBe(2);
  });

  it('索引带 BOM 也能读', async () => {
    serve({ [INDEX_PATH]: () => HttpResponse.text(`﻿${JSON.stringify(INDEX)}`) });
    const model = await readModel(RELATIVE, options({ proxy: PROXY }));
    expect(model.index.epsg).toBe(4548);
  });
});

describe('readModel：失败时一行原因', () => {
  it('本机文件缺了：说路径和从哪里找', async () => {
    const message = await failureOf(RELATIVE);
    expect(message).toContain(join(localRoot, RELATIVE));
    expect(message).toContain('YZT_LOCAL_DIR');
  });

  it('本机缺碰撞网格：说是哪个文件', async () => {
    writeLocalModel();
    rmSync(join(localRoot, `${NAME}/lcc2-sog-result/data/mesh/1.ply`));
    expect(await failureOf(RELATIVE)).toContain(join(localRoot, `${NAME}/lcc2-sog-result/data/mesh/1.ply`));
  });

  it('索引 404：说地址、状态和代理', async () => {
    serve({ [INDEX_PATH]: () => new HttpResponse('nope', { status: 404 }) });
    const message = await failureOf(RELATIVE, { proxy: PROXY });
    expect(message).toContain(`${PROXY}/3dt/${RELATIVE}`);
    expect(message).toContain('HTTP 404');
    expect(message).toContain(`YZT_3DT_PROXY 是 ${PROXY}`);
  });

  it('碰撞网格 404：说是哪个文件', async () => {
    serve({ [`${DIRECTORY}/data/mesh/1.ply`]: () => new HttpResponse('nope', { status: 404 }) });
    const message = await failureOf(RELATIVE, { proxy: PROXY });
    expect(message).toContain('data/mesh/1.ply');
    expect(message).toContain('HTTP 404');
  });

  it('索引 200 但回退成了页面：说返回的是网页', async () => {
    serve({ [INDEX_PATH]: () => HttpResponse.html('<!doctype html><html></html>') });
    expect(await failureOf(RELATIVE, { proxy: PROXY })).toContain('text/html');
  });

  it('轨迹 200 但回退成了页面：说返回的是网页', async () => {
    serve({ [`${DIRECTORY}/info/poses.json`]: () => HttpResponse.html('<html></html>') });
    const message = await failureOf(RELATIVE, { proxy: PROXY });
    expect(message).toContain('info/poses.json');
    expect(message).toContain('text/html');
  });

  it('索引 200 但是后端的 JSON 错误：说内容不对', async () => {
    serve({ [INDEX_PATH]: () => HttpResponse.json({ code: 500, message: 'error' }) });
    const message = await failureOf(RELATIVE, { proxy: PROXY });
    expect(message).toContain('的内容不对');
    expect(message).toContain(`${PROXY}/3dt/${RELATIVE}`);
  });

  it('网格 200 但是 JSON：不交给 PLY 解析', async () => {
    serve({ [`${DIRECTORY}/data/mesh/0.ply`]: () => HttpResponse.json({ code: 500 }) });
    const message = await failureOf(RELATIVE, { proxy: PROXY });
    expect(message).toContain('data/mesh/0.ply');
    expect(message).toContain('application/json');
  });

  it('网格 200 但是网页：不交给 PLY 解析', async () => {
    serve({ [`${DIRECTORY}/data/mesh/0.ply`]: () => HttpResponse.html('<html></html>') });
    expect(await failureOf(RELATIVE, { proxy: PROXY })).toContain('text/html');
  });

  it('索引不是 JSON：说不是合法的 JSON', async () => {
    serve({ [INDEX_PATH]: () => HttpResponse.text('garbage') });
    expect(await failureOf(RELATIVE, { proxy: PROXY })).toContain('不是合法的 JSON');
  });

  it('超时：说多久没读完', async () => {
    serve({
      [INDEX_PATH]: async () => {
        await delay('infinite');
        return new HttpResponse(null);
      }
    });
    // 请求不超时的话一直挂着：和比超时长得多的定时器赛跑，失败在断言上
    const never = new Promise<string>((resolve) => {
      setTimeout(() => resolve('没有超时'), 1000);
    });
    const message = await Promise.race([failureOf(RELATIVE, { proxy: PROXY, timeout: 20 }), never]);
    expect(message).toContain(`${PROXY}/3dt/${RELATIVE}`);
    expect(message).toContain('0.02 秒内没有读完');
  });

  it('连不上：说地址', async () => {
    serve({ [INDEX_PATH]: () => HttpResponse.error() });
    expect(await failureOf(RELATIVE, { proxy: PROXY })).toContain(`${PROXY}/3dt/${RELATIVE}`);
  });

  it('YZT_3DT_PROXY 不是 http 地址：说变量名', async () => {
    expect(await failureOf(RELATIVE, { proxy: 'models.test:8088' })).toContain('YZT_3DT_PROXY');
  });

  it('索引没有碰撞网格：说原因', async () => {
    serve({ [INDEX_PATH]: () => HttpResponse.text(JSON.stringify({ ...INDEX, root: { meshFiles: [] } })) });
    expect(await failureOf(RELATIVE, { proxy: PROXY })).toContain('root.meshFiles 是空的');
  });
});
