/**
 * 提前解码入场中途才第一次显示的大图：显示时才解码要几十毫秒，那几帧的入场动画会停住。
 * 解码结果留在浏览器的缓存里，CSS 背景用到同一地址时直接取用；释放后不再持有图片
 */
export function decodeImages(sources: readonly string[]): Disposable {
  const images = sources.map(source => {
    const image = new Image();
    image.src = source;
    // 解码失败时浏览器显示前仍会自己解码，这里不用处理
    image.decode().catch(() => undefined);
    return image;
  });
  return {
    [Symbol.dispose]: () => {
      images.length = 0;
    }
  };
}
