import { setupMapRuntime } from '@/app/map-runtime';

// 浏览器测试里的地图和生产用同一份运行时装配：Worker 地址和 MapLibre 的 CSS（ADR 0040）
setupMapRuntime();
