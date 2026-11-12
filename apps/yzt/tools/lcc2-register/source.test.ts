// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolError } from './errors.ts';
import { register } from './register.ts';
import { readModel, type SourceOptions } from './source.ts';
import { CORRIDOR_WALK, CORRIDORS, meshPly } from './test-meshes.ts';

const NAME = '楚王山1号';
const ENCODED = '%E6%A5%9A%E7%8E%8B%E5%B1%B11%E5%8F%B7';
// 服务器上的层级：<市>/lcc2/<交付的目录>/lcc2-sog-result/（docs/config/3dt-manifest.md）
const MODEL_DIRECTORY = `xuzhou/lcc2/${NAME}`;
const RELATIVE = `${MODEL_DIRECTORY}/lcc2-sog-result/${NAME}.lcc2`;
const PROXY = 'http://models.test:8088';
const INDEX_PATH = `/3dt/xuzhou/lcc2/${ENCODED}/lcc2-sog-result/${ENCODED}.lcc2`;
const DIRECTORY = `/3dt/xuzhou/lcc2/${ENCODED}/lcc2-sog-result`;

const INDEX = { epsg: 4548, offset: [1, 2, 3], root: { meshFiles: ['data/mesh/0.ply', 'data/mesh/1.ply'] } };
const POSES = { poses: [{ T: [1, 2, 3] }], fusionPoses: null };
// 不是合法的 UTF-8：按文本读会被改掉
const MESH_0 = new Uint8Array([0x70, 0xff, 0x80, 0x00]);
const MESH_1 = new Uint8Array([0x70, 0x00, 0xfe, 0xc0]);

// 键是请求的路径（编码后的原样）
type Responder = () => Response | Promise<Response>;
const binary = (bytes: Uint8Array) => () =>
  new HttpResponse(bytes, { headers: { 'Content-Type': 'application/octet-stream' } });
const notFound: Responder = () => HttpResponse.html('<html>404</html>', { status: 404 });
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
      return responder ? responder() : notFound();
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
  writeLocal(localRoot, `${MODEL_DIRECTORY}/lcc2-sog-result/info/poses.json`, JSON.stringify(POSES));
  writeLocal(localRoot, `${MODEL_DIRECTORY}/lcc2-sog-result/data/mesh/0.ply`, MESH_0);
  writeLocal(localRoot, `${MODEL_DIRECTORY}/lcc2-sog-result/data/mesh/1.ply`, MESH_1);
}

