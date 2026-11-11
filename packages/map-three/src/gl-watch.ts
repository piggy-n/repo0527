// 诊断用：监听共用的 GL 上下文，给测试和开发页 /dev/splat-watch（ADR 0149 第 2 节）。
// 每次调用都读错误会让 GPU 同步：开着时帧时间不算数，读数的含义见 docs/modules/map-three.md 的"GL 监听"

// 错误最多记这么多条，之后只计数：驱动出问题时每帧都可能报错
const MAX_ERRORS = 100;

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
  /** 每次调用后读到的 GL 错误，最多前 100 条；没监听的方法出的错记在下一次监听到的调用上 */
  readonly errors: readonly GlError[];
  /** GL 错误的总数（含没记下的） */
  readonly errorCount: number;
  /** 渲染回调外、调用栈里有 gaussian-splat-lite 的调用次数：只数 WATCHED 的方法，调用栈只看得到 10 帧，是下限 */
  readonly libraryOutside: number;
  /** 同上，按方法分 */
  readonly libraryOutsideByMethod: Readonly<Record<string, number>>;
}

type GlMethod = (...args: unknown[]) => unknown;

/** 替换 gl 上的一组方法；inside 说明现在是否在渲染回调里。释放时换回原来的方法 */
export function watchGl(gl: WebGL2RenderingContext, inside: () => boolean): GlWatch {
  const errors: GlError[] = [];
  let errorCount = 0;
  let libraryOutside = 0;
  const byMethod: Record<string, number> = {};
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
        byMethod[name] = (byMethod[name] ?? 0) + 1;
      }
      const result = original.apply(gl, args);
      const error = gl.getError();
      if (error !== gl.NO_ERROR && error !== gl.CONTEXT_LOST_WEBGL) {
        errorCount++;
        if (errors.length < MAX_ERRORS) {
          errors.push({ name, error, inside: rendering });
        }
      }
      return result;
    };
  }
  return {
    errors,
    get errorCount() {
      return errorCount;
    },
    get libraryOutside() {
      return libraryOutside;
    },
    get libraryOutsideByMethod() {
      return { ...byMethod };
    },
    [Symbol.dispose]() {
      for (const [name, original] of originals) {
        target[name] = original;
      }
    }
  };
}
