# 项目统一代码规范

适用于 JavaScript、TypeScript、JSX、TSX，以及项目脚本中的 MJS、CJS、MTS、CTS 文件。

本规范描述目标风格。根目录 `.editorconfig` 保存 WebStorm 当前能够配置的规则，随 Git 共享；未被自动格式化完整覆盖的情况仍按本文检查。

## 当前工具配置

- 格式以 `.editorconfig` 和 WebStorm 内置格式化器为准，项目没有 Prettier，也没有项目级 WebStorm Code Style 配置
- 本机 WebStorm 2026.1 的用户 Code Style 为默认方案，没有自定义规则
- lint 由 oxlint 负责（ADR 0006），只检查代码质量、类型相关问题和依赖方向，不包含任何格式类规则，配置说明见 [config/oxlintrc.md](config/oxlintrc.md)
- CI 不检查格式，提交前需要在 WebStorm 中格式化
- `.idea/` 继续忽略，不提交个人工作区、窗口布局等 IDE 文件
- 本次不安装 lint-staged、Husky，不添加 Git hooks 或提交时自动格式化

WebStorm 默认启用 EditorConfig。打开项目后，`.editorconfig` 中的规则会覆盖对应的 IDE Code Style 选项；没有配置的项目仍使用原有设置。

检查入口：Settings > Editor > Code Style > Enable EditorConfig support。可以在 `.editorconfig` 中使用预览功能查看受影响文件，然后执行 Reformat Code。

`ij_*` 是 JetBrains 扩展属性，其他编辑器可能只识别缩进、字符集等基础属性。共享这个文件并不等于所有编辑器都已具备相同的自动修复能力。

## 基础风格

- 使用 UTF-8，保留中文原文，不转换成 Unicode 转义
- 使用 2 个空格缩进，续行同样缩进 2 个空格，不使用 Tab
- 使用 120 列作为自动换行参考，无法拆分的字符串等不为满足列宽而改变语义
- JavaScript / TypeScript 字符串使用单引号；JSX 静态属性使用双引号
- 能添加分号的语句统一以分号结尾，包括变量声明、表达式语句、return 等
- 不在 `if`、函数声明等块的右大括号后额外添加无意义的分号
- 所有 `if` / `else` 分支使用大括号，`else if` 保持通常的连续写法
- 中文注释简洁说明用途或复杂逻辑，结尾不加句号
- 保留已有文件的换行类型，不批量改写 LF / CRLF；`.editorconfig` 不强制 `end_of_line`

```javascript
const name = 'test';
foo();

if (visible) {
  show();
} else {
  hide();
}
```

## 空格与逗号

单行对象、对象解构、命名导入和对象类型的非空花括号内侧各保留一个空格。数组和数组解构的方括号内侧不添加额外空格，逗号后保留一个空格。

```javascript
import { useRef } from 'react';

const { x, y } = data;
const options = { visible: true, size: 24 };
const [first, second] = items;
```

对象、数组、解构、导入、函数参数和调用参数的最后一项不保留尾随逗号。移除逗号的前提是语法允许；例如 TSX 泛型箭头函数中的 `<T,>` 可能用逗号消除 JSX 解析歧义，不能机械删除。

## 换行原则

短列表能保持单行时使用单行。因长度、嵌套内容或可读性需要换行后，整个列表进入多行布局：第一项从下一行开始，每项独占一行，闭合括号单独占一行。

适用于函数声明参数、函数调用参数、对象属性、对象解构、数组元素、数组解构以及命名导入 / 导出项。

```typescript
const handleRndResize: RndResizeCallback = (
  e,
  dir,
  elementRef,
  delta,
  position
) => {
  resize(elementRef, delta);
};
```

```javascript
const {
  name,
  age,
  address
} = user;

import {
  useMemo,
  useRef,
  useState
} from 'react';

const [
  firstElementWithLongDescriptiveName,
  secondElementWithLongDescriptiveName,
  thirdElementWithLongDescriptiveName
] = items;
```

