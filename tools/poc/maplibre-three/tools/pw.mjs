// 驱动的命令行：node tools/pw.mjs goto <url> | shot <file> | logs | quit | eval（代码从标准输入读）
import { join } from 'node:path';
import { POC_DIR } from './lib/paths.mjs';

const [, , command, argument] = process.argv;

async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk;
  }
  return text;
}

let payload = {};
if (command === 'goto') {
  payload = { url: argument };
} else if (command === 'shot') {
  payload = { path: join(POC_DIR, 'screenshots', `${argument}.png`) };
} else if (command === 'eval' || command === 'cdpProfile') {
  payload = { code: await readStdin(), timeoutMs: Number(argument ?? 300000) };
} else if (command === 'mouse') {
  payload = { actions: JSON.parse(await readStdin()) };
} else if (command === 'logs') {
  payload = { clear: argument === 'clear' };
}
const response = await fetch(`http://127.0.0.1:5299/${command}`, { method: 'POST', body: JSON.stringify(payload) });
const json = await response.json();
if (!json.ok) {
  console.error('ERROR', json.error);
  process.exit(1);
}
console.log(typeof json.result === 'string' ? json.result : JSON.stringify(json.result, null, 1));