async function meshesOf(model: Awaited<ReturnType<typeof readModel>>) {
  const meshes: { name: string; bytes: number[] }[] = [];
  for await (const { name, bytes } of model.meshes) {
    meshes.push({ name, bytes: Array.from(bytes) });
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
  { name: 'data/mesh/0.ply', bytes: Array.from(MESH_0) },
  { name: 'data/mesh/1.ply', bytes: Array.from(MESH_1) }
];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  localRoot = mkdtempSync(join(tmpdir(), 'lcc2-source-'));
  requests.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
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

  it('相对路径用反斜杠：地址一样', async () => {
    serve();
    await readModel(RELATIVE.replaceAll('/', '\\'), options({ proxy: PROXY }));
    expect(requests[0]).toBe(INDEX_PATH);
  });

  it.each(['/yzt', '/yzt/', '/yzt?x=1', '/yzt#a'])('代理的地址带路径 %s：路径留着，再接 3dt', async (suffix) => {
    serve({ [`/yzt${INDEX_PATH}`]: indexResponse, [`/yzt${DIRECTORY}/info/poses.json`]: posesResponse });
    await readModel(RELATIVE, options({ proxy: `${PROXY}${suffix}` }));
    expect(requests[0]).toBe(`/yzt${INDEX_PATH}`);
  });

  it('索引里的文件名也按段编码：# 和反斜杠不改变请求的地址', async () => {
    const index = { ...INDEX, root: { meshFiles: ['data\\mesh\\a#1.ply'] } };
    serve({
      [INDEX_PATH]: () => HttpResponse.text(JSON.stringify(index)),
      [`${DIRECTORY}/data/mesh/a%231.ply`]: binary(MESH_0)
    });
    await meshesOf(await readModel(RELATIVE, options({ proxy: PROXY })));
    expect(requests.at(-1)).toBe(`${DIRECTORY}/data/mesh/a%231.ply`);
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

  it('二进制的网格经 HTTP 读出来能解析、配准', async () => {
    const index = {
      epsg: 4548,
      offset: [505745.46, 3793605.53, 59.74],
      root: { meshFiles: CORRIDORS.map((_, i) => `data/mesh/${i}.ply`) }
    };
    serve({
      [INDEX_PATH]: () => HttpResponse.text(JSON.stringify(index)),
      [`${DIRECTORY}/info/poses.json`]: () =>
        HttpResponse.json({ poses: CORRIDOR_WALK.map((T) => ({ T })), fusionPoses: null }),
      ...Object.fromEntries(CORRIDORS.map((mesh, i) => [`${DIRECTORY}/data/mesh/${i}.ply`, binary(meshPly(mesh))]))
    });
    const model = await readModel(RELATIVE, options({ proxy: PROXY }));
    const result = await register(model, { shift: [0, 0, 0], yaw: 0, datum: 0, fit: true });
    expect(result.meshCount).toBe(CORRIDORS.length);
    expect(result.failed).toBe(false);
  });

  it('索引带 BOM 也能读', async () => {
    serve({ [INDEX_PATH]: () => HttpResponse.text(`\uFEFF${JSON.stringify(INDEX)}`) });
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

  it('给的是目录：说要给索引文件', async () => {
    writeLocalModel();
    expect(await failureOf(MODEL_DIRECTORY)).toContain('要给 .lcc2 索引文件');
  });

  it('索引以外的文件是目录：只说是目录，不让人去改索引的路径', async () => {
    writeLocalModel();
    const poses = join(localRoot, `${MODEL_DIRECTORY}/lcc2-sog-result/info/poses.json`);
    rmSync(poses);
    mkdirSync(poses);
    const message = await failureOf(RELATIVE);
    expect(message).toContain('这是目录');
    expect(message).not.toContain('要给 .lcc2 索引文件');
  });

  it('本机缺碰撞网格：读网格之前就说缺几个、第一个是哪个', async () => {
    writeLocalModel();
    rmSync(join(localRoot, `${MODEL_DIRECTORY}/lcc2-sog-result/data/mesh/0.ply`));
    rmSync(join(localRoot, `${MODEL_DIRECTORY}/lcc2-sog-result/data/mesh/1.ply`));
    const reading = readModel(RELATIVE, options());
    await expect(reading).rejects.toThrow('找不到 2 个');
    await expect(reading).rejects.toThrow(join(localRoot, `${MODEL_DIRECTORY}/lcc2-sog-result/data/mesh/0.ply`));
  });

  it('索引 404：说地址、状态和代理，不说回退到页面', async () => {
    serve({ [INDEX_PATH]: notFound });
    const message = await failureOf(RELATIVE, { proxy: PROXY });
    expect(message).toContain(`${PROXY}/3dt/${RELATIVE}`);
    expect(message).toContain('HTTP 404');
    expect(message).toContain(`YZT_3DT_PROXY 是 ${PROXY}`);
    expect(message).not.toContain('回退');
  });

  it('碰撞网格 404：说是哪个文件', async () => {
    serve({ [`${DIRECTORY}/data/mesh/1.ply`]: notFound });
    const message = await failureOf(RELATIVE, { proxy: PROXY });
    expect(message).toContain('data/mesh/1.ply');
    expect(message).toContain('HTTP 404');
  });

  it('相对路径写成了编码后的样子：% 按原文编码，报错显示真正请求的地址', async () => {
    serve();
    const message = await failureOf(`${ENCODED}/x.lcc2`, { proxy: PROXY });
    const requested = `/3dt/${ENCODED.replaceAll('%', '%25')}/x.lcc2`;
    expect(requests).toEqual([requested]);
    expect(message).toContain(requested);
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

  it('索引不是 JSON：说不是合法的 JSON，响应里的换行不进报错', async () => {
    serve({ [INDEX_PATH]: () => HttpResponse.text('garbage\nmore\n') });
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

  it('连不上：说地址，没有更具体的原因时用 fetch 的说法', async () => {
    serve({ [INDEX_PATH]: () => HttpResponse.error() });
    const message = await failureOf(RELATIVE, { proxy: PROXY });
    expect(message).toContain(`${PROXY}/3dt/${RELATIVE}`);
    expect(message).toContain('Failed to fetch');
  });

  it('连不上：说 cause 里真正的原因', async () => {
    const cause = new Error('connect ECONNREFUSED 192.0.2.1:5173');
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed', { cause }));
    const message = await failureOf(RELATIVE, { proxy: PROXY });
    expect(message).toContain('ECONNREFUSED');
    expect(message).not.toContain('fetch failed');
  });

  it('主机名有几个地址都连不上：原因在 AggregateError 的第一项里', async () => {
    const cause = new AggregateError([new Error('connect ECONNREFUSED ::1:5173')], '');
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed', { cause }));
    expect(await failureOf(RELATIVE, { proxy: PROXY })).toContain('ECONNREFUSED ::1:5173');
  });

  it('YZT_3DT_PROXY 不是 http 地址：说变量名', async () => {
    expect(await failureOf(RELATIVE, { proxy: 'models.test:8088' })).toContain('YZT_3DT_PROXY');
  });

  it('索引没有碰撞网格：说原因', async () => {
    serve({ [INDEX_PATH]: () => HttpResponse.text(JSON.stringify({ ...INDEX, root: { meshFiles: [] } })) });
    expect(await failureOf(RELATIVE, { proxy: PROXY })).toContain('root.meshFiles 是空的');
  });
});
