import 'maplibre-gl/dist/maplibre-gl.css';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// 应用里这些设置由 app 的运行时装配（ADR 0019）；包的测试不依赖应用，自己设置
setWorkerUrl(workerUrl);
