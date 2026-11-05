// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fromEcef, identity, invertRigid, multiply, navigationFrame, toEcef, translation } from './nav-frame';

// 在 (lng, lat, height) 处的东北天坐标系，局部 y 轴从正北顺时针转 bearing 度
function enuTransform(lng: number, lat: number, height: number, bearing = 0): number[] {
  const lambda = (lng * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const east = [-Math.sin(lambda), Math.cos(lambda), 0];
  const north = [-Math.sin(phi) * Math.cos(lambda), -Math.sin(phi) * Math.sin(lambda), Math.cos(phi)];
  const up = [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
  const theta = (bearing * Math.PI) / 180;
  const y = east.map((value, i) => value * Math.sin(theta) + north[i] * Math.cos(theta));
  const x = east.map((value, i) => value * Math.cos(theta) - north[i] * Math.sin(theta));
  return [...x, 0, ...y, 0, ...up, 0, ...toEcef(lng, lat, height), 1];
}

describe('navigationFrame', () => {
  it('局部系就是原点处的东北天：北为 0°，地面在原点下方一个原点高度，经纬度与局部坐标互换', () => {
    const frame = navigationFrame(enuTransform(120.6647, 31.3175, 3.5));

    expect(frame.north).toBeCloseTo(0, 6);
    expect(frame.ground).toBeCloseTo(-3.5, 3);
    const [x, y, z] = frame.toLocal(120.6657, 31.3185, -5.1);
    expect(x).toBeGreaterThan(90);
    expect(y).toBeGreaterThan(105);
    expect(z).toBeLessThan(-8);
    const [lng, lat, height] = frame.toLngLat([x, y, z]);
    expect([lng, lat, height].map(value => value.toFixed(6))).toStrictEqual(['120.665700', '31.318500', '-5.100000']);
  });

  it('局部 y 轴偏东 30°：方位角 30°', () => {
    expect(navigationFrame(enuTransform(118.8, 32, 0, 30)).north).toBeCloseTo(30, 6);
    expect(navigationFrame(enuTransform(118.8, 32, 0, -90)).north).toBeCloseTo(270, 6);
  });

  it('transform 不是 16 个数时抛错', () => {
    expect(() => navigationFrame([1, 0, 0])).toThrow('瓦片集根节点的 transform 不是 16 个数');
  });
});

describe('矩阵与地心坐标', () => {
  it('刚体变换的逆乘回去是单位阵；经纬度与地心坐标往返一致', () => {
    const m = multiply(enuTransform(119, 33, 10, 45), translation(5, -3, 2));
    const product = multiply(m, invertRigid(m));
    Array.from(identity()).forEach((value, i) => expect(product[i]).toBeCloseTo(value, 6));
    const [lng, lat, height] = fromEcef(toEcef(119.5, 33.25, -12));
    expect([lng, lat, height].map(value => value.toFixed(6))).toStrictEqual(['119.500000', '33.250000', '-12.000000']);
  });
});
