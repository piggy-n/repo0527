import { sm2 } from 'sm-crypto-v2';

// 密文按 C1C3C2 排列，与旧项目和后端的约定一致
const C1C3C2 = 1;

/** 用 SM2 公钥加密登录密码，得到不带 04 前缀的十六进制密文；同一密码每次加密的结果都不同 */
export function encryptPassword(password: string, publicKey: string): string {
  return sm2.doEncrypt(password, publicKey, C1C3C2);
}
