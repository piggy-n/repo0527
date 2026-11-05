// 在页面里运行：记录 render 回调外来自 Three 或泼溅库的 GL 调用，以及所有 GL 错误
const { map, layer } = m3;
const gl = map.getCanvas().getContext('webgl2');
const outside = {};
const failed = [];
window.__glOutside = outside;
window.__glFailed = failed;
const watch = ['bindTexture', 'activeTexture', 'bindFramebuffer', 'useProgram', 'bindBuffer', 'texSubImage2D', 'texImage2D', 'texSubImage3D', 'texStorage2D', 'drawArrays', 'drawElements', 'readPixels', 'fenceSync', 'getBufferSubData', 'viewport', 'enable', 'disable', 'blendFunc'];
for (const name of watch) {
  const original = gl[name];
  gl[name] = function (...args) {
    if (!layer.rendering) {
      const stack = new Error().stack;
      if (/gaussian-splat-lite|3d-tiles-renderer/.test(stack) || (/chunk-/.test(stack) && !/maplibre/.test(stack))) {
        const frame = stack.split('\n').slice(2).find(line => /gaussian-splat-lite|3d-tiles-renderer|chunk-/.test(line)) ?? '';
        const key = `${name} @ ${frame.trim().replace(/http:\/\/localhost:5273\/node_modules\/\.vite\/deps\//, '').slice(0, 80)}`;
        outside[key] = (outside[key] ?? 0) + 1;
      }
    }
    const result = original.apply(this, args);
    if (name.startsWith('tex')) {
      const error = gl.getError();
      if (error && failed.length < 20) {
        failed.push({ name, error, rendering: layer.rendering, stack: new Error().stack.split('\n').slice(2, 5).map(s => s.trim().slice(0, 70)) });
      }
    }
    return result;
  };
}
return 'watching';
