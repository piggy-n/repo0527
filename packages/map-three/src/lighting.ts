import type { TilesetLighting } from '@mx/map-core';
import {
  AmbientLight,
  Color,
  DirectionalLight,
  DoubleSide,
  type Material,
  type Mesh,
  MeshBasicMaterial,
  type Object3D,
  type Texture
} from 'three';

// 瓦片集的两种光照（ADR 0081 第 3 节、ADR 0147 第 5 节）：地面上的按太阳，地下、室内用以相机为光源的头灯

/**
 * 太阳：环境光加一个固定方向的平行光（局部系里东南方向、高度角 50°）。Cesium 按当前时刻的太阳，
 * 三维里看不出时刻，这里不跟（3C.1 的差别，见 docs/modules/map-three.md）
 */
export function createSunLights(): Object3D[] {
  const sun = new DirectionalLight(0xffffff, 2);
  const elevation = (50 * Math.PI) / 180;
  const azimuth = (150 * Math.PI) / 180;
  // 局部系 x 东、y 上、z 南；方位角从正北顺时针
  sun.position.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation));
  return [new AmbientLight(0xffffff, 1.6), sun];
}

const HEADLIGHT_SHADER_KEY = 'mx-headlight';

/** 头灯按距离压暗远处的开关（0 关、1 开）：一个渲染器里所有头灯材质共用这一个 uniform */
export interface FogUniform {
  value: number;
}

/**
 * 头灯（从 map-cesium 的 scene-tilesets 移植）：不受场景光照影响，正对视线的面亮、斜掠的面暗，和时间无关；
 * 法线用视点坐标的屏幕空间导数求，材质双面。步行时 15～180 米之间把远处压到 0.45（uFog，同 Cesium）
 */
function headlightVariant(source: Material, fog: FogUniform): MeshBasicMaterial {
  const variant = new MeshBasicMaterial({ side: DoubleSide });
  const { map, color, vertexColors, transparent, opacity, alphaTest } = source as Material & {
    map?: Texture | null;
    color?: Color;
  };
  variant.map = map ?? null;
  variant.color = color?.clone() ?? new Color(0xffffff);
  variant.vertexColors = vertexColors;
  variant.transparent = transparent;
  variant.opacity = opacity;
  variant.alphaTest = alphaTest;
  variant.onBeforeCompile = shader => {
    shader.uniforms.uFog = fog;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHeadlightPosition;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvHeadlightPosition = mvPosition.xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHeadlightPosition;\nuniform float uFog;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 normalView = normalize(cross(dFdx(vHeadlightPosition), dFdy(vHeadlightPosition)));
          float facing = abs(dot(normalView, normalize(-vHeadlightPosition)));
          float fog = mix(1.0, 0.45, smoothstep(15.0, 180.0, length(vHeadlightPosition)) * uFog);
          diffuseColor.rgb *= (0.5 + 0.5 * facing) * fog * 1.15;
        }`
      );
  };
  variant.customProgramCacheKey = () => HEADLIGHT_SHADER_KEY;
  return variant;
}

/** 一个瓦片集里各个网格的材质：原来的材质留着，头灯时换成变体，变体按原材质缓存 */
export class TilesetMaterials {
  readonly #originals = new WeakMap<Mesh, Material | Material[]>();
  readonly #variants = new Map<Material, MeshBasicMaterial>();
  readonly #fog: FogUniform;

  /** fog 是渲染器共用的远处压暗开关 */
  constructor(fog: FogUniform) {
    this.#fog = fog;
  }

  /** 新加载的模型：记下原来的材质、改成双面（Cesium 一侧关掉了背面剔除），按光照换上 */
  adopt(model: Object3D, lighting: TilesetLighting): void {
    model.traverse(object => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) {
        return;
      }
      this.#originals.set(mesh, mesh.material);
      for (const material of [mesh.material].flat()) {
        material.side = DoubleSide;
      }
    });
    this.apply(model, lighting);
  }

  /** 按光照换材质 */
  apply(root: Object3D, lighting: TilesetLighting): void {
    root.traverse(object => {
      const mesh = object as Mesh;
      const original = mesh.isMesh ? this.#originals.get(mesh) : undefined;
      if (!original) {
        return;
      }
      mesh.material =
        lighting === 'headlight'
          ? Array.isArray(original)
            ? original.map(material => this.#variant(material))
            : this.#variant(original)
          : original;
    });
  }

  /** 模型卸载时释放它的变体；原来的材质、纹理由瓦片库释放 */
  release(model: Object3D): void {
    model.traverse(object => {
      const mesh = object as Mesh;
      const original = mesh.isMesh ? this.#originals.get(mesh) : undefined;
      for (const material of original ? [original].flat() : []) {
        this.#variants.get(material)?.dispose();
        this.#variants.delete(material);
      }
    });
  }

  dispose(): void {
    for (const variant of this.#variants.values()) {
      variant.dispose();
    }
    this.#variants.clear();
  }

  #variant(material: Material): MeshBasicMaterial {
    let variant = this.#variants.get(material);
    if (!variant) {
      variant = headlightVariant(material, this.#fog);
      this.#variants.set(material, variant);
    }
    return variant;
  }
}
