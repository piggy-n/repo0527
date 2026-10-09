import { type CameraState, CameraModel } from '../camera/camera-model';
import { StyleModel, type StyleRoot } from '../style/style-model';

export interface MapSessionOptions<G extends string> {
  /** 样式分组的叠放顺序，从下到上 */
  readonly groups: readonly G[];
  readonly root?: StyleRoot;
  readonly camera: CameraState;
}

/** 地图会话：二维和三维共同的唯一真相源（ADR 0020）；tool、selection 在做交互工具时加入 */
export class MapSession<const G extends string> implements Disposable {
  readonly style: StyleModel<G>;
  readonly camera: CameraModel;
  readonly #stack: DisposableStack;

  constructor({ groups, root, camera }: MapSessionOptions<G>) {
    // 构造中途抛错时，已创建的部分随 using 释放；成功后用 move 把所有权转给实例
    using stack = new DisposableStack();
    this.style = stack.use(new StyleModel({ groups, root }));
    this.camera = stack.use(new CameraModel(camera));
    this.#stack = stack.move();
  }

  /** 按创建的相反顺序释放各部分 */
  [Symbol.dispose](): void {
    this.#stack.dispose();
  }
}
