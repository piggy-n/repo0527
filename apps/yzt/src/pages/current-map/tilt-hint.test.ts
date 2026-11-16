// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { TILT_HINT_PITCH, tiltHintShown } from './tilt-hint';

const BASE = { scene: true, pitch: TILT_HINT_PITCH, overModels: true, shownModel: true };

describe('tiltHintShown（ADR 0161）', () => {
  it('三维里有二维画在显示着的模型上面、俯仰角到了阈值时提示', () => {
    expect(tiltHintShown(BASE)).toBe(true);
    expect(tiltHintShown({ ...BASE, pitch: 60 })).toBe(true);
  });

  it('俯视、二维里、没有画在模型上面的二维、模型都隐藏着时不提示', () => {
    expect(tiltHintShown({ ...BASE, pitch: TILT_HINT_PITCH - 0.1 })).toBe(false);
    expect(tiltHintShown({ ...BASE, scene: false })).toBe(false);
    expect(tiltHintShown({ ...BASE, overModels: false })).toBe(false);
    expect(tiltHintShown({ ...BASE, shownModel: false })).toBe(false);
  });
});
