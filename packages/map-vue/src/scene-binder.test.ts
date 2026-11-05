// @vitest-environment node
import { EMPTY_SCENE_CONTENT, type SceneContent, SceneContentModel, type TilesetLayer } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import { nextTick, ref } from 'vue';
import { SceneBinder } from './scene-binder';

const tileset = (id: string): TilesetLayer => ({
  id,
  url: `https://maps.test/3dt/${id}.json`,
  show: true,
  lighting: 'sun',
  attempt: 0
});

function setup() {
  const scene = new SceneContentModel();
  const errors: Error[] = [];
  const binder = new SceneBinder(scene, error => errors.push(error as Error));
  return {
    scene,
    binder,
    errors,
    [Symbol.dispose]() {
      binder[Symbol.dispose]();
      scene[Symbol.dispose]();
    }
  };
}

describe('SceneBinder', () => {
  it('开始时提交初始值，之后推导的依赖变化时提交新的内容', async () => {
    using env = setup();
    const ids = ref(['a']);
    env.binder.bind(() => ({ tilesets: ids.value.map(tileset), underground: null }));

    env.binder.start();
    expect(env.scene.current.tilesets.map(({ id }) => id)).toStrictEqual(['a']);

    ids.value = ['a', 'b'];
    await nextTick();
    expect(env.scene.current.tilesets.map(({ id }) => id)).toStrictEqual(['a', 'b']);
  });

  it('推导出错、内容不合法时报告并跳过这一轮，同一个失败只报告一次；改好后照常提交', async () => {
    using env = setup();
    const mode = ref<'ok' | 'throw' | 'invalid'>('ok');
    const valid: SceneContent = { tilesets: [tileset('a')], underground: null };
    env.binder.bind(() => {
      if (mode.value === 'throw') {
        throw new Error('拥有者出错');
      }
      return mode.value === 'invalid' ? { tilesets: [tileset('a'), tileset('a')], underground: null } : valid;
    });
    env.binder.start();

    mode.value = 'throw';
    await nextTick();
    mode.value = 'invalid';
    await nextTick();
    expect(env.scene.current).toBe(valid);
    expect(env.errors.map(({ message }) => message)).toStrictEqual([
      '三维内容的推导函数出错，本轮不提交',
      '三维内容没有通过校验，本轮不提交'
    ]);

    mode.value = 'ok';
    await nextTick();
    expect(env.scene.current).toBe(valid);
  });

  it('只能在开始前绑定一次；没有绑定时开始什么也不做', () => {
    using env = setup();
    env.binder.bind(() => EMPTY_SCENE_CONTENT);

    expect(() => env.binder.bind(() => EMPTY_SCENE_CONTENT)).toThrow('三维内容已经绑定过');
    env.binder.start();
    expect(() => env.binder.bind(() => EMPTY_SCENE_CONTENT)).toThrow('只能在 provideMap 所在组件的 setup 中绑定');

    using other = setup();
    other.binder.start();
    expect(other.scene.revision).toBe(0);
  });

  it('释放后不再提交，已提交的内容保留', async () => {
    using env = setup();
    const ids = ref(['a']);
    env.binder.bind(() => ({ tilesets: ids.value.map(tileset), underground: null }));
    env.binder.start();

    env.binder[Symbol.dispose]();
    ids.value = ['b'];
    await nextTick();

    expect(env.scene.current.tilesets.map(({ id }) => id)).toStrictEqual(['a']);
  });
});
