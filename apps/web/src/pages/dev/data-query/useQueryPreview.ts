import { computed, reactive, ref, shallowRef, watch } from 'vue';
import { LAYERS, MODES, MODULES, type PreviewScene, type QueryMode, type QueryModule } from './preview-data';

/** 原型状态只存在内存，不请求业务接口、不写偏好 */
export function useQueryPreview() {
  const module = ref<QueryModule>('city');
  const mode = ref<QueryMode>('attribute');
  const layerCode = ref(LAYERS.city[0].code);
  const region = ref('江苏省');
  const conditionCodes = ref<string[]>(['TYPE']);
  const relation = ref('AND');
  const values = reactive<Record<string, string>>({});
  const advanced = ref('');
  const natural = ref('');
  const spatialMethod = ref('rectangle');
  const rangeReady = ref(false);
  const showExpression = ref(false);
  const fieldCode = ref('TYPE');
  const scene = ref<PreviewScene>('normal');
  const resultOpen = ref(false);
  const maximized = ref(false);
  const formOpen = ref(true);
  const error = ref('');
  const page = ref(1);
  const submitted = shallowRef<{ title: string; signature: string; mode: QueryMode }>();
  const layers = computed(() => LAYERS[module.value]);
  const layer = computed(() => layers.value.find(item => item.code === layerCode.value));
  const title = computed(() => MODULES.find(item => item.value === module.value)!.label);
  const selectedField = computed(() => layer.value?.fields.find(item => item.code === fieldCode.value));
  const expression = computed(() => conditionCodes.value.filter(code => values[code]).map(code =>
    `${code} = '${values[code].replaceAll("'", "''")}'`
  ).join(` ${relation.value} `));
  const signature = computed(() => JSON.stringify([
    module.value, mode.value, layerCode.value, region.value, values, relation.value, advanced.value, natural.value,
    spatialMethod.value, rangeReady.value
  ]));
  const edited = computed(() => Boolean(submitted.value && submitted.value.signature !== signature.value));
  const example = computed(() => module.value === 'land'
    ? '查询南京市城镇村等用地类型为 201 的数据'
    : '查询南京市学校点层中类型为小学的数据');

  function clearResults() {
    submitted.value = undefined;
    resultOpen.value = false;
    maximized.value = false;
    page.value = 1;
    error.value = '';
  }

  function reset() {
    Object.keys(values).forEach(key => delete values[key]);
    advanced.value = '';
    natural.value = '';
    rangeReady.value = false;
    region.value = '江苏省';
    relation.value = 'AND';
    showExpression.value = false;
    clearResults();
  }

  watch(module, () => {
    mode.value = 'attribute';
    layerCode.value = layers.value[0]?.code ?? '';
    reset();
  });
  watch(layerCode, () => {
    const first = layer.value?.fields[0]?.code;
    conditionCodes.value = first ? [first] : [];
    fieldCode.value = first ?? '';
    reset();
  });
  watch(mode, clearResults);
  watch(scene, () => {
    if (submitted.value) {
      resultOpen.value = true;
    }
  });
  watch(spatialMethod, () => (rangeReady.value = false));

  function search() {
    error.value = '';
    if (!layer.value) {
      error.value = '请先选择查询图层';
      return;
    }
    if (mode.value === 'spatial' && !rangeReady.value) {
      error.value = '请先选择或导入查询范围';
      return;
    }
    if (mode.value === 'natural' && !natural.value.trim()) {
      error.value = '请输入查询描述，或选择下方示例';
      return;
    }
    if (mode.value === 'advanced' && !advanced.value.trim()) {
      error.value = '请填写查询条件';
      return;
    }
    const modeName = MODES.find(item => item.value === mode.value)!.label;
    submitted.value = {
      title: mode.value === 'natural' ? `${modeName} · 示例结果` :
        `${layer.value.label} · ${modeName} · ${mode.value === 'spatial' ? '所选范围' : region.value}`,
      signature: signature.value,
      mode: mode.value
    };
    page.value = 1;
    resultOpen.value = true;
  }

  function appendToken(token: string) {
    advanced.value += `${advanced.value ? ' ' : ''}${token}`;
  }

  return {
    module, mode, layerCode, region, conditionCodes, relation, values, advanced, natural, spatialMethod, rangeReady,
    showExpression, fieldCode, scene, resultOpen, maximized, formOpen, error, page, submitted,
    layers, layer, title, selectedField, expression, edited, example, search, reset, appendToken
  };
}

export type QueryPreviewModel = ReturnType<typeof useQueryPreview>;
