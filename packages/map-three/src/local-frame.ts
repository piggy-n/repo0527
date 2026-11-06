import { fromEcef, type LngLat, toEcef } from '@mx/map-core';
import { Matrix4, Vector3 } from 'three';

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * 锚点的局部系（x 东、y 上、z 南，米，原点在锚点的椭球面上）和地心坐标的换算；
 * 和 map-core 外壳给的锚点矩阵是同一个约定（ADR 0147 第 5 节）
 */
export class LocalFrame {
  readonly anchor: LngLat;
  /** 地心坐标 → 局部系 */
  readonly fromEcef: Matrix4;
  /** 局部系 → 地心坐标 */
  readonly toEcef: Matrix4;

  constructor(anchor: LngLat) {
    const [lng, lat] = anchor;
    const lambda = toRadians(lng);
    const phi = toRadians(lat);
    const east = new Vector3(-Math.sin(lambda), Math.cos(lambda), 0);
    const up = new Vector3(Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi));
    const south = new Vector3(Math.sin(phi) * Math.cos(lambda), Math.sin(phi) * Math.sin(lambda), -Math.cos(phi));
    this.anchor = anchor;
    this.toEcef = new Matrix4().makeBasis(east, up, south).setPosition(...toEcef(lng, lat, 0));
    this.fromEcef = this.toEcef.clone().invert();
  }

  /** 局部系里的点 → [经度, 纬度, 椭球高] */
  toLngLatHeight(point: Vector3): [number, number, number] {
    const { x, y, z } = point.clone().applyMatrix4(this.toEcef);
    return fromEcef([x, y, z]);
  }

  /** 地心坐标的锚点：包围球的球心换成经纬度 */
  static fromEcefCenter(center: Vector3): LocalFrame {
    const [lng, lat] = fromEcef([center.x, center.y, center.z]);
    return new LocalFrame([lng, lat]);
  }
}
