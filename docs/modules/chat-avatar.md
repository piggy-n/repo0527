# 对话头像（shared/chat-avatar）

AI 助手和用户在对话里的圆形头像：助手是主色圆底上的机器人位图，用户是浅主色圆底上的"我"。AI 对话（`features/ai-chat`）和城市国土空间监测指标AI计算（`features/indicator-simulation`）共用，2026-10-29 从 `features/ai-chat/images/` 上移（ADR 0109）：features 之间不能互相导入，第二个使用方出现后上移到 shared。

```
shared/chat-avatar/
├─ ChatAvatar.tsx         speaker（'assistant' | 'user'）、size（圆底直径，默认 32）
├─ ChatAvatar.module.scss 圆底、"我"的字号与颜色
└─ assistant.webp         机器人：用户给的位图按 2 倍尺寸转成 96 × 90 的 WebP（ADR 0102）
```

```tsx
<ChatAvatar speaker="assistant" size={56} />
<ChatAvatar speaker="user" size={24} />
```

- 机器人的宽度约为圆底的 72%，取双数：56 → 40、44 → 32、32 → 24、24 → 18、20 → 14；高度按图片比例
- 底色：助手 `--color-primary`（ADR 0103），用户 `--color-primary-bg` 配主色文字、600 字重、12 号字
- 头像只是装饰（`aria-hidden`），说话的人由旁边的文字或位置表达；外边距、阴影、动画由使用方用 `class` 加
- 机器人是位图，不是单色图标，不进 `assets/icons/`、不经 `SvgIcon`（ADR 0102 第 7 节）

用到的地方：AI 对话的欢迎语（56）和消息（32）；AI计算页条件配置的列标题（20）、AI计算节点（44）、按指令配置时的状态（20）、时间线上的对话（24）、看结果时输入框下的回复（20）。
