// 临时提供构建产物：默认 5 分钟后自动退出，不留常驻服务（可传分钟数）
import { preview } from 'vite';

const minutes = Number(process.argv[2] ?? 5);
const server = await preview();
server.printUrls();
setTimeout(() => process.exit(0), minutes * 60 * 1000);
