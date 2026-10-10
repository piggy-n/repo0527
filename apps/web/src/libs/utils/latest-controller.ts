/** 同一通道只认最新的一次（ADR 0039 第 2 条）：开始新的一次时中止上一次，释放时中止当前这次 */
export class LatestController implements Disposable {
  #controller = new AbortController();
  #disposed = false;

  /** 当前这一次的信号；创建时就有一个没中止的 */
  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  /** 中止当前这一次并开始新的一次，返回新的信号；reason 是上一次的中止原因，不传时为 AbortError。释放后调用抛错 */
  next(reason?: unknown): AbortSignal {
    if (this.#disposed) {
      throw new Error('LatestController 已释放');
    }
    this.#controller.abort(reason);
    this.#controller = new AbortController();
    return this.#controller.signal;
  }

  /** 中止当前这一次，不开始新的；已经中止时什么也不做 */
  abort(reason?: unknown): void {
    this.#controller.abort(reason);
  }

  /** 中止当前这一次，之后不能再开始新的；已经中止时保留原来的原因 */
  [Symbol.dispose](): void {
    this.#disposed = true;
    this.#controller.abort(new DOMException('LatestController 已释放', 'AbortError'));
  }
}
