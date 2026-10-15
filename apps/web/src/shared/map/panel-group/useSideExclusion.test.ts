import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { useSideExclusion } from './useSideExclusion';

describe('useSideExclusion', () => {
  it('窄屏时操作哪边显示哪边；变宽后两边都显示，各自的状态没变', () => {
    const narrow = ref(true);
    const sides = useSideExclusion({ leftExpanded: () => true, rightOpen: () => true, narrow: () => narrow.value });

    sides.activate('left');
    expect([sides.left.value, sides.right.value]).toStrictEqual([true, false]);
    sides.activate('right');
    expect([sides.left.value, sides.right.value]).toStrictEqual([false, true]);

    narrow.value = false;
    expect([sides.left.value, sides.right.value]).toStrictEqual([true, true]);
  });
});
