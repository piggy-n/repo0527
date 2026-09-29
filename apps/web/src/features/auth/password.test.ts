import { sm2 } from 'sm-crypto-v2';
import { describe, expect, it } from 'vitest';
import { encryptPassword } from './password';

// 测试时临时生成密钥对，用私钥验证密文能被正确解密
const { publicKey, privateKey } = sm2.generateKeyPairHex();
const C1C3C2 = 1;

describe('encryptPassword', () => {
  it.each(['admin123', 'P@ss w0rd!中文密码'])('用私钥按 C1C3C2 能解密出原文：%s', password => {
    const cipher = encryptPassword(password, publicKey);

    expect(sm2.doDecrypt(cipher, privateKey, C1C3C2)).toBe(password);
  });

  it('密文是不带 04 前缀的十六进制：C1 128 位 + C3 64 位 + 明文字节数 × 2', () => {
    const cipher = encryptPassword('admin123', publicKey);

    expect(cipher).toMatch(/^[0-9a-f]+$/);
    expect(cipher).toHaveLength(128 + 64 + 8 * 2);
  });

  it('同一密码每次加密的结果不同', () => {
    expect(encryptPassword('admin123', publicKey)).not.toBe(encryptPassword('admin123', publicKey));
  });
});
