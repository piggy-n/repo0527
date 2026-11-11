// @vitest-environment node
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolError } from './errors.ts';
import { readModel } from './source.ts';

// 响应体读到一半的情况用真的 HTTP 服务器：MSW 里响应体挂起时，中止信号到不了 fetch

const INDEX = { epsg: 4548, offset: [1, 2, 3], root: { meshFiles: ['m.ply'] } };
const POSES = { poses: [{ T: [1, 2, 3] }], fusionPoses: null };
const HALF_BODY = { 'Content-Type': 'application/octet-stream', 'Content-Length': '1000' };

let server: Server | undefined;

// 路径以 suffix 结尾的请求交给 send，其余的正常返回
async function serve(suffix: string, send: (response: ServerResponse) => void): Promise<string> {
  const created = createServer((request, response) => {
    const url = request.url ?? '';
    if (url.endsWith(suffix)) {
      send(response);
    } else {
      response.end(JSON.stringify(url.endsWith('.lcc2') ? INDEX : POSES));
    }
  });
  server = created;
  await new Promise<void>((resolve) => {
    created.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${(created.address() as AddressInfo).port}`;
}

async function readMesh(proxy: string, timeout: number) {
  const model = await readModel('a/a.lcc2', { localRoot: '', proxy, timeout });
  await model.meshes[Symbol.asyncIterator]().next();
}

afterEach(() => {
  server?.closeAllConnections();
  server?.close();
  server = undefined;
});

describe('readModel：响应体读到一半', () => {
  it('发了响应头和一部分就不再发：按超时报错，说是哪个文件', async () => {
    // 挂在第一个请求上：超时是每个请求单独算的，前面没有别的请求，机器忙时也不会超时在别的文件上
    const proxy = await serve('.lcc2', (response) => {
      response.writeHead(200, HALF_BODY);
      response.write('{');
    });
    // 不超时的话一直挂着：和比超时长得多的定时器赛跑，失败在断言上
    const never = new Promise<string>((resolve) => {
      setTimeout(() => resolve('没有超时'), 3000);
    });
    const failure = readMesh(proxy, 300).then(
      () => '读完了',
      (error: unknown) => error
    );
    const error = await Promise.race([failure, never]);
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).message).toContain('a.lcc2');
    expect((error as ToolError).message).toContain('0.3 秒内没有读完');
  });

  it('连接中途断开：一行原因，说是哪个文件', async () => {
    const proxy = await serve('m.ply', (response) => {
      response.writeHead(200, HALF_BODY);
      response.write('ply', () => response.destroy());
    });
    const reading = readMesh(proxy, 3000);
    await expect(reading).rejects.toThrow(ToolError);
    await expect(reading).rejects.toThrow('m.ply');
  });
});