不要采用第一项留在起始行、后续项再换行的布局，也不要在多行列表中把若干项挤到同一行。多行示例展示的是已经决定换行后的布局，不要求所有短列表也强制展开。

WebStorm 对应设置为 Wrapping and Braces 中的 Chop down if long，函数参数同时启用左括号后换行、右括号独占一行，取消多行参数按列对齐，使用固定续行缩进。

## JSX / TSX

### 标签属性：短的保持单行，换行就按统一格式

开始标签（从 `<` 到 `>`）能在一行内写清楚时，保持单行，不强制拆成多行：

```tsx
<ElButton type="primary" onClick={goHome}>
  返回首页
</ElButton>

<ElResult icon="warning" title="404" subTitle="页面不存在">
<ElTableColumn prop="region" label="行政区" />
<path d={outline.path} fill="currentColor" />
```

同时满足以下条件时保持单行：

- 整行不超过 120 列
- 属性值都是简单表达式：字面量、变量、成员访问、函数引用（如 `onClick={goHome}`）
- 属性不多，一眼能看完，一般不超过 3～4 个

出现以下任一情况就换行：

- 超过 120 列
- 属性值是多行内容：带函数体的箭头函数、多行的对象字面量、嵌套的 JSX。写在一行的简短对象和单个表达式的箭头函数不算，例如 `style={{ fontWeight: weight }}`、`onClick={() => void confirmDelete()}`
- 属性较多，写在一行难以阅读

一旦决定换行，就按统一格式，不能只换一部分：

- 第一个属性从标签下一行开始，每个属性独占一行
- 多行开始标签的 `>` 或 `/>` 单独占一行，与 `<` 所在行的缩进一致
- 多行对象属性值以及 `{...rest}` 也属于属性布局的一部分，不挤在前一个属性后
- 不要让第一个属性留在标签名后面、其余属性再换行，也不要把几个属性挤在同一行

```tsx
// 错误：第一个属性留在标签名后面
<ElInput modelValue={keyword.value}
  placeholder="请输入关键字"
/>

// 正确
<ElInput
  modelValue={keyword.value}
  onUpdate:modelValue={(value: string) => {
    keyword.value = value;
  }}
  placeholder="请输入关键字"
/>
```

### 子元素与其他

- 带属性的元素，文字子元素一般另起一行（如上面的 `ElButton`）；没有属性或很短的元素可以写在一行，例如 `<ElButton>默认</ElButton>`、`<ElTag type={type}>{type}</ElTag>`
- 单行自闭合标签的 `/` 前保留一个空格，不写成 `<UIWrapper/>`
- 多行 JSX 返回值使用 `return (`，JSX 从下一行开始，最后使用 `);`
- JSX 条件表达式按下例保留清楚的层次；不要为了格式化改变文字节点或空白的实际含义

```tsx
return (
  <svg
    className={c(s.container, className)}
    style={{
      width: size ? `${size}px` : undefined,
      height: size ? `${size}px` : undefined,
      transform: rotate ? `rotate(${rotate}deg)` : undefined,
      ...style
    }}
    {...rest}
  >
    {
      title &&
      <title>{title}</title>
    }
    <use
      xlinkHref={`#ws-${name}`}
      fill={fill}
      style={useEleStyles}
    />
  </svg>
);
```

上例中 `svg` 的属性值包含多行对象，所以换行；`use` 只有三个简单属性，写成单行 ``<use xlinkHref={`#ws-${name}`} fill={fill} style={useEleStyles} />`` 同样符合规范。

WebStorm 的 JSX / TSX 标签属性排版复用 HTML Code Style：Wrap attributes、New line before first attribute、New line after last attribute 和 Space inside empty tag。因此 `.editorconfig` 中的 `ij_html_*` 设置仅作用于 JSX / TSX 文件。

`.editorconfig` 中对应的设置和上面的规则一致，不需要修改：

