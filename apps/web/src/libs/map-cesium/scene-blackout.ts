// 闪切：先黑下来，挪过去，再亮起来（毫秒）
const FADE_OUT = 160;
const FADE_IN = 260;
// 相机挪不到这么远（米）时直接挪、不黑下来：从路线换成步行时在原地开始
const NEAR = 2;

/**
 * 闪切用的黑幕（ADR 0086、0103）：盖住画布、不挡鼠标。全黑时挪相机，看不到中间穿墙的过程，
 * 也不会像 flyTo 那样先升到模型外再落下来
 */
export class Blackout implements Disposable {
  readonly #container: Element;
  #overlay: HTMLDivElement | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(container: Element) {
    this.#container = container;
  }

  /** 把相机挪 distance 米：离得近时直接 place；远了先黑下来，全黑时 place，再亮起来 */
  cut(distance: number, place: () => void): void {
    if (distance < NEAR) {
      this.lighten();
      place();
      return;
    }
    this.darken(() => {
      place();
      this.lighten();
    });
  }

  /** 黑下来，全黑时调用 then；之前还没到全黑的那次不再调用 */
  darken(then: () => void): void {
    clearTimeout(this.#timer);
    this.#fade(1, FADE_OUT, 'ease-in');
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      then();
    }, FADE_OUT);
  }

  /** 亮起来；还没到全黑的那次不再调用 */
  lighten(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.#overlay) {
      this.#fade(0, FADE_IN, 'ease-out');
    }
  }

  /** 立即撤掉，不渐变 */
  clear(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#overlay?.remove();
    this.#overlay = null;
  }

  [Symbol.dispose](): void {
    this.clear();
  }

  #fade(opacity: number, duration: number, easing: string): void {
    const overlay = this.#ensureOverlay();
    overlay.style.transition = `opacity ${duration}ms ${easing}`;
    overlay.style.opacity = String(opacity);
  }

  #ensureOverlay(): HTMLDivElement {
    if (!this.#overlay) {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;z-index:1';
      this.#container.append(overlay);
      // 先按透明排一次版，之后改不透明度才有渐变
      overlay.getBoundingClientRect();
      this.#overlay = overlay;
    }
    return this.#overlay;
  }
}
