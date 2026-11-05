import { isRawTileset, MODELS, preparedTilesetUrl } from './common.ts';
import manifest from './manifest.json';
import { RoamScene } from './roam-scene.ts';

const container = document.querySelector<HTMLElement>('#roam');
const hud = document.querySelector<HTMLElement>('#hud');
if (!container || !hud) {
  throw new Error('缺少页面元素');
}
const raw = isRawTileset();
const url = raw ? MODELS.station.url : await preparedTilesetUrl(MODELS.station.url);
const spawn = manifest.models[0].spawn as { lng: number; lat: number; height: number; heading: number };
const scene = new RoamScene({ container, tilesetUrl: url, origin: [spawn.lng, spawn.lat], spawn });

Object.assign(window, { roam: scene, roamManifest: manifest });
setInterval(() => {
  hud.textContent = JSON.stringify(scene.stats(), null, 0).replace(/,/g, '\n');
}, 500);
