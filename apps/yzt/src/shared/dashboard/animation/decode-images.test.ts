// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeImages } from './decode-images';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('decodeImages', () => {
  // 解码失败没被接住时 Vitest 会报未处理的拒绝，整轮失败
  it('每个地址各解码一次，解码失败不抛出', async () => {
    const decoded: string[] = [];
    vi.stubGlobal('Image', class {
      src = '';

      decode(): Promise<void> {
        decoded.push(this.src);
        return this.src.includes('broken') ? Promise.reject(new Error('无法解码')) : Promise.resolve();
      }
    });
    const decoding = decodeImages(['/assets/bg.webp', '/assets/broken.webp']);
    await new Promise(resolve => setTimeout(resolve, 0));
    decoding[Symbol.dispose]();
    expect(decoded).toEqual(['/assets/bg.webp', '/assets/broken.webp']);
  });
});
