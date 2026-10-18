import type { VectorSourceSpecification } from '@maplibre/maplibre-gl-style-spec';

// PbfWriter 生成的纯合成数据，不含业务瓦片：landuse 4096 / detail 8192，含分类、孔洞和稳定身份
const MVT_DATA = 'data:application/vnd.mapbox-vector-tile;base64,' +
  'GsUBeAIKB2xhbmR1c2USMAgLEggAAAEBAgIDAxgDIiAJgASABBqALAAAgDT/KwAPCYAQ/yMaAIAUgBAAAP8TDxIcCAwSBAAEAQUYAyIQ' +
  'CYA0gAgagAoAAIAq/wkADxoIY2F0ZWdvcnkaA2JzbRoHZW5hYmxlZBoEcmFuayIJCgdwcmltYXJ5Ig4KDGFyZWEtcHJpbWFyeSICOAEi' +
  'CRkAAAAAAAAcQCILCglzZWNvbmRhcnkiEAoOYXJlYS1zZWNvbmRhcnkogCAavgF4AgoGZGV0YWlsEhoIFRIEAAABARgCIg4JgBCAYBKA' +
  'MP8/gDCAQBIUCBYSBAACAQMYASIIEYAggECAQAASFggXEgQABAEFGAIiCgn/D4BACoCgAQAaCGNhdGVnb3J5GgRndWlkIgkKB3ByaW1h' +
  'cnkiDgoMcGF0aC1wcmltYXJ5IgsKCXNlY29uZGFyeSISChBwb2ludHMtc2Vjb25kYXJ5IgoKCGJvdW5kYXJ5Ig0KC3BhdGgtYnVmZmVyKIBA';

/** 固定南京一张原生瓦片；放大后由两个引擎各自复用父矢量，仍不请求外网 */
export const SAMPLE_MVT_SOURCE: VectorSourceSpecification = {
  type: 'vector', tiles: [MVT_DATA], minzoom: 10, maxzoom: 10,
  bounds: [118.4765625, 31.952162238024968, 118.828125, 32.249974455863295],
  promoteId: { landuse: 'bsm', detail: 'guid' }
};
