// 把 overlay.mjs 的原始结果排成 report.md

const dash = '—';
const show = value => (value === null || value === undefined ? dash : String(value));
const px = value => (value === null || value === undefined ? dash : `${Number(value).toFixed(2)}`);
const percent = value => (value === null || value === undefined ? dash : `${(value * 100).toFixed(1)}%`);
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(row => `| ${row.join(' | ')} |`)].join('\n');
const quantiles = item => (item && item.n > 0 ? `${item.p50} / ${item.p95}` : dash);

function failed(scene) {
  return scene.status === 'failed' ? `**这一项失败：** ${scene.error}\n` : null;
}

function errorsLine(scene) {
  return scene.errors?.length > 0 ? `\n页面报错 ${scene.errors.length} 条：${scene.errors.slice(0, 5).map(text => `\`${text}\``).join('；')}\n` : '\n页面没有报错。\n';
}

function alignSection(scene) {
  const lines = ['## 位置是否一致\n'];
  lines.push(
    '同一个地心坐标，Cesium 画品红的圆点，Three 画青色的方点。"算出来"是两边各自把这个点投到屏幕上的差；"画出来"是在同一帧里分别读两块画布，比两种标记的质心。点是按像素画的，质心本身有约 0.5 像素的量化误差。\n'
  );
  lines.push(
    table(
      ['视角', '算出来的最大偏差（像素）', '画出来的最大偏差（像素）', '量到的标记'],
      scene.poses.map(pose => [pose.label, px(pose.projectionMaxPx), px(pose.renderedMaxPx), show(pose.markersFound)])
    )
  );
  lines.push('\n连续运动，每一帧都量：\n');
  lines.push(
    table(
      ['运动', '帧数', '画出来的最大偏差（像素）', '算出来的最大偏差（像素）', '两边相机不一致的帧'],
      Object.entries(scene.motion).map(([kind, item]) => [
        { orbit: '转动，每帧 3°', dolly: '拉近，每帧 5%', tilt: '压低视角，每帧 2°' }[kind] ?? kind,
        show(item.frames),
        px(item.maxPx),
        px(item.projectionMaxPx),
        show(item.viewMismatches)
      ])
    )
  );
  const demand = scene.onDemand;
  lines.push(
    `\n按需渲染：静止 3 秒，页面走了 ${demand.idleFrames} 帧，Cesium 重画 ${demand.idleCesiumRenders} 次，Three 重画 ${demand.idleOverlayRenders} 次；相机动一下之后，Cesium 重画 ${demand.nudgeCesiumRenders} 次，Three 重画 ${demand.nudgeOverlayRenders} 次。整个过程两边相机不一致的帧：${scene.viewMismatches}。\n`
  );
  lines.push('窗口大小和设备像素比：\n');
  lines.push(
    table(
      ['操作', '设备像素比', 'Cesium 画布', 'Three 画布', '画出来的最大偏差（像素）'],
      scene.resize.map(item => [item.label, show(item.dpr), item.cesiumCanvas.join('×'), item.overlayCanvas?.join('×') ?? dash, px(item.renderedMaxPx)])
    )
  );
  lines.push(errorsLine(scene));
  return lines.join('\n');
}

function lagSection(scene) {
  const { orbit } = scene;
  return [
    '## 对照：两边不在同一帧里对齐\n',
    `Three 故意用上一帧的相机画，同样每帧转 3°：${orbit.frames} 帧里画出来的最大偏差 ${px(orbit.maxPx)} 像素，两边相机不一致的帧 ${orbit.viewMismatches}。两块画布各跑各的 requestAnimationFrame、Three 排在前面时就是这个结果。`,
    errorsLine(scene)
  ].join('\n');
}

function rtcSection(scene) {
  const row = (label, item) => [label, item.stepDifferences.join('、'), show(item.maxStep), show(item.firstToLast)];
  return [
    '## 相对中心的坐标\n',
    '同一个近处的第一人称视角，Three 的世界分别用局部坐标（原点在样例的 offset 处）和地心坐标。画面缩到 320×200 的灰度（0～255）比较。每次横挪 2 毫米，相邻两帧的平均差应当很小而且均匀；坐标精度不够时画面会不动，然后一跳。第一帧和最后一帧隔了 16 毫米，差应当明显比相邻两帧大，否则量到的只是噪声。\n',
    table(['Three 的世界', '相邻两帧的平均差（8 步）', '最大', '第一帧和最后一帧'], [row('局部坐标', scene.modes.local), row('地心坐标', scene.modes.ecef)]),
    `\n两种做法第一帧画面的平均差：${show(scene.differenceBetweenModes)}。`,
    `\n截图：${scene.shots.map(name => `\`${name}\``).join('、')}`,
    errorsLine(scene)
  ].join('\n');
}

const MODE_LABEL = { none: '不处理', depth: '读 Cesium 的深度', proxy: 'Three 里再加载一份倾斜模型' };

function occlusionSection(scene) {
  const lines = ['## 遮挡\n'];
  lines.push(
    '"红方块还看得见"是 Cesium 里的方块叠上 Three 的画布后剩下的像素比例，100% 才对。"泼溅盖住的画面"是 Three 的画布上不透明的像素占整个画面的比例：下沉 15 米后应当明显变小，沉到地球表面以下后应当是 0。\n'
  );
  lines.push(
    table(
      ['做法', '红方块还看得见', '泼溅盖住的画面：原位', '下沉 15 米', '沉到地球表面以下'],
      Object.entries(scene.modes).map(([mode, item]) => [
        MODE_LABEL[mode] ?? mode,
        item.box.cesiumRed > 0 ? percent(item.box.compositeRed / item.box.cesiumRed) : dash,
        percent(item.box.overlayCoverage),
        percent(item.sunk.overlayCoverage),
        item.ground ? percent(item.ground.overlayCoverage) : '没测'
      ])
    )
  );
  lines.push(`\n截图：${scene.shots.map(name => `\`${name}\``).join('、')}`);
  lines.push(errorsLine(scene));
  return lines.join('\n');
}

function undergroundSection(scene) {
  const lines = ['## 第一人称和地下\n'];
  lines.push(
    table(
      ['项目', '结果'],
      [
        ['相机的椭球高（米）', show(scene.overlay.stats.cameraHeight)],
        ['显示的高斯', show(scene.overlay.stats.visibleSplats)],
        ['眼前 5 个点算出来的最大偏差（像素）', `${px(scene.overlay.projection.max)}（比了 ${scene.overlay.projection.compared} 个）`],
        ['泼溅盖住的画面', percent(scene.overlay.coverage.overlayCoverage)],
        ['读 Cesium 的深度后盖住的画面', percent(scene.depth.coverage.overlayCoverage)],
        ['往前走时每帧 Cesium 的 JS 耗时（毫秒，中位 / 95 分位）', quantiles(scene.walk.perf.cesiumCpuMs)],
        ['往前走时每帧 Three 的 JS 耗时（毫秒，中位 / 95 分位）', quantiles(scene.walk.perf.overlayCpuMs)],
        ['数据放回原始高度、打开钻地后相机的椭球高（米）', show(scene.below.cameraHeight)],
        ['这时算出来的最大偏差（像素）', `${px(scene.below.projection.max)}（比了 ${scene.below.projection.compared} 个）`]
      ]
    )
  );
  lines.push(`\n截图：${scene.shots.map(name => `\`${name}\``).join('、')}`);
  lines.push(errorsLine(scene));
  return lines.join('\n');
}

function memorySection(scene) {
  const lines = ['## 两个上下文的显存\n'];
  lines.push(
    '"申请的显存"是页面里按每次申请的尺寸记的（纹理、缓冲、渲染缓冲，加画布自己的绘图缓冲），两个上下文分开；它不是驱动实际占用的量。"GPU 进程"是系统计数器里浏览器 GPU 进程的专用显存，两个上下文合在一起，软件渲染时读不到。\n'
  );
  const gl = report => (report ? `${report.totalMb}（纹理 ${report.textures.mb}，缓冲 ${report.buffers.mb}，渲染缓冲 ${report.renderbuffers.mb}）` : dash);
  lines.push(
    table(
      ['阶段', 'Cesium 申请的显存（MB）', 'Three 申请的显存（MB）', '泼溅库的估算（MB）', '代理模型的缓存（MB）', 'GPU 进程专用显存（MB）'],
      scene.stages.map(item => [
        item.label,
        gl(item.gl.cesium),
        gl(item.gl.overlay),
        show(item.stats.splatGpuMB),
        show(item.stats.proxyCachedMB),
        item.gpuProcess.dedicatedMB === undefined ? `取不到：${item.gpuProcess.unavailable}` : item.gpuProcess.dedicatedMB.toFixed(0)
      ])
    )
  );
  const unknown = scene.stages.flatMap(item => [...(item.gl.cesium?.unknownFormats ?? []), ...(item.gl.overlay?.unknownFormats ?? [])]);
  if (unknown.length > 0) {
    lines.push(`\n有 ${new Set(unknown).size} 种纹理格式不在表里，按每像素 4 字节算了：${[...new Set(unknown)].map(value => `0x${value.toString(16)}`).join('、')}。`);
  }
  lines.push(errorsLine(scene));
  return lines.join('\n');
}

function perfSection(scene) {
  const lines = ['## 每帧的成本\n'];
  lines.push(
    '每帧强制重画。帧间隔是等两个上下文的上一帧都在 GPU 上执行完才开始下一帧量的，约等于 JS 加 GPU。GPU 耗时用 `EXT_disjoint_timer_query_webgl2` 分别包住两个上下文各自的绘制。数字都是"中位 / 95 分位"，单位毫秒。\n'
  );
  for (const [key, title] of [
    ['still', '静止'],
    ['spin', '转动，每秒 20°']
  ]) {
    lines.push(`${title}：\n`);
    lines.push(
      table(
        ['阶段', '帧数', '帧间隔', 'Cesium JS', 'Three JS', 'Cesium GPU', 'Three GPU'],
        scene.stages.map(item => {
          const data = item[key];
          return [
            item.label,
            show(data.framesRendered),
            quantiles(data.intervalMs),
            quantiles(data.cesiumCpuMs),
            quantiles(data.overlayCpuMs),
            quantiles(data.cesiumGpuMs),
            quantiles(data.overlayGpuMs)
          ];
        })
      )
    );
    lines.push('');
  }
  lines.push(errorsLine(scene));
  return lines.join('\n');
}

const SECTIONS = { align: alignSection, lag: lagSection, rtc: rtcSection, occlusion: occlusionSection, underground: undergroundSection, memory: memorySection, perf: perfSection };

export function renderOverlayReport(raw) {
  const { meta, environment } = raw;
  const lines = ['# Cesium 上叠 Three.js 画布画 LCC2：复测结果\n'];
  if (environment.software) {
    lines.push('**这次是软件渲染：耗时、帧间隔和显存的数字没有意义，只说明脚本能跑；对齐和遮挡的结论不受影响。**\n');
  }
  if (!meta.finished) {
    lines.push('**没有跑完，下面只有已经完成的项目。**\n');
  }
  lines.push(
    table(
      ['项目', '值'],
      [
        ['提交', show(meta.commit)],
        ['开始时间', meta.startedAt],
        ['用时（分钟）', show(meta.minutes)],
        ['显卡', environment.gpu],
        ['浏览器', environment.browser],
        ['处理器 / 内存', `${environment.cpu} / ${environment.memoryGB} GB`],
        ['视口', `${meta.viewport.width}×${meta.viewport.height}`],
        ['泼溅预算（俯瞰 / 第一人称）', `${meta.budget} / ${meta.fpBudget}`],
        ['底图', meta.basemap],
        ['帧率上限已解除', environment.uncapped ? '是' : '否'],
        ['GPU 计时扩展', environment.timerQuery ? '有' : '没有'],
        ['缩短版（--quick）', meta.quick ? '是' : '否']
      ]
    )
  );
  lines.push('');
  for (const [name, scene] of Object.entries(raw.scenes)) {
    lines.push(failed(scene) ? `## ${name}\n\n${failed(scene)}` : SECTIONS[name](scene));
  }
  return `${lines.join('\n')}\n`;
}
