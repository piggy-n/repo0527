import { z } from 'zod';
import { appConfig } from '@/shared/config/app-config';
import builtIn from './resource-min-zooms.json';
import { SOURCE_MAXZOOM } from './style-registry';

// 资源的最小显示级别（ADR 0137）：resource-min-zooms.json 既是构建时带上的层级，也随构建复制到发布目录，部署时换它就能改层级。
// 取值是单张瓦片 6 MB 的实测结果（ADR 0132）；村级调查区、界线、路面范围第一次请求很慢，定 8 级（ADR 0136）

/** 部署文件的格式：资源 code 到最小显示级别，没写的不限制；级别超过数据源的最大级别时资源就画不出来了 */
export const resourceMinZoomsSchema = z.record(z.string(), z.number().int().min(0).max(SOURCE_MAXZOOM));

export type ResourceMinZooms = Readonly<Record<string, number>>;

/** 构建时带上的层级：部署的文件读不到时用；关闭开关时不限制 */
export function builtInMinZooms(): ResourceMinZooms {
  return appConfig.resourceMinZoomEnabled ? builtIn : {};
}
