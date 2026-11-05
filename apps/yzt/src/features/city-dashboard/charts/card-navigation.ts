// 停顿这么久（毫秒）或反向输入时开始新的手势；累计位移不到这么多像素时不翻页
const GESTURE_PAUSE = 200;
const GESTURE_DISTANCE = 18;

/** 一串滚轮惯性只消费一步；200ms 停顿或反向输入开始新手势 */
export class CardWheelGesture {
  private lastTime = -Infinity;
  private direction = 0;
  private distance = 0;
  private consumed = false;

  reset(): void {
    this.lastTime = -Infinity;
    this.direction = 0;
    this.distance = 0;
    this.consumed = false;
  }

  consume(delta: number, now: number): number {
    if (!Number.isFinite(delta) || !delta) {
      return 0;
    }
    const direction = Math.sign(delta);
    if (now - this.lastTime >= GESTURE_PAUSE || direction !== this.direction) {
      this.reset();
    }
    this.lastTime = now;
    this.direction = direction;
    this.distance += Math.abs(delta);
    if (this.consumed || this.distance < GESTURE_DISTANCE) {
      return 0;
    }
    this.consumed = true;
    return direction;
  }
}

/** 真实末尾只保留一个停靠点，避免反向翻页仍停在同一位置 */
export function cardStops(tops: readonly number[], maximum: number): number[] {
  return tops.reduce<number[]>((stops, top) => {
    const position = Math.max(0, Math.min(top, maximum));
    if (!stops.length || position - stops[stops.length - 1] > 1) {
      stops.push(position);
    } else {
      stops[stops.length - 1] = position;
    }
    return stops;
  }, []);
}

/** 原生触摸和聚焦滚动后，以最近停靠点作为下一次翻页起点 */
export function nearestStop(stops: readonly number[], top: number): number {
  return stops.reduce(
    (nearest, position, index) => (Math.abs(position - top) < Math.abs(stops[nearest] - top) ? index : nearest),
    0
  );
}
