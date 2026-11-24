import { createTiandituTerrain, type MapTerrain, TIANDITU_TERRAIN_PROTOCOL, TiandituTerrainReader } from '@mx/map-core';
import { addProtocol } from 'maplibre-gl';
import { appConfig } from '@/shared/config/app-config';

let terrain: MapTerrain | null | undefined;

/**
 * 部署配置的三维地形（ADR 0170）：天地图的地形要开着天地图（appConfig 已经校验），没有地形时为 null，不请求天地图。
 * 一个页面一个：第一次取时注册协议（对整个页面生效，不随地图销毁移除），协议和注入视图的取高度共用读取器的缓存。
 * 只由地图页的运行时（map-runtime-provider）导入，map-core、maplibre-gl 不进入口包；测量工具导入的 map-runtime 不读 appConfig，所以不放在那里
 */
export function pageTerrain(): MapTerrain | null {
  if (terrain === undefined) {
    const { sceneTerrain, tianditu } = appConfig;
    if (sceneTerrain === 'tianditu' && tianditu) {
      const created = createTiandituTerrain(new TiandituTerrainReader({ key: tianditu.key }));
      addProtocol(TIANDITU_TERRAIN_PROTOCOL, created.protocol);
      terrain = created.terrain;
    } else {
      terrain = null;
    }
  }
  return terrain;
}
