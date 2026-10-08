// 移动 DOM 节点会把其中的滚动位置清零，display: none 则不会（docs/modules/ui.md 的"分栏布局"）
export type ScrollPositions = Map<Element, { top: number; left: number }>;

/** 记下 root 及其后代中滚动过的元素的位置 */
export function captureScrollPositions(root: Element): ScrollPositions {
  const positions: ScrollPositions = new Map();
  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (element.scrollTop !== 0 || element.scrollLeft !== 0) {
      positions.set(element, { top: element.scrollTop, left: element.scrollLeft });
    }
  }
  return positions;
}

export function restoreScrollPositions(positions: ScrollPositions) {
  positions.forEach(({ top, left }, element) => {
    element.scrollTop = top;
    element.scrollLeft = left;
  });
}

/** 元素是否正在显示：自身或祖先是 display: none 时没有布局框，读到的滚动位置都是 0 */
export function isDisplayed(element: Element) {
  return element.getClientRects().length > 0;
}
