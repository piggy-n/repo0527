// @vitest-environment node
import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D, Texture, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { TileUploader } from './tile-uploader';

const texture = (size: number) => {
  const item = new Texture({ width: size, height: size });
  item.generateMipmaps = false;
  return item;
};

// 一块瓦片：一个网格，每张贴图放一个材质属性
function tile(...maps: Texture[]) {
  const scene = new Object3D();
  const material = new MeshBasicMaterial();
  const [map, alphaMap] = maps;
  material.map = map ?? null;
  material.alphaMap = alphaMap ?? null;
  scene.add(new Mesh(new BoxGeometry(), material));
  return scene;
}

function fakeRenderer() {
  return {
    initTexture: vi.fn<(texture: Texture) => void>(),
    // 走到上传时绘制范围是 0；舞台上放着瓦片
    render: vi.fn<() => void>()
  };
}

const asRenderer = (fake: ReturnType<typeof fakeRenderer>) => fake as unknown as WebGLRenderer;

// 只经过微任务：结束了的 Promise 这时一定结束了
const settled = (promise: Promise<void>) =>
  Promise.race([promise.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 0))]);

describe('TileUploader', () => {
  it('按预算分帧：花完预算停下，下一帧接着传，传完才结束', async () => {
    const requestFrame = vi.fn<() => void>();
    const uploader = new TileUploader(100 * 100 * 4, requestFrame);
    uploader.setActive(true);
    const first = texture(100);
    const second = texture(100);
    const done = uploader.enqueue(tile(first, second), new AbortController().signal);
    expect(requestFrame).toHaveBeenCalledTimes(1);
    const webgl = fakeRenderer();

    uploader.run(asRenderer(webgl));
    expect(webgl.initTexture).toHaveBeenCalledTimes(1);
    expect(webgl.initTexture).toHaveBeenLastCalledWith(first);
    expect(await settled(done)).toBe(false);
    expect(uploader.pending).toBe(1);
    expect(requestFrame).toHaveBeenCalledTimes(2);

    uploader.run(asRenderer(webgl));
    expect(webgl.initTexture).toHaveBeenCalledTimes(2);
    expect(webgl.initTexture).toHaveBeenLastCalledWith(second);
    expect(webgl.render).not.toHaveBeenCalled();

    uploader.run(asRenderer(webgl));
    expect(webgl.render).toHaveBeenCalledTimes(1);
    expect(await settled(done)).toBe(true);
    expect(uploader.pending).toBe(0);
    expect(uploader.uploadedBytes).toBeGreaterThan(2 * 100 * 100 * 4);
  });

  it('一张超过预算的贴图也能走：一帧至少走一步', () => {
    const uploader = new TileUploader(1, vi.fn<() => void>());
    uploader.setActive(true);
    void uploader.enqueue(tile(texture(2048)), new AbortController().signal);
    const webgl = fakeRenderer();
    uploader.run(asRenderer(webgl));
    expect(webgl.initTexture).toHaveBeenCalledTimes(1);
    expect(webgl.render).not.toHaveBeenCalled();
  });

  it('上传几何体时绘制范围是 0，画完恢复；瓦片不留在舞台上', () => {
    const uploader = new TileUploader(1024 * 1024, vi.fn<() => void>());
    uploader.setActive(true);
    const scene = tile();
    const { geometry } = scene.children[0] as Mesh;
    geometry.setDrawRange(3, 9);
    let during: { start: number; count: number } | null = null;
    let parentDuring: Object3D | null = null;
    const webgl = fakeRenderer();
    webgl.render.mockImplementation(() => {
      during = { ...geometry.drawRange };
      parentDuring = scene.parent;
    });
    void uploader.enqueue(scene, new AbortController().signal);
    uploader.run(asRenderer(webgl));
    expect(during).toEqual({ start: 0, count: 0 });
    expect(parentDuring).not.toBeNull();
    expect(geometry.drawRange).toMatchObject({ start: 3, count: 9 });
    expect(scene.parent).toBeNull();
  });

  it('同一张贴图用在几个网格上只传一次', () => {
    const uploader = new TileUploader(1024 * 1024 * 1024, vi.fn<() => void>());
    uploader.setActive(true);
    const shared = texture(4);
    const scene = tile(shared);
    scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial({ map: shared })));
    void uploader.enqueue(scene, new AbortController().signal);
    const webgl = fakeRenderer();
    uploader.run(asRenderer(webgl));
    expect(webgl.initTexture).toHaveBeenCalledTimes(1);
  });

  it('中止的瓦片离开队列、马上结束，不再上传', async () => {
    const uploader = new TileUploader(1, vi.fn<() => void>());
    uploader.setActive(true);
    const controller = new AbortController();
    const done = uploader.enqueue(tile(texture(4)), controller.signal);
    controller.abort();
    expect(await settled(done)).toBe(true);
    expect(uploader.pending).toBe(0);
    const webgl = fakeRenderer();
    uploader.run(asRenderer(webgl));
    expect(webgl.initTexture).not.toHaveBeenCalled();
  });

  it('不能上传时不排队；已经排着的直接放行，不会卡住加载', async () => {
    const uploader = new TileUploader(1, vi.fn<() => void>());
    expect(await settled(uploader.enqueue(tile(texture(4)), new AbortController().signal))).toBe(true);
    expect(uploader.pending).toBe(0);
    uploader.setActive(true);
    const waiting = uploader.enqueue(tile(texture(4)), new AbortController().signal);
    expect(await settled(waiting)).toBe(false);
    uploader.setActive(false);
    expect(await settled(waiting)).toBe(true);
    expect(uploader.pending).toBe(0);
  });

  it('预算是 null 时不排队，第一次绘制时才上传', async () => {
    const uploader = new TileUploader(null, vi.fn<() => void>());
    uploader.setActive(true);
    expect(await settled(uploader.enqueue(tile(texture(4)), new AbortController().signal))).toBe(true);
    const webgl = fakeRenderer();
    uploader.run(asRenderer(webgl));
    expect(webgl.initTexture).not.toHaveBeenCalled();
  });

  it('释放时放行排着的瓦片', async () => {
    const uploader = new TileUploader(1, vi.fn<() => void>());
    uploader.setActive(true);
    const waiting = uploader.enqueue(tile(texture(4)), new AbortController().signal);
    uploader[Symbol.dispose]();
    expect(await settled(waiting)).toBe(true);
  });
});
