import { ArrowDown, ArrowRight, Download, Loading, Minus, Plus, Warning } from '@element-plus/icons-vue';
import { MxTitle } from '@yzt/ui';
import { ElButton, ElDialog, ElIcon, ElProgress, ElTag } from 'element-plus';
import { defineComponent, ref, useId, type PropType } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import type { useDocumentPreview, useDownloadPreview } from './useTransferPreview';
import styles from './transfer-preview.module.scss';

type DownloadModel = ReturnType<typeof useDownloadPreview>;
type DocumentModel = ReturnType<typeof useDocumentPreview>;

// TXT 固定内容只验证换行与阅读，不读取磁盘文件
const exampleText = [
  '调查成果目录说明', '', '一、成果组成', '01  调查范围与工作说明', '02  成果清单与质量检查记录', '03  汇交材料与附表',
  '', '二、备注', '这是固定文本示例，用于确认阅读、换行和关闭交互。', '',
  '长行示例：江苏省自然资源统一调查监测成果质量检查与汇交说明及附表（征求意见稿），正文自动换行，完整内容可在阅读区滚动查看。'
].join('\n');

/** 列表外的紧凑进度区，筛选不会隐藏正在接收的任务 */
export const DownloadPreviewPanel = defineComponent({
  name: 'DownloadPreviewPanel',
  props: { model: { type: Object as PropType<DownloadModel>, required: true } },
  setup(props) {
    // 展开状态只由用户改变，新增、完成或失败都不自动展开
    const expanded = ref(false);
    const listId = useId();
    return () => props.model.tasks.value.length > 0 && <section class={styles.downloads} aria-label="下载进度">
      <div class={styles.taskHeading}>
        <MxTitle class={styles.downloadTitle} level="section">
          下载进度 <span class={styles.count}>{props.model.tasks.value.length}</span>
        </MxTitle>
        <span class={styles.summary} role="status">
          进行中 {props.model.tasks.value.filter(task => props.model.isReceiving(task.file.id)).length}
          {' · '}失败 {props.model.tasks.value.filter(task => task.phase === 'error').length}
        </span>
        <ElButton
          link
          type="primary"
          size="small"
          icon={expanded.value ? ArrowDown : ArrowRight}
          aria-expanded={expanded.value}
          aria-controls={listId}
          onClick={() => { expanded.value = !expanded.value; }}
        >{expanded.value ? '收起' : '展开'}</ElButton>
        {expanded.value && <ElButton
          link
          type="primary"
          size="small"
          disabled={props.model.tasks.value.every(task => props.model.isReceiving(task.file.id))}
          onClick={props.model.clearFinished}
        >清除已结束</ElButton>}
      </div>
      {expanded.value && <div id={listId} class={styles.tasks}>
        {props.model.tasks.value.map(task => <div key={task.file.id} class={styles.task}>
          <div class={styles.filename}>{task.file.name}</div>
          <div class={styles.taskDetails}>
            <div class={styles.taskStatus} role="status">
              {task.phase === 'receiving' && (task.unknown
                ? `正在接收 · 已接收 ${(task.received / 20).toFixed(1)} MB（总量未知）`
                : `正在接收 · ${task.received}%`)}
              {task.phase === 'checking' && '文件已接收，正在检查下载内容'}
              {task.phase === 'done' && <span class={styles.success}>已交给浏览器保存</span>}
              {task.phase === 'cancelled' && '已取消本次下载'}
              {task.phase === 'error' && <span class={styles.error}>下载失败，请重试</span>}
            </div>
            <ElButton
              link
              type="primary"
              size="small"
              onClick={() => {
                if (props.model.isReceiving(task.file.id)) {
                  props.model.cancel(task);
                } else {
                  props.model.start(task.file);
                }
              }}
            >{props.model.isReceiving(task.file.id) ? '取消' : task.phase === 'done' ? '重新下载' : '重试'}</ElButton>
          </div>
          {task.phase === 'receiving' && !task.unknown
            && <ElProgress class={styles.progress} percentage={task.received} showText={false} />}
        </div>)}
      </div>}
    </section>;
  }
});

