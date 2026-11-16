// 斜着看时的提示（ADR 0161，用户 2026-11-16 选的"斜着看时提示并一键俯视"）：模型按真实高度摆（徐州地面约 40 米），
// 二维在 0 米，画在模型上面的二维和模型的地面斜着看时错开约"高差 × tan(俯仰角)"

/** 俯仰角不小于它（度）时提示：40 米的高差在 15° 时错开约 11 米，到了 z17 约十几个像素，已经看得出来 */
export const TILT_HINT_PITCH = 15;

export interface TiltHintInput {
  /** 正在显示三维 */
  readonly scene: boolean;
  /** 相机的俯仰角（度） */
  readonly pitch: number;
  /** 有二维图层画在模型上面（画在地图上、排在最上面那个模型上面） */
  readonly overModels: boolean;
  /** 图层里有显示着的模型 */
  readonly shownModel: boolean;
}

/** 是否提示"倾斜时二维图层和模型会错开"并提供"俯视" */
export function tiltHintShown({ scene, pitch, overModels, shownModel }: TiltHintInput): boolean {
  return scene && overModels && shownModel && pitch >= TILT_HINT_PITCH;
}
