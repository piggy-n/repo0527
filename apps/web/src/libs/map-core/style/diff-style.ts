import { diff } from '@maplibre/maplibre-gl-style-spec';
import type {
  DiffCommand,
  GeoJSONSourceSpecification,
  SourceSpecification,
  StyleSpecification
} from '@maplibre/maplibre-gl-style-spec';

/** 一条样式命令：按 `command` 分支后，`args` 的类型自动收窄 */
export type StyleCommand = DiffCommand;

// style-spec 的 deepEqual 不先比较引用，数据留在样式里就要逐个比坐标；两边换成同一个占位值后视为相同
const DATA_PLACEHOLDER: GeoJSONSourceSpecification['data'] = { type: 'FeatureCollection', features: [] };

function withoutGeoJsonData(style: StyleSpecification): StyleSpecification {
  let sources: Record<string, SourceSpecification> | undefined;
  for (const [id, source] of Object.entries(style.sources)) {
    if (source.type === 'geojson') {
      sources ??= { ...style.sources };
      sources[id] = { ...source, data: DATA_PLACEHOLDER };
    }
  }
  return sources ? { ...style, sources } : style;
}

// MapLibre 的 setLayerZoomRange 把 undefined 当作"不修改"，去掉了的缩放范围要删除图层再按原位置添加
function readdForRemovedZoomRange(
  before: StyleSpecification,
  after: StyleSpecification,
  layerId: string
): StyleCommand[] | undefined {
  const previous = before.layers.find(layer => layer.id === layerId);
  const index = after.layers.findIndex(layer => layer.id === layerId);
  if (previous === undefined || index === -1) {
    return undefined;
  }
  const next = after.layers[index];
  const removed =
    (previous.minzoom !== undefined && next.minzoom === undefined) ||
    (previous.maxzoom !== undefined && next.maxzoom === undefined);
  if (!removed) {
    return undefined;
  }
  // 图层属性的命令排在调整顺序之后，此时地图里的顺序已与新快照一致
  return [
    { command: 'removeLayer', args: [layerId] },
    { command: 'addLayer', args: [next, after.layers.at(index + 1)?.id] }
  ];
}

/** 对比两份样式快照：GeoJSON 数据按引用比较，其余交给 style-spec（ADR 0022） */
export function diffStyle(before: StyleSpecification, after: StyleSpecification): StyleCommand[] {
  const commands: StyleCommand[] = [];
  // 重建的数据源，数据已经随 addSource 带上，不再单独更新
  const rebuiltSources = new Set<string>();

  for (const command of diff(withoutGeoJsonData(before), withoutGeoJsonData(after))) {
    if (command.command === 'setStyle') {
      // diff 失败时的退路，换回带真实数据的样式
      return [{ command: 'setStyle', args: [after] }];
    }
    if (command.command === 'addSource') {
      const [id] = command.args;
      rebuiltSources.add(id);
      commands.push({ command: 'addSource', args: [id, after.sources[id]] });
      continue;
    }
    if (command.command === 'setLayerZoomRange') {
      const readd = readdForRemovedZoomRange(before, after, command.args[0]);
      if (readd !== undefined) {
        commands.push(...readd);
        continue;
      }
    }
    commands.push(command);
  }

  for (const [id, source] of Object.entries(after.sources)) {
    const previous = before.sources[id];
    if (
      source.type === 'geojson' &&
      previous?.type === 'geojson' &&
      !rebuiltSources.has(id) &&
      previous.data !== source.data
    ) {
      commands.push({ command: 'setGeoJSONSourceData', args: [id, source.data] });
    }
  }

  return commands;
}
