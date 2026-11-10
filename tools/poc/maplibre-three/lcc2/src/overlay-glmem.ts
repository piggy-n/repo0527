// 记一个 WebGL2 上下文里引擎申请了多少字节：纹理、缓冲、渲染缓冲分开记。
// 这是按申请的尺寸算的，不是驱动实际占的显存，但两个上下文可以分开看，软件渲染下也读得到。
// 包了 bindTexture 这类高频调用，只在 ?glmem=1 时装，量帧时间时不要开

const BYTES_PER_PIXEL: Readonly<Record<number, number>> = {
  // 不带尺寸的格式（WebGL1 的写法）
  0x1906: 1, // ALPHA
  0x1907: 4, // RGB，显卡上按 4 字节对齐
  0x1908: 4, // RGBA
  0x1909: 1, // LUMINANCE
  0x190a: 2, // LUMINANCE_ALPHA
  0x1902: 4, // DEPTH_COMPONENT
  0x84f9: 4, // DEPTH_STENCIL
  // 8 位
  0x8229: 1, // R8
  0x822b: 2, // RG8
  0x8051: 4, // RGB8
  0x8058: 4, // RGBA8
  0x8c41: 4, // SRGB8
  0x8c43: 4, // SRGB8_ALPHA8
  0x8d7c: 4, // RGBA8UI
  0x8232: 1, // R8UI
  // 16 位
  0x822d: 2, // R16F
  0x822f: 4, // RG16F
  0x881b: 8, // RGB16F
  0x881a: 8, // RGBA16F
  0x8234: 2, // R16UI
  0x823a: 4, // RG16UI
  0x8d76: 8, // RGBA16UI
  // 32 位
  0x822e: 4, // R32F
  0x8230: 8, // RG32F
  0x8815: 16, // RGB32F
  0x8814: 16, // RGBA32F
  0x8236: 4, // R32UI
  0x823c: 8, // RG32UI
  0x8d70: 16, // RGBA32UI
  0x8235: 4, // R32I
  // 打包格式
  0x8c3a: 4, // R11F_G11F_B10F
  0x8059: 4, // RGB10_A2
  0x8d62: 2, // RGB565
  0x8056: 2, // RGBA4
  0x8057: 2, // RGB5_A1
  // 深度、模板
  0x81a5: 2, // DEPTH_COMPONENT16
  0x81a6: 4, // DEPTH_COMPONENT24
  0x8cac: 4, // DEPTH_COMPONENT32F
  0x88f0: 4, // DEPTH24_STENCIL8
  0x8cad: 8, // DEPTH32F_STENCIL8
  0x8d48: 1 // STENCIL_INDEX8
};

const TEXTURE_CUBE_MAP = 0x8513;
const CUBE_FACE_FIRST = 0x8515;
const CUBE_FACE_LAST = 0x851a;

interface Entry {
  /** 每一级（立方体贴图再分面）各占多少 */
  readonly parts: Map<string, number>;
  mipmapped: boolean;
}

export interface GlMemoryReport {
  readonly textures: { readonly count: number; readonly mb: number };
  readonly buffers: { readonly count: number; readonly mb: number };
  readonly renderbuffers: { readonly count: number; readonly mb: number };
  /** 画布自己的绘图缓冲：前后两块颜色加一块深度模板，按 4 字节一个像素估 */
  readonly drawingBufferMb: number;
  readonly totalMb: number;
  /** 表里没有的格式，按 4 字节一个像素算了 */
  readonly unknownFormats: readonly number[];
}

type AnyFunction = (...args: never[]) => unknown;