/** 只演示阅读区域与交互，文档分页和图片均为固定内容 */
const ExampleContent = defineComponent({
  name: 'ExampleContent',
  props: { type: { type: String, required: true }, zoom: { type: Number, required: true } },
  setup(props) {
    return () => props.type === 'txt'
      ? <pre class={styles.text}>{exampleText}</pre>
      : ['docx', 'pdf'].includes(props.type)
        ? <div class={styles.pages} style={{ zoom: props.type === 'docx' ? props.zoom / 100 : 1 }}>
          {[1, 2].map(page => <article key={page} class={styles.paper}>
            <div class={styles.paperMeta}>调查监测 / 文件示例</div>
            <h2>{page === 1 ? '自然资源调查成果说明' : '成果清单与汇交要求'}</h2>
            <p class={styles.paperSubtitle}>2026 年度 · 固定排版示意</p>
            <h3>{page === 1 ? '一、编制说明' : '三、汇交说明'}</h3>
            <p>本页为交互原型的固定示例，用于检查阅读区域、滚动和缩放。真实文件的内容与分页在正式页面验证。</p>
            <p>调查成果按业务分类组织，提交时填写年份、业务类型标签及必要备注，确保目录清晰、文件名称完整。</p>
            <h3>{page === 1 ? '二、成果组成' : '四、检查记录'}</h3>
            <table><thead><tr><th>序号</th><th>材料名称</th><th>状态</th></tr></thead>
              <tbody>{['技术说明', '成果清单', '质量检查记录'].map((label, index) =>
                <tr key={label}><td>{index + 1}</td><td>{label}</td><td>示例</td></tr>
              )}</tbody>
            </table>
            <p>文件仅供交互设计确认，不代表 DOCX 或 PDF 的真实渲染效果。</p>
            <footer>{page} / 2</footer>
          </article>)}
        </div>
        : <div class={styles.imageExample} style={{ width: `${props.zoom}%`, maxWidth: `${props.zoom * 8}px` }}>
          <svg viewBox="0 0 800 500" role="img" aria-label="调查区域示意图（固定图片示例）">
            <rect width="800" height="500" fill="#eef3f6" />
            <path
              d="M80 120L320 60 440 160 700 110 730 360 480 440 260 360 100 410Z"
              fill="#d8e7d5"
              stroke="#8fae88"
              stroke-width="3"
            />
            <path d="M320 60L260 360M440 160L480 440M100 250L700 260" fill="none" stroke="#8fae88" stroke-width="2" />
            <path d="M600 0Q420 150 520 260T400 500" fill="none" stroke="#8fbdd6" stroke-width="22" />
            <circle cx="330" cy="240" r="10" fill="#307fe2" />
            <text x="350" y="246" fill="#334155" font-size="20">调查点位（示例）</text>
            <text x="40" y="465" fill="#64748b" font-size="16">固定示意图 · 不加载地图或业务数据</text>
          </svg>
        </div>;
  }
});

/** 本轮预览排版提案，固定内容不替代正式文件解析验收 */
export const DocumentPreviewDialog = defineComponent({
  name: 'DocumentPreviewDialog',
  props: {
    model: { type: Object as PropType<DocumentModel>, required: true },
    downloads: { type: Object as PropType<DownloadModel>, required: true }
  },
  setup(props) {
    const loading = useDelayedFlag(() => props.model.visible.value
      && ['reading', 'rendering'].includes(props.model.phase.value));
    return () => {
      const model = props.model;
      const file = model.file.value;
      const type = file?.type.toLowerCase() ?? '';
      const receiving = file ? props.downloads.isReceiving(file.id) : false;
      return <ElDialog
        class={styles.dialog}
        title="文件预览"
        width="1120px"
        top="4vh"
        appendToBody
        modelValue={model.visible.value}
        beforeClose={done => { model.close(); done(); }}
        closeOnClickModal={false}
      >
        {{
          header: () => <MxTitle level="panel">文件预览</MxTitle>,
          default: () => file && <div class={styles.reader}>
            <div class={styles.fileHeading}>
              <div class={styles.filename}>
                <span>{file.name}</span><ElTag size="small" type="info">{file.type.toUpperCase()}</ElTag>
              </div>
            </div>
            {model.phase.value === 'ready' && !['txt', 'pdf'].includes(type) && <div class={styles.toolbar}>
              <div class={styles.zoom}>
                <ElButton
                  class={styles.zoomButton}
                  size="small"
                  icon={Minus}
                  aria-label="缩小"
                  disabled={model.zoom.value <= 50}
                  onClick={() => { model.zoom.value -= 25; }}
                />
                <span>{model.zoom.value}%</span>
                <ElButton
                  class={styles.zoomButton}
                  size="small"
                  icon={Plus}
                  aria-label="放大"
                  disabled={model.zoom.value >= 150}
                  onClick={() => { model.zoom.value += 25; }}
                />
                {type !== 'docx' && <ElButton size="small" onClick={() => { model.zoom.value = 100; }}>
                  适合宽度
                </ElButton>}
              </div>
            </div>}
            <div class={styles.viewport} aria-label="文件阅读区" aria-busy={loading.value}>
              {loading.value && <div class={styles.center} role="status">
                <ElIcon size={40} class="is-loading"><Loading /></ElIcon>
                <strong>{model.phase.value === 'reading' ? '正在读取文件…' : '正在准备预览…'}</strong>
                <span>关闭窗口可停止本次预览</span>
              </div>}
              {model.phase.value === 'error' && <div class={styles.center} role="alert">
                <ElIcon size={40}><Warning /></ElIcon>
                <strong>{model.failure.value}</strong>
                <span>文件列表和已开始的下载不受影响</span>
                <ElButton type="primary" onClick={model.retry}>重新加载</ElButton>
              </div>}
              {model.phase.value === 'ready' && <ExampleContent key={file.id} type={type} zoom={model.zoom.value} />}
            </div>
          </div>,
          footer: () => <div class={styles.footer}>
            <div>
              <ElButton onClick={model.close}>关闭</ElButton>
              <ElButton
                type="primary"
                icon={Download}
                disabled={!file || receiving}
                onClick={() => { if (file) { props.downloads.start(file); } }}
              >
                {receiving ? '正在下载' : '下载文件'}
              </ElButton>
            </div>
          </div>
        }}
      </ElDialog>;
    };
  }
});
