const OVERLAY_DETAIL_KEY = 'yzt:overlay-detail-level';

/** 图层的 metadata：三维的覆盖物到这一级为止不再加细，也不再按级别重建（ADR 0135）；二维不受影响 */
export function overlayDetailMetadata(level: number): Readonly<Record<string, number>> {
  return { [OVERLAY_DETAIL_KEY]: level };
}

/** 读出图层写的上限；没写或者写得不对时返回 null，按当前级别 */
export function overlayDetailLimit(metadata: unknown): number | null {
  if (typeof metadata !== 'object' || metadata === null || !(OVERLAY_DETAIL_KEY in metadata)) {
    return null;
  }
  const level: unknown = metadata[OVERLAY_DETAIL_KEY];
  return typeof level === 'number' && Number.isFinite(level) ? level : null;
}
