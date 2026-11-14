// 把面板里的一行滚到看得见：只滚它所在的滚动区，不用 scrollIntoView（它会连带滚动外层的容器）

/** 最近的能纵向滚动的祖先；没有时为 null */
export function scrollParent(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement;
  while (parent && !['auto', 'scroll'].includes(getComputedStyle(parent).overflowY)) {
    parent = parent.parentElement;
  }
  return parent;
}

/** 滚动所在的滚动区让这一行露出来：nearest 只在它露不全时滚到边上，center 滚到正中 */
export function revealInScroll(element: HTMLElement, block: 'nearest' | 'center' = 'nearest'): void {
  const container = scrollParent(element);
  if (!container) {
    return;
  }
  const box = container.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  if (block === 'center') {
    container.scrollTop += rect.top + rect.height / 2 - (box.top + box.height / 2);
  } else if (rect.top < box.top) {
    container.scrollTop += rect.top - box.top;
  } else if (rect.bottom > box.bottom) {
    container.scrollTop += rect.bottom - box.bottom;
  }
}
