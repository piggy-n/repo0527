// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { watchGl } from './gl-watch';

const NO_ERROR = 0;
const CONTEXT_LOST_WEBGL = 0x9242;
const INVALID_OPERATION = 0x502;

const bindTexture = () => 'bound';
const drawArrays = () => undefined;

// 假的上下文：getError 依次取排好的错误
function fakeGl() {
  const queue: number[] = [];
  const gl = { NO_ERROR, CONTEXT_LOST_WEBGL, getError: () => queue.shift() ?? NO_ERROR, bindTexture, drawArrays };
  return { gl: gl as unknown as WebGL2RenderingContext, queue };
}

// 比较方法本身，不调用
const method = (gl: WebGL2RenderingContext, name: 'bindTexture' | 'drawArrays') => Reflect.get(gl, name) as unknown;

// 栈帧里的名字：监听靠调用栈里的 gaussian-splat-lite 认库的调用
const library = {
  'gaussian-splat-lite': (gl: WebGL2RenderingContext) => {
    gl.bindTexture(0, null);
  }
};

describe('watchGl', () => {
  it('调用照常进行，没有错误时什么都不记', () => {
    const { gl } = fakeGl();
    using watch = watchGl(gl, () => false);
    expect(gl.bindTexture(0, null)).toBe('bound');
    expect(watch.errors).toEqual([]);
    expect(watch.errorCount).toBe(0);
  });

  it('错误记下方法和是否在渲染回调里', () => {
    const { gl, queue } = fakeGl();
    let rendering = false;
    using watch = watchGl(gl, () => rendering);
    queue.push(INVALID_OPERATION);
    gl.bindTexture(0, null);
    rendering = true;
    queue.push(INVALID_OPERATION);
    gl.drawArrays(0, 0, 3);
    expect(watch.errors).toEqual([
      { name: 'bindTexture', error: INVALID_OPERATION, inside: false },
      { name: 'drawArrays', error: INVALID_OPERATION, inside: true }
    ]);
  });

  it('错误最多记 100 条，总数照常数', () => {
    const { gl, queue } = fakeGl();
    using watch = watchGl(gl, () => false);
    for (let index = 0; index < 150; index++) {
      queue.push(INVALID_OPERATION);
      gl.bindTexture(0, null);
    }
    expect(watch.errors).toHaveLength(100);
    expect(watch.errorCount).toBe(150);
  });

  it('上下文丢失不算错误', () => {
    const { gl, queue } = fakeGl();
    using watch = watchGl(gl, () => false);
    queue.push(CONTEXT_LOST_WEBGL);
    gl.bindTexture(0, null);
    expect(watch.errorCount).toBe(0);
    expect(watch.errors).toEqual([]);
  });

  it('只数渲染回调外、调用栈里有库的调用，按方法分', () => {
    const { gl } = fakeGl();
    let rendering = false;
    using watch = watchGl(gl, () => rendering);
    gl.bindTexture(0, null);
    expect(watch.libraryOutside).toBe(0);
    library['gaussian-splat-lite'](gl);
    expect(watch.libraryOutside).toBe(1);
    rendering = true;
    library['gaussian-splat-lite'](gl);
    expect(watch.libraryOutside).toBe(1);
    expect(watch.libraryOutsideByMethod).toEqual({ bindTexture: 1 });
  });

  it('释放后换回原来的方法', () => {
    const { gl } = fakeGl();
    const watch = watchGl(gl, () => false);
    expect(method(gl, 'bindTexture')).not.toBe(bindTexture);
    watch[Symbol.dispose]();
    expect(method(gl, 'bindTexture')).toBe(bindTexture);
    expect(method(gl, 'drawArrays')).toBe(drawArrays);
  });
});
