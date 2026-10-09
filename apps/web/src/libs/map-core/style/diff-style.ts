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
