# 表格的加载状态（shared/table）

对应目录：`apps/web/src/shared/table/`；样式在 `apps/web/src/app/styles/element-theme.scss` 的表格部分。

## 三种情况

列表页按"表格里正在显示什么"决定怎么提示加载：

| 情况 | 例子 | 界面 | 判断（Vue Query） |
|---|---|---|---|
| 没有可显示的数据，正在请求 | 首次进入、切到没看过的分类、加载失败后重试 | 骨架屏 `TableSkeleton`，立即显示 | `isLoading` |
| 显示着旧数据，正在等新数据 | 翻页、换条件查询（上一次的数据作为占位）；条件没变时点"查询" | 遮罩 `v-loading`，用 `useDelayedFlag` 延迟显示 | `isPlaceholderData`，或主动刷新中 |
| 显示的就是当前条件的缓存，后台重新请求 | 切回看过的分类、重置回看过的条件、删除后刷新列表 | 不提示，新数据到了直接替换 | 其余的 `isFetching` |

为什么这样分：第一版的遮罩跟着 `isFetching` 走，缓存的数据已经正确显示了，后台重新请求时仍然盖上遮罩，慢网络下看起来是"数据 → 加载 → 又是同样的数据"（3.3 验收时发现，用 2 秒延迟复现）。遮罩的意思是"这些数据已经过时，新的马上到"，只有显示的确实是旧数据时才需要。

- 骨架屏不延迟：没有数据时表体本来就是空的，立即显示骨架不会闪；数据到了在原位替换，行高相同，不跳动
- 遮罩延迟 300ms 显示（`useDelayedFlag` 的默认值）：内网请求通常更快，快的时候不出遮罩。慢网络下会看到"旧数据 → 0.3 秒后出遮罩 → 新数据"，这是保留旧数据的代价，换来表格不会先变空再撑开
- 条件没变时点"查询"：查询键没变，Vue Query 不会重新请求；用户点查询是想看最新的数据，所以主动 `refetch`，按"显示着旧数据"处理（出遮罩）
- 连续点击：Vue Query 会取消前一次请求，但前一次 `refetch` 返回的 Promise 要等最新的请求完成才结束，所以"主动刷新中"用一个布尔值就够了。这是 Vue Query 的行为，有测试覆盖，升级时留意

写法见 `features/file-management/composables/useFileList.ts`（`initialLoading`、`refreshing`、`refresh`）和 `components/FileTable.tsx`。

## TableSkeleton

```tsx
import { ElTable, vLoading } from 'element-plus';
import { TableSkeleton } from '@/shared/table/TableSkeleton';

// TSX 中的指令按名字查找，要在组件里局部注册：directives: { loading: vLoading }
const showMask = useDelayedFlag(() => props.refreshing);

<ElTable data={props.files} height="100%" v-loading={showMask.value}>
  {{
    default: () => [/* 各列 */],
    empty: () => {
      if (props.initialLoading) {
        return <TableSkeleton />;
      }
      if (props.error) {
        return /* 加载失败 + 重试 */;
      }
      return '暂无数据';
    }
  }}
</ElTable>
```

- 放在 `empty` 插槽里：表头和分页不动，只有表体显示骨架
- 20 行，每行高 48，与默认尺寸的纯文字数据行相同（含 1px 分隔线；带 `ElTag` 的行约 49）；铺满表体后多出的行被裁掉
- 每行的长度按 100%、92%、96%、88% 循环，看起来更像内容；没有参数
- 样式在 `element-theme.scss`：Element 的空状态区域默认只占一半宽度、行高 60，用 `.el-table__empty-text:has(> .table-skeleton)` 撑开；骨架的行高和表格的行高规则写在一起，改一处时同步改另一处

不采用的做法：

| 做法 | 问题 |
|---|---|
| 把整个表格换成 `ElSkeleton` | 表头消失，数据到了表头再出现，界面跳动 |
| 用假数据行渲染真实的列，每个单元格显示骨架条 | 骨架能和列对齐，但每个自定义插槽都要处理假数据，行的类型也要放宽 |
| 每行按列分成几段骨架条 | 拿不到列宽，分段和表头对不齐，反而显得乱 |
