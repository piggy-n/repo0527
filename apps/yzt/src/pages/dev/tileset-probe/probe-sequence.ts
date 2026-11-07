import type { CameraState } from '@mx/map-core';

/** 自动序列里的一个相机姿态 */
export interface ProbePose {
  readonly label: string;
  readonly camera: CameraState;
}

// 由远到近四个级别，每级先俯视再倾斜；倾斜的俯角和定位模型时一样
const ZOOMS = [15, 16, 17, 18] as const;
const PITCHES = [
  { pitch: 0, label: '俯视' },
  { pitch: 55, label: '倾斜' }
] as const;

/** 诊断的固定序列：对着瓦片集的中心、正北朝上，级别 15～18 各俯视、倾斜一次，共 8 个姿态 */
export function probePoses(center: readonly [number, number]): ProbePose[] {
  return ZOOMS.flatMap(zoom =>
    PITCHES.map(({ pitch, label }) => ({
      label: `z${zoom} ${label}`,
      camera: { center, zoom, bearing: 0, pitch }
    }))
  );
}
