import { onMounted, onScopeDispose, shallowRef } from 'vue';

/** Canvas 不会自动重排已画文字，字体加载完成后通知图表重绘；晚到结果不更新已卸载组件 */
export function useChartFonts() {
  const revision = shallowRef(0);
  let active = true;
  onScopeDispose(() => {
    active = false;
  });
  onMounted(() => {
    if (!document.fonts) {
      return;
    }
    void Promise.allSettled([
      document.fonts.load('400 16px "Alibaba PuHuiTi"', '南京城市0123456789'),
      document.fonts.load('600 16px "Alibaba PuHuiTi"', '均值0123456789'),
      document.fonts.load('900 20px "City Dashboard Serif"', '城市体检救援博物馆')
    ]).then(() => {
      if (active) {
        revision.value += 1;
      }
      return undefined;
    });
  });
  return revision;
}
