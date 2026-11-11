// 3D 贴图一次上传多少字节：泼溅库的数据在 DataArrayTexture 里，走 texSubImage3D（ADR 0149 L.3）

// 一个分量的字节数；没列在这里的类型整个像素打包在一起，见 PACKED_TYPE_BYTES
const COMPONENT_TYPE_BYTES: Readonly<Record<number, number>> = {
  0x1400: 1, // BYTE
  0x1401: 1, // UNSIGNED_BYTE
  0x1402: 2, // SHORT
  0x1403: 2, // UNSIGNED_SHORT
  0x1404: 4, // INT
  0x1405: 4, // UNSIGNED_INT
  0x1406: 4, // FLOAT
  0x140b: 2 // HALF_FLOAT
};

const PACKED_TYPE_BYTES: Readonly<Record<number, number>> = {
  0x8033: 2, // UNSIGNED_SHORT_4_4_4_4
  0x8034: 2, // UNSIGNED_SHORT_5_5_5_1
  0x8363: 2, // UNSIGNED_SHORT_5_6_5
  0x8368: 4, // UNSIGNED_INT_2_10_10_10_REV
  0x84fa: 4, // UNSIGNED_INT_24_8
  0x8c3b: 4, // UNSIGNED_INT_10F_11F_11F_REV
  0x8c3e: 4, // UNSIGNED_INT_5_9_9_9_REV
  0x8dad: 8 // FLOAT_32_UNSIGNED_INT_24_8_REV
};

const FORMAT_COMPONENTS: Readonly<Record<number, number>> = {
  0x1902: 1, // DEPTH_COMPONENT
  0x1903: 1, // RED
  0x1906: 1, // ALPHA
  0x1907: 3, // RGB
  0x1908: 4, // RGBA
  0x1909: 1, // LUMINANCE
  0x190a: 2, // LUMINANCE_ALPHA
  0x8227: 2, // RG
  0x8228: 2, // RG_INTEGER
  0x84f9: 2, // DEPTH_STENCIL
  0x8d94: 1, // RED_INTEGER
  0x8d98: 3, // RGB_INTEGER
  0x8d99: 4 // RGBA_INTEGER
};

/** 一个像素的字节数；WebGL2 里没有的组合为 0 */
export function bytesPerTexel(format: number, type: number): number {
  const packed = PACKED_TYPE_BYTES[type];
  if (packed !== undefined) {
    return packed;
  }
  return (FORMAT_COMPONENTS[format] ?? 0) * (COMPONENT_TYPE_BYTES[type] ?? 0);
}

/**
 * texImage3D、texSubImage3D 这次传了多少字节：宽 × 高 × 深 × 每像素字节数。
 * 数据是 null（只分配）或数字（从 PBO 取，字节已经算在 bufferData 里）时为 0
 */
export function texture3dBytes(args: readonly unknown[], widthIndex: number, formatIndex: number): number {
  const [width, height, depth] = [args[widthIndex], args[widthIndex + 1], args[widthIndex + 2]];
  const [format, type, data] = [args[formatIndex], args[formatIndex + 1], args[formatIndex + 2]];
  if (typeof width !== 'number' || typeof height !== 'number' || typeof depth !== 'number') {
    return 0;
  }
  if (typeof format !== 'number' || typeof type !== 'number' || typeof data !== 'object' || data === null) {
    return 0;
  }
  return width * height * depth * bytesPerTexel(format, type);
}