export function trackGlMemory(gl: WebGL2RenderingContext): () => GlMemoryReport {
  const textures = new Map<WebGLTexture, Entry>();
  const buffers = new Map<WebGLBuffer, number>();
  const renderbuffers = new Map<WebGLRenderbuffer, number>();
  const boundTextures = new Map<string, WebGLTexture | null>();
  const boundBuffers = new Map<number, WebGLBuffer | null>();
  const unknown = new Set<number>();
  let unit: number = gl.TEXTURE0;
  let renderbuffer: WebGLRenderbuffer | null = null;

  const bpp = (format: number): number => {
    const bytes = BYTES_PER_PIXEL[format];
    if (bytes === undefined) {
      unknown.add(format);
      return 4;
    }
    return bytes;
  };
  const bindingTarget = (target: number) => (target >= CUBE_FACE_FIRST && target <= CUBE_FACE_LAST ? TEXTURE_CUBE_MAP : target);
  const current = (target: number): Entry | null => {
    const texture = boundTextures.get(`${unit}:${bindingTarget(target)}`);
    if (!texture) {
      return null;
    }
    let entry = textures.get(texture);
    if (!entry) {
      entry = { parts: new Map(), mipmapped: false };
      textures.set(texture, entry);
    }
    return entry;
  };
  const wrap = (name: string, before: (args: unknown[]) => void): void => {
    const target = gl as unknown as Record<string, AnyFunction>;
    const original = target[name];
    target[name] = function wrapped(...args: never[]) {
      before(args as unknown[]);
      return original.apply(gl, args);
    } as AnyFunction;
  };
  const sourceSize = (source: unknown): [number, number] => {
    const item = source as { width?: number; height?: number; videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number };
    return [item.videoWidth ?? item.naturalWidth ?? item.width ?? 0, item.videoHeight ?? item.naturalHeight ?? item.height ?? 0];
  };

  wrap('activeTexture', ([value]) => {
    unit = value as number;
  });
  wrap('bindTexture', ([target, texture]) => {
    boundTextures.set(`${unit}:${target as number}`, texture as WebGLTexture | null);
  });
  wrap('deleteTexture', ([texture]) => {
    textures.delete(texture as WebGLTexture);
  });
  wrap('texStorage2D', ([target, levels, format, width, height]) => {
    const entry = current(target as number);
    if (entry) {
      const faces = target === TEXTURE_CUBE_MAP ? 6 : 1;
      for (let level = 0; level < (levels as number); level += 1) {
        entry.parts.set(`s${level}`, Math.max(1, (width as number) >> level) * Math.max(1, (height as number) >> level) * bpp(format as number) * faces);
      }
    }
  });
  wrap('texStorage3D', ([target, levels, format, width, height, depth]) => {
    const entry = current(target as number);
    if (entry) {
      for (let level = 0; level < (levels as number); level += 1) {
        // 数组纹理每一级的层数不变，三维纹理会减半；这里按不变算，偏大
        entry.parts.set(`s${level}`, Math.max(1, (width as number) >> level) * Math.max(1, (height as number) >> level) * (depth as number) * bpp(format as number));
      }
    }
  });
  wrap('texImage2D', args => {
    const [target, level, format] = args as number[];
    const entry = current(target);
    if (entry) {
      const [width, height] = args.length >= 9 ? [args[3] as number, args[4] as number] : sourceSize(args[5]);
      entry.parts.set(`${target}:${level}`, width * height * bpp(format));
    }
  });
  wrap('copyTexImage2D', args => {
    const [target, level, format, , , width, height] = args as number[];
    current(target)?.parts.set(`${target}:${level}`, width * height * bpp(format));
  });
  wrap('texImage3D', args => {
    const [target, level, format, width, height, depth] = args as number[];
    current(target)?.parts.set(`${target}:${level}`, width * height * depth * bpp(format));
  });
  const compressed = (args: unknown[], dataIndex: number): void => {
    const [target, level] = args as number[];
    const data = args[dataIndex];
    const bytes = typeof data === 'number' ? data : ((data as ArrayBufferView | null)?.byteLength ?? 0);
    current(target)?.parts.set(`${target}:${level}`, bytes);
  };
  wrap('compressedTexImage2D', args => compressed(args, 6));
  wrap('compressedTexImage3D', args => compressed(args, 7));
  wrap('generateMipmap', ([target]) => {
    const entry = current(target as number);
    if (entry) {
      entry.mipmapped = true;
    }
  });

  wrap('bindBuffer', ([target, buffer]) => {
    boundBuffers.set(target as number, buffer as WebGLBuffer | null);
  });
  wrap('deleteBuffer', ([buffer]) => {
    buffers.delete(buffer as WebGLBuffer);
  });
  wrap('bufferData', args => {
    const buffer = boundBuffers.get(args[0] as number);
    if (!buffer) {
      return;
    }
    const data = args[1];
    let bytes = 0;
    if (typeof data === 'number') {
      bytes = data;
    } else if (data) {
      const view = data as ArrayBufferView & { BYTES_PER_ELEMENT?: number };
      const elementSize = view.BYTES_PER_ELEMENT ?? 1;
      // (target, data, usage, srcOffset, length)：只传一段
      bytes = args.length >= 5 && (args[4] as number) > 0 ? (args[4] as number) * elementSize : view.byteLength - (args.length >= 4 ? (args[3] as number) * elementSize : 0);
    }
    buffers.set(buffer, bytes);
  });

  wrap('bindRenderbuffer', ([, value]) => {
    renderbuffer = value as WebGLRenderbuffer | null;
  });
  wrap('deleteRenderbuffer', ([value]) => {
    renderbuffers.delete(value as WebGLRenderbuffer);
  });
  wrap('renderbufferStorage', ([, format, width, height]) => {
    if (renderbuffer) {
      renderbuffers.set(renderbuffer, (width as number) * (height as number) * bpp(format as number));
    }
  });
  wrap('renderbufferStorageMultisample', ([, samples, format, width, height]) => {
    if (renderbuffer) {
      renderbuffers.set(renderbuffer, (width as number) * (height as number) * bpp(format as number) * Math.max(1, samples as number));
    }
  });

  const mb = (bytes: number) => Number((bytes / 1048576).toFixed(1));
  return () => {
    let textureBytes = 0;
    for (const entry of textures.values()) {
      let bytes = 0;
      for (const part of entry.parts.values()) {
        bytes += part;
      }
      textureBytes += entry.mipmapped ? (bytes * 4) / 3 : bytes;
    }
    const sum = (map: Map<unknown, number>) => [...map.values()].reduce((total, value) => total + value, 0);
    const bufferBytes = sum(buffers);
    const renderbufferBytes = sum(renderbuffers);
    const drawing = gl.drawingBufferWidth * gl.drawingBufferHeight * 4 * 3;
    return {
      textures: { count: textures.size, mb: mb(textureBytes) },
      buffers: { count: buffers.size, mb: mb(bufferBytes) },
      renderbuffers: { count: renderbuffers.size, mb: mb(renderbufferBytes) },
      drawingBufferMb: mb(drawing),
      totalMb: mb(textureBytes + bufferBytes + renderbufferBytes + drawing),
      unknownFormats: [...unknown]
    };
  };
}
