// 只供测试使用：监听共用的 GL 上下文（ADR 0149 第 2 节，做法同 PoC 的 gl-watch.js）。
// 每次调用后读 GL 错误；渲染回调外来自泼溅库的调用单独计数，说明保护确实有东西要守

const WATCHED = [
  'activeTexture',
  'bindBuffer',
  'bindFramebuffer',
  'bindTexture',
  'bindVertexArray',
  'blendFunc',
  'blendFuncSeparate',
  'bufferData',
  'bufferSubData',
  'disable',
  'drawArrays',
  'drawArraysInstanced',
  'drawElements',
  'drawElementsInstanced',
  'enable',
  'fenceSync',
  'getBufferSubData',
  'pixelStorei',
  'readPixels',
  'texImage2D',
  'texImage3D',
  'texStorage2D',
  'texStorage3D',
  'texSubImage2D',
  'texSubImage3D',
  'useProgram',
  'viewport'
] as const;

export interface GlError {
  readonly name: string;
  readonly error: number;
  /** 发生在渲染回调里 */
  readonly inside: boolean;
}

export interface GlWatch extends Disposable {
  /** 每次调用后读到的 GL 错误 */
  readonly errors: readonly GlError[];
  /** 渲染回调外、调用栈里有 gaussian-splat-lite 的调用次数 */
  readonly libraryOutside: number;
}

type GlMethod = (...args: unknown[]) => unknown;

/** 替换 gl 上的一组方法；inside 说明现在是否在渲染回调里。释放时换回原来的方法 */
export function watchGl(gl: WebGL2RenderingContext, inside: () => boolean): GlWatch {
  const errors: GlError[] = [];
  let libraryOutside = 0;
  const target = gl as unknown as Record<string, GlMethod>;
  const originals = new Map<string, GlMethod>();
  for (const name of WATCHED) {
    const original = target[name];
    if (typeof original !== 'function') {
      continue;
    }
    originals.set(name, original);
    target[name] = (...args: unknown[]) => {
      const rendering = inside();
      if (!rendering && /gaussian-splat-lite/.test(new Error('调用栈').stack ?? '')) {
        libraryOutside++;
      }
      const result = original.apply(gl, args);
      const error = gl.getError();
      if (error !== gl.NO_ERROR && error !== gl.CONTEXT_LOST_WEBGL) {
        errors.push({ name, error, inside: rendering });
      }
      return result;
    };
  }
  return {
    errors,
    get libraryOutside() {
      return libraryOutside;
    },
    [Symbol.dispose]() {
      for (const [name, original] of originals) {
        target[name] = original;
      }
    }
  };
}