| 设置 | 值 | 含义 |
|---|---|---|
| `ij_html_attribute_wrap` | `on_every_item` | Chop down if long：超过 120 列才把属性拆成每行一个，短标签保持单行 |
| `ij_html_new_line_before_first_attribute` | `when_multiline` | 只在属性拆行时，第一个属性才移到下一行 |
| `ij_html_new_line_after_last_attribute` | `when_multiline` | 只在属性拆行时，`>` 才单独一行 |
| `ij_html_keep_line_breaks` | `true` | 保留手动拆开的换行 |

按这组设置，120 列以内"拆不拆"由人按上面的标准判断，格式化器不会强制拆开，也会保留手动拆开的换行。实际格式化结果仍以下文"自动格式化的已知边界"为准，格式化后需要复核。

## 优先使用有语义的解构

读取数组固定位置、元组或正则匹配结果时，优先通过解构给元素命名。读取匹配结果附带的 `index` 等属性时，使用对象解构。

```javascript
// 解构匹配结果中的完整字段、版本文本及起始位置
const [field] = versionFields;
const [matchedField, quotedVersion] = field;
const { index } = field;
const offset = index + matchedField.length - quotedVersion.length;
```

跳过正则完整匹配、读取第一个捕获组：

```javascript
// 正则结果首项为完整匹配，第二项为大版本号
const [, majorVersion] = versionMatch;
```

解构是一项编码规范，普通格式化操作不会把索引访问自动重构成解构。不要为了统一写法改动动态索引、改变变量作用域或降低可读性。

## 自动格式化的已知边界

已使用本机 WebStorm 2026.1.2 命令行格式化器验证 JS、TS、JSX、TSX 样例。花括号空格、分号、去尾逗号、`if` 大括号、函数参数换行、导入换行、普通长 JSX 属性列表和自闭合标签空格可以按配置处理。

实测仍需人工复核以下情况：

- 数组或对象解构的括号已经换行，但内部元素合起来仍短于 120 列时，格式化器可能把多个元素放在同一行
- JSX 属性包含多行 `style` 对象时，格式化器可能合并相邻属性，或把展开属性放在前一项后
- JSX 条件表达式的独立花括号布局，以及 `return (` 后的换行，可能被重新排列

`Keep line breaks` 已开启以尽量保留已有布局，但本机版本对以上结构仍可能重排。不要将“命令执行成功”理解为所有目标规则都已被自动保证。必要时按示例整理；必须逐字保留的局部布局可以用 `// @formatter:off` 与 `// @formatter:on` 包住整个相关语句，避免覆盖大段业务代码。

这些是当前工具覆盖范围的限制，不是规范允许混排。后续接入检查工具时，要把这些样例作为验收用例。

## 后续接入格式化工具

本次不建立提交时自动格式化流程。未来接入时应先完成手动检查和修复，再决定是否加入 lint-staged / Husky。

Prettier 可以对应配置 `semi: true`、`trailingComma: 'none'`、`bracketSpacing: true`、`singleQuote: true`、`tabWidth: 2`、`printWidth: 120`、`bracketSameLine: false`、`endOfLine: 'auto'`，但这些选项不足以保证本文所有条件换行规则，也不会给省略大括号的 `if` 增加大括号。

不要直接开启 `singleAttributePerLine: true` 来代替“换行后每个属性一行”，它还可能拆开原本能放在一行的多属性标签。不要同时让 WebStorm、Prettier 和 lint 修复器争夺同一类排版规则。

ADR 0006 已决定 lint 不开启格式类规则（包括 `curly`）：`if` / `else` 的大括号由 `.editorconfig` 的 `ij_any_if_brace_force = always` 在格式化时补上，空格、分号和逗号等格式规则也只由 WebStorm 负责。以后如果要在 CI 中检查格式，应先用本文样例验证所选工具，不能假设默认配置即可实现。

参考：

- [WebStorm：项目 Code Style 与 EditorConfig](https://www.jetbrains.com/help/webstorm/configuring-code-style.html)
- [WebStorm：JavaScript Code Style](https://www.jetbrains.com/help/webstorm/settings-code-style-javascript.html)
- [WebStorm：命令行格式化](https://www.jetbrains.com/help/webstorm/command-line-formatter.html)
- [Prettier：格式选项](https://prettier.io/docs/options)
