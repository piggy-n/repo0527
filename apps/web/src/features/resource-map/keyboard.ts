/** 上下方向键对应的一步：往上是 -1，往下是 1，其他键为 0（拖动手柄、分割线的键盘操作共用） */
export function arrowStep(event: Pick<KeyboardEvent, 'key'>): -1 | 0 | 1 {
  if (event.key === 'ArrowUp') {
    return -1;
  }
  return event.key === 'ArrowDown' ? 1 : 0;
}
