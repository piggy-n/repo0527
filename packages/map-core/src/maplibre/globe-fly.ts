// 地球投影下中心几乎不变的 flyTo 会把地图弄坏（MapLibre 6.12）：路径长度是 acos(两个单位向量的点积)，没有截断。
// 点积舍入到 1 以上时 acos 得到 NaN，缩放跟着变成 NaN，矩阵求逆得到 null，之后每一帧都抛错。
// 只改缩放来回飞 400 次崩 13 次，见 docs/modules/map-core.md"MapLibre 6 的实测行为"。
// 中心不变时 flyTo 和 easeTo 的路径相同，都是缩放随时间线性变化，所以换成 easeTo

const RADIANS = Math.PI / 180;
// 点积离 1 这么近（约 0.9 米）算中心不变：实测差 0.1 米时还有 0.25% 超过 1，差 0.2 米就没有了
const SAME_CENTER_DOT = 1 - 1e-14;
// flyTo 默认的曲线和速度
const FLY_CURVE = 1.42;
const FLY_SPEED = 1.2;

type Center = readonly [number, number];

function surface([lng, lat]: Center): readonly [number, number, number] {
  const cosLat = Math.cos(lat * RADIANS);
  return [Math.sin(lng * RADIANS) * cosLat, Math.sin(lat * RADIANS), Math.cos(lng * RADIANS) * cosLat];
}

/** 两个中心在球面上几乎是同一个点：地球投影下不能用 flyTo */
export function sameCenterOnGlobe(a: Center, b: Center): boolean {
  const [ax, ay, az] = surface(a);
  const [bx, by, bz] = surface(b);
  return ax * bx + ay * by + az * bz > SAME_CENTER_DOT;
}

/** 中心不变时 flyTo 默认飞多久（毫秒）：easeTo 的默认时长是固定的，换过去要写明 */
export function zoomFlightDuration(fromZoom: number, toZoom: number): number {
  return (1000 * Math.abs(toZoom - fromZoom) * Math.LN2) / FLY_CURVE / FLY_SPEED;
}
