// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildFloorGrid } from './floor-grid.ts';
import type { Vec3 } from './lcc2-data.ts';
import { meshToLngLatHeight, placementFor, yawToManifestHeading } from './placement.ts';
import { gridProjection } from './projection.ts';
import { manifestRoute, manifestSpawn, outline, type RoamFrame } from './roam-manifest.ts';
import { trackOf } from './roam.ts';
import { rectangle, walk } from './test-meshes.ts';

const PROJECTION = gridProjection(4548);
const OFFSET: Vec3 = [516680.112515001, 3791689.929532249, 36.465];
const CORRECTION = { shift: [-0.07, 0.08, 0.04] as Vec3, yaw: 0 };
const PLACEMENT = placementFor(PROJECTION, OFFSET, CORRECTION, 5.47);
const FRAME: RoamFrame = {
  projection: PROJECTION,
  offset: OFFSET,
  correction: CORRECTION,
  datum: 5.47,
  placement: PLACEMENT
};

describe('meshToLngLatHeight、yawToManifestHeading', () => {
  it('局部系原点就是摆放的位置；往局部 y 走 100 米大约往北 100 米；局部 x 轴的朝向是 90° 减摆放的 heading', () => {
    const [lng, lat, height] = meshToLngLatHeight(PROJECTION, OFFSET, CORRECTION, 5.47, [0, 0, -1.3]);
    expect(lng).toBeCloseTo(PLACEMENT.lng, 9);
    expect(lat).toBeCloseTo(PLACEMENT.lat, 9);
    expect(height).toBeCloseTo(PLACEMENT.height - 1.3, 9);
    const [, north] = meshToLngLatHeight(PROJECTION, OFFSET, CORRECTION, 5.47, [0, 100, 0]);
    expect(north - lat).toBeCloseTo(100 / 110900, 5);
    expect(yawToManifestHeading(0, PLACEMENT.heading)).toBeCloseTo(90 - PLACEMENT.heading, 9);
    expect(yawToManifestHeading(Math.PI / 2, -0.102)).toBeCloseTo(0.102, 9);
    expect(yawToManifestHeading(Math.PI, 0)).toBeCloseTo(270, 9);
  });
});

describe('manifestSpawn、manifestRoute、outline', () => {
  // 20 × 4 米的地面，x 10 以后头顶 1.5 米有顶；沿 y = 2 往东走
  const grid = buildFloorGrid([rectangle(0, 0, 20, 4, 0), rectangle(10, 0, 20, 4, 1.5)]);
  const track = trackOf(
    walk([{ from: [0, 2], to: [20, 2] }], () => 0),
    grid
  );

  it('出生点朝东，经纬度 7 位小数、高度到厘米', () => {
    const spawn = manifestSpawn(track, 0, FRAME);
    expect(spawn.heading).toBeCloseTo(90, 0);
    expect(spawn.height).toBe(Number(PLACEMENT.height.toFixed(2)));
    expect(String(spawn.lng).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(7);
  });

  it('路线的点是 [经度, 纬度, 椭球高]，矮的地方多一个眼高', () => {
    const route = manifestRoute(track, { id: 'east', name: '往东', from: 1, to: 19 }, FRAME);
    expect(route).toMatchObject({ id: 'east', name: '往东' });
    expect(route.path[0]).toHaveLength(3);
    expect(route.path.at(-1)).toHaveLength(4);
    expect(route.path.at(-1)?.[3]).toBe(1.3);
  });

  it('概要每 20 米一行，写出地板、扫描仪离地和净空', () => {
    const lines = outline(track, 5);
    expect(lines).toHaveLength(4);
    expect(lines[3]).toContain('净空 1.50');
  });
});
