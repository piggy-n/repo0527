import type { CoverOutcome, RegionShape } from './area-coverage';
import type { AreaFile, AreaFileResult } from './area-file';
import type { AreaCheck, AreaGeometry, PolygonCoordinates } from './area-geometry';

/** 范围分析 Worker 的协议：读文件、整理画的范围、与行政区求交；读不了、不能用时的原因在结果里，不抛错 */
export interface AreaWorkerProtocol {
  readonly read: {
    readonly request: { readonly files: readonly AreaFile[] };
    readonly response: AreaFileResult;
  };
  readonly prepare: {
    readonly request: { readonly polygons: PolygonCoordinates };
    readonly response: AreaCheck;
  };
  readonly cover: {
    readonly request: {
      readonly area: AreaGeometry;
      readonly regions: readonly RegionShape[];
      readonly scopeName: string;
    };
    readonly response: CoverOutcome;
  };
}
