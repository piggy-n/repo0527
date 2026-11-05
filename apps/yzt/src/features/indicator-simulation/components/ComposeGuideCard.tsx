import { ElButton } from 'element-plus';
import { defineComponent, type PropType, type VNodeChild } from 'vue';
import { ChatAvatar } from '@/shared/chat-avatar/ChatAvatar';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import type { ComposeGuide } from '../compose/guide';
import { AreaFilePicker } from './AreaFilePicker';
import { CityPicker } from './CityPicker';
import styles from './ComposeGuideCard.module.scss';
import { RichText } from './RichText';

/**
 * 引导卡（ADR 0129）：AI 在输入框上方问还缺什么、哪里有冲突，并给出可以直接点的回答；
 * 选项发出的话和用户自己回复走同一条路。内容由 compose/guide.ts 推导，这里只显示
 */
export const ComposeGuideCard = defineComponent({
  name: 'ComposeGuideCard',
  props: {
    guide: { type: Object as PropType<ComposeGuide>, required: true }
  },
  emits: {
    say: (words: string) => words !== '',
    upload: (files: File[]) => files.length > 0,
    draw: () => true,
    cities: (cityCodes: readonly string[]) => cityCodes.length > 0,
    start: () => true
  },
  setup(props, { emit }) {
    const say = (label: string, words: string) => (
      <button key={label} type="button" class={styles.chip} onClick={() => emit('say', words)}>
        {label}
      </button>
    );

    const renderCities = () => [
      say('全省', '全省'),
      <CityPicker key="cities" onPick={cityCodes => emit('cities', cityCodes)}>
        {{
          reference: ({ open }: { readonly open: boolean }) => (
            <button type="button" class={styles.chip} aria-haspopup="dialog" aria-expanded={open}>
              <SvgIcon name="simulation-region" />
              选择城市
            </button>
          )
        }}
      </CityPicker>
    ];

    const renderArea = () => [
      <AreaFilePicker key="upload" onPick={files => emit('upload', files)}>
        {{
          default: ({ open }: { readonly open: () => void }) => (
            <button type="button" class={styles.chip} onClick={open}>
              <SvgIcon name="file-upload" />
              上传文件
            </button>
          )
        }}
      </AreaFilePicker>,
      <button key="draw" type="button" class={styles.chip} onClick={() => emit('draw')}>
        <SvgIcon name="geometry-polygon" />
        地图绘制
      </button>
    ];

    // 问范围时：已有的范围放最前面，正在用哪一种就先给哪一种的入口
    const renderActions = (): VNodeChild => {
      const { guide } = props;
      switch (guide.kind) {
        case 'conflict':
          return guide.options.map(option => say(option.label, option.say));
        case 'ready':
          return (
            <ElButton type="primary" size="small" onClick={() => emit('start')}>
              开始计算
            </ElButton>
          );
        case 'missing':
          return null;
        case 'scope':
          break;
      }
      const groups = guide.scopeKind === 'area' ? [renderArea(), renderCities()] : [renderCities(), renderArea()];
      const memory = guide.options.map(option => say(option.label, option.say));
      const row: VNodeChild[] = [...memory];
      for (const [index, group] of groups.entries()) {
        if (index > 0 || memory.length > 0) {
          row.push(<i key={`gap-${index}`} class={styles.gap} />);
        }
        row.push(...group);
      }
      return row;
    };

    return () => {
      const { guide } = props;
      const actions = renderActions();
      return (
        <div class={[styles.root, guide.kind !== 'ready' && styles.asking]} data-guide role="status">
          <ChatAvatar speaker="assistant" size={24} />
          <p class={styles.text}>
            {guide.lead && <span class={guide.lead.tone === 'known' ? styles.known : undefined}>{guide.lead.text}</span>}
            <RichText text={guide.question} />
            {guide.more > 0 && <span class={styles.more}>（还有 {guide.more} 项）</span>}
          </p>
          {actions !== null && <div class={styles.actions}>{actions}</div>}
        </div>
      );
    };
  }
});
