// @vitest-environment node
import type { CameraState, LngLat } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import { effectScope, nextTick, shallowRef } from 'vue';
import { useCoordinateInput } from './useCoordinateInput';
import { useLocationPoint } from './useLocationPoint';

const CAMERA: CameraState = { center: [119, 32], zoom: 7, bearing: 0, pitch: 0 };

/** 没有视图的位置点和输入；定位只放下位置点，相机操作一直等着 */
function setup(initial?: LngLat) {
  const scope = effectScope();
  const result = scope.run(() => {
    const map = { useCamera: () => shallowRef(CAMERA), releaseTool: () => {}, runCameraOperation: () => {} };
    const location = useLocationPoint(map, { regions: { districtCodeAt: () => Promise.resolve(null) } });
    if (initial) {
      location.place(initial, 'drag');
    }
    return { location, input: useCoordinateInput(location) };
  });
  if (!result) {
    throw new Error('没有创建');
  }
  return result;
}

describe('useCoordinateInput', () => {
  it('开始时显示已有的位置点；没有时两个框都空着、不提示', () => {
    expect(setup([118.79786, 32.04864]).input.fields.value).toStrictEqual({
      lng: { text: '118°47′52.30″', value: 118.79786 },
      lat: { text: '32°02′55.10″', value: 32.04864 }
    });
    const { input } = setup();
    expect(input.fields.value).toStrictEqual({ lng: { text: '', value: null }, lat: { text: '', value: null } });
    expect(input.messages.value).toStrictEqual({ lng: null, lat: null });
  });

  it('输入时文字照原样保留，数值重新识别，下方显示识别结果；认不出来时显示原因', () => {
    const { input } = setup();

    input.setText('lng', '1184752.3');
    input.setText('lat', 'abc');

    expect(input.fields.value.lng).toStrictEqual({ text: '1184752.3', value: 118 + 47 / 60 + 52.3 / 3600 });
    expect(input.messages.value.lng).toStrictEqual({ text: '= 118°47′52.30″', error: false });
    expect(input.fields.value.lat).toStrictEqual({ text: 'abc', value: null });
    expect(input.messages.value.lat?.error).toBe(true);
  });

  it('离开输入框：文字换成规范写法，数值保持输入时的精确值，不再显示识别结果', () => {
    const { input } = setup();
    input.setText('lng', '118.79786');

    input.blur('lng');

    expect(input.fields.value.lng).toStrictEqual({ text: '118°47′52.30″', value: 118.79786 });
    expect(input.messages.value.lng).toBeNull();
  });

  it('切换格式：按精确值换写法，记到拥有者里', () => {
    const { input, location } = setup();
    input.setText('lng', '118.79786');
    input.blur('lng');

    input.changeFormat('decimal');
    expect(input.fields.value.lng).toStrictEqual({ text: '118.797860', value: 118.79786 });
    expect(location.state.value.format).toBe('decimal');
    input.changeFormat('dms');

    expect(input.fields.value.lng).toStrictEqual({ text: '118°47′52.30″', value: 118.79786 });
  });

  it('经度框里是一对坐标：提示会分到两个框；离开输入框时分开并规范，数值都是精确值', () => {
    const { input } = setup();

    input.setText('lng', '118.79786, 32.04864');
    expect(input.messages.value.lng).toStrictEqual({ text: '识别为一对坐标，回车或离开输入框后分到两个框', error: false });
    input.blur('lng');

    expect(input.fields.value).toStrictEqual({
      lng: { text: '118°47′52.30″', value: 118.79786 },
      lat: { text: '32°02′55.10″', value: 32.04864 }
    });
  });

  it('提交：和离开输入框一样拆分、规范，按精确值定位', () => {
    const paired = setup();
    const typed = setup();

    paired.input.setText('lng', '118.79786 32.04864');
    paired.input.submit();
    typed.input.setText('lng', '118.79786');
    typed.input.blur('lng');
    typed.input.setText('lat', '32.04864');
    typed.input.submit();

    expect(paired.location.state.value.point).toStrictEqual({ lngLat: [118.79786, 32.04864], source: 'input' });
    expect(typed.location.state.value.point).toStrictEqual({ lngLat: [118.79786, 32.04864], source: 'input' });
    expect(typed.input.fields.value.lat.text).toBe('32°02′55.10″');
  });

  it('提交时有空白的框：提示、不定位；定位成功后重新开始，清空不马上提示', () => {
    const { input, location } = setup();
    input.setText('lng', '118.79786');

    input.submit();
    expect(input.messages.value.lat).toStrictEqual({ text: '请输入纬度', error: true });
    expect(location.state.value.point).toBeNull();

    input.setText('lat', '32.04864');
    input.submit();
    input.setText('lng', '');

    expect(location.state.value.point?.source).toBe('input');
    expect(input.messages.value.lng).toBeNull();
  });

  it('纬度超出范围而经度不超过 90：提示可能填反了', () => {
    const { input } = setup();

    input.setText('lng', '32.05');
    input.setText('lat', '118.79');

    expect(input.messages.value.lat).toStrictEqual({ text: '纬度超出范围，经纬度可能填反了', error: true });
  });

  it('位置点变化时（拾取、拖动）两个框跟着显示它，数值是位置点的精确值', async () => {
    const { input, location } = setup();
    input.setText('lng', 'abc');

    location.place([118.123456789, 32.987654321], 'pick');
    await nextTick();

    expect(input.fields.value).toStrictEqual({
      lng: { text: '118°07′24.44″', value: 118.123456789 },
      lat: { text: '32°59′15.56″', value: 32.987654321 }
    });
  });

  it('不在组件 setup 或 effectScope 中调用时抛错', () => {
    const { location } = setup();

    expect(() => useCoordinateInput(location)).toThrow('useCoordinateInput 只能在组件的 setup 或 effectScope 中调用');
  });
});
