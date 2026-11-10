import proj4 from 'proj4';

// CGCS2000 3 度带、坐标不带带号的高斯-克吕格投影：EPSG:4534 的中央经线是 75°E，往后每个编号东移 3 度，到 4554（135°E）
const FIRST_EPSG = 4534;
const LAST_EPSG = 4554;
const FIRST_CENTRAL_MERIDIAN = 75;

// GRS80 椭球（CGCS2000），和 WGS84 的差别在这里可以忽略
const SEMI_MAJOR_AXIS = 6378137;
const FLATTENING = 1 / 298.257222101;
const ECCENTRICITY_SQUARED = FLATTENING * (2 - FLATTENING);

const DEGREE = Math.PI / 180;

/** 投影的 proj4 定义；只认 CGCS2000 3 度带不带带号的 EPSG:4534～4554 */
export function projectionDefinition(epsg: number): string {
  if (!Number.isInteger(epsg) || epsg < FIRST_EPSG || epsg > LAST_EPSG) {
    throw new Error(`不支持 EPSG:${epsg}：工具只认 CGCS2000 3 度带、不带带号的 EPSG:${FIRST_EPSG}～${LAST_EPSG}`);
  }
  const centralMeridian = FIRST_CENTRAL_MERIDIAN + 3 * (epsg - FIRST_EPSG);
  return `+proj=tmerc +lat_0=0 +lon_0=${centralMeridian} +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs`;
}

export interface GridProjection {
  /** 网格坐标（东、北，米）换成经纬度（度） */
  toLngLat(east: number, north: number): readonly [number, number];
  /** 网格的东向（x 轴）在这一点从正东逆时针转的角度（度），即子午线收敛角取负：中央经线以东是负的 */
  gridEastHeading(east: number, north: number): number;
}

export function gridProjection(epsg: number): GridProjection {
  const converter = proj4(projectionDefinition(epsg), 'EPSG:4326');
  const toLngLat = (east: number, north: number): readonly [number, number] => {
    const [lng, lat] = converter.forward([east, north]);
    if (lng === undefined || lat === undefined) {
      throw new Error(`投影换算失败：(${east}, ${north})`);
    }
    return [lng, lat];
  };
  return {
    toLngLat,
    gridEastHeading(east, north) {
      // 沿网格东向前后各走 0.5 米，换成当地的东、北（米）：经差乘卯酉圈半径和纬度余弦，纬差乘子午圈半径
      const [lng0, lat0] = toLngLat(east - 0.5, north);
      const [lng1, lat1] = toLngLat(east + 0.5, north);
      const sinLat = Math.sin(lat0 * DEGREE);
      const w = 1 - ECCENTRICITY_SQUARED * sinLat * sinLat;
      const primeVertical = SEMI_MAJOR_AXIS / Math.sqrt(w);
      const meridian = (SEMI_MAJOR_AXIS * (1 - ECCENTRICITY_SQUARED)) / (w * Math.sqrt(w));
      const dEast = (lng1 - lng0) * DEGREE * primeVertical * Math.cos(lat0 * DEGREE);
      const dNorth = (lat1 - lat0) * DEGREE * meridian;
      return Math.atan2(dNorth, dEast) / DEGREE;
    }
  };
}
