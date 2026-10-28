import {
  chooseSpawn,
  headingToYaw,
  type NavPoint,
  planMove,
  walkAxes,
  Walker,
  WALK_KEYS,
  yawToHeading
} from '@yzt/map-core';
import { ElButton } from 'element-plus';
import { computed, defineComponent, onScopeDispose, type PropType, ref, shallowRef } from 'vue';
import type { SceneModel } from '@/features/scene-models/catalog';
import { IndoorMapDialog } from '@/features/scene-models/components/IndoorMapDialog';
import { IndoorMinimap } from '@/features/scene-models/components/IndoorMinimap';
import { type IndoorMap, type MapPlayer, playerLevel } from '@/features/scene-models/indoor-map/indoor-map';
import type { NavGridResult } from './useNavGridBuild';
import styles from './WalkMapPreview.module.scss';

// 模拟的步行：速度（米/秒）、转向（弧度/秒）、视场角（竖直 60°，按舞台的宽高比换成水平的）
const SPEED = 2.5;
const TURN_SPEED = Math.PI / 2;
const FOVY = Math.PI / 3;
// 模拟点击移动：落点在前方这么远
const TARGET_AHEAD = 10;

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName));
}

/**
 * 步行地图的组件预览（3D.4d）：不挂 Cesium，用真实的导航网格模拟一个人在走；右上角是小地图，点开是完整地图。
 * W/A/S/D、方向键行走转向（碰撞同真实的步行），"模拟点击移动"在前方 10 米放一个落点并走过去，完整地图里双击瞬移
 */
export const WalkMapPreview = defineComponent({
  name: 'WalkMapPreview',
  props: {
    result: { type: Object as PropType<NavGridResult>, required: true },
    model: { type: Object as PropType<SceneModel | null>, default: null }
  },
  setup(props) {
    const stage = ref<HTMLElement>();
    const opened = ref(false);
    const map = computed((): IndoorMap => {
      const { navigation, levels, plan } = props.result;
      return { grid: navigation.grid, north: navigation.frame.north, levels, plan };
    });
    // 出生点按清单（和真实的步行一样，相机在远处时用清单的出生点）
    const walker = computed(() => {
      const { grid, frame } = props.result.navigation;
      const spawn = props.model?.spawn;
      const pose = chooseSpawn(grid, {
        eye: [0, 0, 1000],
        eyeHeight: 1000,
        ground: null,
        yaw: 0,
        preferred: spawn
          ? { point: frame.toLocal(spawn.lng, spawn.lat, spawn.height), yaw: headingToYaw(spawn.heading, frame.north) }
          : null,
        groundHeight: frame.ground
      });
      return pose ? new Walker(grid, pose) : null;
    });
    const player = shallowRef<MapPlayer | null>(null);
    const keys = new Set<string>();
    let frame = 0;
    let last: number | null = null;

    const hfov = () => {
      const box = stage.value?.getBoundingClientRect();
      const aspect = box && box.height > 0 ? box.width / box.height : 16 / 9;
      return 2 * Math.atan(Math.tan(FOVY / 2) * aspect);
    };

    const publish = (current: Walker) => {
      const { x, y, floor } = current.position;
      const target = current.destination;
      const marked = target ? { x: target.x, y: target.y } : null;
      player.value = { x, y, floor, yaw: current.yaw, hfov: hfov(), target: marked };
    };

    const tick = (now: number) => {
      const current = walker.value;
      frame = requestAnimationFrame(tick);
      if (!current) {
        return;
      }
      const dt = last === null ? 0 : Math.min((now - last) / 1000, 0.1);
      last = now;
      const { forward, strafe, turn } = walkAxes(keys);
      current.turn(turn * TURN_SPEED * dt, 0);
      if (current.destination) {
        current.follow(SPEED * dt);
      } else {
        current.walk(forward, strafe, SPEED * dt);
      }
      const previous = player.value;
      const { x, y } = current.position;
      const moved = previous?.x !== x || previous.y !== y || previous.yaw !== current.yaw;
      if (!previous || moved || previous.target !== null) {
        publish(current);
      }
    };
    frame = requestAnimationFrame(tick);
    onScopeDispose(() => cancelAnimationFrame(frame));

    const onKey = (event: KeyboardEvent, down: boolean) => {
      if (opened.value || isEditable(event.target) || !WALK_KEYS.has(event.code)) {
        return;
      }
      event.preventDefault();
      if (down) {
        keys.add(event.code);
        walker.value?.cancelRoute();
      } else {
        keys.delete(event.code);
      }
    };
    const onKeydown = (event: KeyboardEvent) => onKey(event, true);
    const onKeyup = (event: KeyboardEvent) => onKey(event, false);
    const onBlur = () => keys.clear();
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('keyup', onKeyup);
    window.addEventListener('blur', onBlur);
    onScopeDispose(() => {
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('keyup', onKeyup);
      window.removeEventListener('blur', onBlur);
    });

    // 前方 10 米能站的地方当作点击的落点，按真实的规划走过去（看得见都算看得见）
    const simulateClick = () => {
      const current = walker.value;
      if (!current) {
        return;
      }
      const { x, y, floor } = current.position;
      const spot = current.grid.nearestWalkable(
        x + Math.sin(current.yaw) * TARGET_AHEAD,
        y + Math.cos(current.yaw) * TARGET_AHEAD,
        floor,
        { maxRadius: 3, tolerance: 0.6 }
      );
      if (!spot) {
        return;
      }
      const reachable = current.grid.componentOf(spot.index) === current.grid.componentAt(x, y, floor);
      const plan = planMove(current, { ...spot, direct: true }, reachable, () => true);
      if (plan.kind === 'teleport') {
        current.placeAt(plan.spot);
      } else {
        current.startRoute(plan.points, plan.kind === 'through');
      }
      publish(current);
    };

    const teleport = (spot: NavPoint) => {
      opened.value = false;
      walker.value?.placeAt(spot);
      const current = walker.value;
      if (current) {
        publish(current);
      }
    };

    return () => {
      const current = player.value;
      const level = current ? playerLevel(map.value, current) : null;
      return (
        <section class={styles.preview}>
          <div class={styles.bar}>
            <span>
              W/A/S/D、方向键行走转向（碰撞用真实的导航网格）· 点小地图打开完整地图 · 完整地图里双击瞬移
            </span>
            <ElButton size="small" disabled={!walker.value} onClick={simulateClick}>
              模拟点击移动
            </ElButton>
            {current && (
              <span class={styles.readout}>
                {level?.name ?? '-'} · 局部 {current.x.toFixed(1)}, {current.y.toFixed(1)} · 地板{' '}
                {current.floor.toFixed(2)} 米 · 朝向 {Math.round(yawToHeading(current.yaw, map.value.north)) % 360}°
              </span>
            )}
          </div>
          <div ref={stage} class={styles.stage}>
            <span class={styles.placeholder}>三维画面</span>
            {!walker.value && <span class={styles.placeholder}>附近找不到出生点</span>}
            {current && (
              <div class={styles.minimap}>
                <IndoorMinimap map={map.value} player={current} onOpen={() => (opened.value = true)} />
              </div>
            )}
            {current && opened.value && (
              <IndoorMapDialog
                map={map.value}
                player={current}
                onTeleport={teleport}
                onClose={() => (opened.value = false)}
              />
            )}
          </div>
        </section>
      );
    };
  }
});
