// 导出这个浏览器上保存的资源图层符号（图例样式），交给 symbols:import 写成发布的默认符号（ADR 0154）。
// 在部署的页面上打开开发者工具，把整个文件粘贴到控制台运行，用法见 docs/modules/storage.md 的"发布的默认符号"。
// 只读：不依赖应用的代码，只开只读事务；数据库不存在时不会新建
// oxlint-disable-next-line typescript/no-floating-promises -- 控制台显示这个 Promise 的结果：导出了哪些账号，或者失败的原因
(async () => {
  const DATABASE = 'yzt-preferences';
  const STORE = 'preferences';
  const SUFFIX = '/resource-symbols';
  const NOTHING =
    '这个浏览器上没有保存过资源图层的符号：请在部署的页面上运行，并确认在这个浏览器上登录后调整过图例样式';

  // oxlint-disable-next-line unicorn/consistent-function-scoping -- 放到外层就成了控制台的全局变量，再粘贴一次会报重复声明
  const settle = request =>
    new Promise((resolve, reject) => {
      request.addEventListener('success', () => resolve(request.result));
      request.addEventListener('error', () => reject(new Error('读取 IndexedDB 失败', { cause: request.error })));
    });

  // 先确认数据库存在，不存在时不调用 open
  if (typeof indexedDB.databases === 'function') {
    const databases = await indexedDB.databases();
    if (!databases.some(info => info.name === DATABASE)) {
      throw new Error(NOTHING);
    }
  }
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE);
    // 数据库不存在时 open 会建一个空库，应用以后就建不了仓库、存不了偏好：中止建库，什么都不留下
    request.addEventListener('upgradeneeded', () => request.transaction.abort());
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(new Error(NOTHING)));
  });
  try {
    if (!db.objectStoreNames.contains(STORE)) {
      throw new Error(NOTHING);
    }
    // 键和值在同一个只读事务里按同样的顺序取出
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    const [keys, values] = await Promise.all([settle(store.getAllKeys()), settle(store.getAll())]);
    const entries = keys.flatMap((key, index) =>
      typeof key === 'string' && key.endsWith(SUFFIX) ? [{ key, record: values[index] }] : []
    );
    if (entries.length === 0) {
      throw new Error(NOTHING);
    }
    const exportedAt = new Date().toISOString();
    const text = JSON.stringify({ kind: 'yzt-resource-symbols', exportedAt, entries }, null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `resource-symbols-${exportedAt.slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    // 键的前半段是 encodeURIComponent 过的登录名（shared/storage/preference-scope.ts）
    const logins = entries.map(({ key }) => decodeURIComponent(key.slice(0, -SUFFIX.length)));
    return `已导出 ${logins.length} 个账号的图例样式：${logins.join('、')}`;
  } finally {
    db.close();
  }
})();
