# 扩展 Markdown 块语法

报告使用标准 Markdown，加上以下自定义块。写标记就行，渲染由 HTML 模板自动处理。

## :::demo — 界面示意

嵌入一段 HTML，在沙箱 iframe 中渲染。用来画简化的界面示意图、交互流程动画、状态对比等。

**每个 demo 自动注入一套黑白灰基础样式系统。** 优先用预置 class，只在必要时用 inline style 补充。配色只用黑白灰——不要引入彩色，保持清爽简约。

```markdown
:::demo
<div class="max-w-md mx-auto text-center">
  <div class="text-xl text-bold mb-sm">新游戏</div>
  <div class="text-sm text-gray mb-lg">选好设置，开始一局</div>
  <div class="label">玩家人数</div>
  <div class="wrap mb-md">
    <span class="pill pill-outline">8</span>
    <span class="pill pill-active">10</span>
    <span class="pill pill-outline">12</span>
  </div>
  <button class="btn btn-primary btn-block">开始游戏</button>
</div>
:::
```

### 设计规范

- **配色：** 只用黑白灰。`--black` (#37352f)、`--gray-*` 系列、`--white`。不要用蓝色、红色等彩色
- **圆角：** 卡片 `8px`（`--radius`）、小元素 `6px`（`--radius-sm`）、药丸/头像 `9999px`（`--radius-full`）
- **间距：** sm=6-8px、md=12px、lg=16-20px
- **字号：** xs=11px、sm=12px、md=14px（默认）、lg=16px、xl=20px

### 预置 class 速查

**布局：**
- `.row` `.col` `.wrap` `.center` — flex 布局
- `.gap-sm` `.gap-lg` — 间距
- `.max-w-sm` (360px) `.max-w-md` (440px) `.mx-auto` `.w-full`
- `.text-center` `.text-right`
- `.mt-sm/md/lg` `.mb-sm/md/lg` — 外边距

**容器：**
- `.card` — 带边框圆角的卡片
- `.card-sm` — 紧凑卡片

**文字：**
- `.text-xs/sm/md/lg/xl` — 字号
- `.text-bold` `.text-medium` — 字重
- `.text-black` `.text-gray` `.text-light` `.text-white` — 颜色

**药丸（选项标签）：**
- `.pill` + `.pill-outline`（灰色边框） / `.pill-filled`（黑底白字） / `.pill-active`（黑底白字，表示选中）

**按钮：**
- `.btn` + `.btn-primary`（黑底） / `.btn-secondary`（灰底）
- `.btn-block` — 占满宽度

**头像：**
- `.avatar` + `.avatar-sm/lg` — 尺寸
- `.avatar-dark`（黑底） / `.avatar-gray`（灰底） / `.avatar-outline`（描边）

**聊天气泡：**
- `.bubble` + `.bubble-gray`（灰底） / `.bubble-light`（白底描边）

**徽章/状态：**
- `.badge` + `.badge-dark/gray/outline`
- `.status-dot` + `.status-active/inactive` `.status-glow`

**辅助：**
- `.divider` — 分割线
- `.label` — 表单标签（12px 灰色）
- `.opacity-30/50/70`
- `.shadow-sm`
- `.bg-black/dark/gray/white`

### 写 demo 的原则

- **优先用 class，减少 inline style**
- 画关键元素的布局和状态就行，不需要像素级还原
- 可以用简单的 CSS 动画或 JS 做交互演示
- 标注文字用来解释"这是什么"、"点了会怎样"
- 如果需要 class 没覆盖的样式，用 inline style 补充，但配色仍然只用黑白灰

## :::mermaid — 流程图 / ER 图 / 状态机

使用标准 Mermaid 语法。**必须是合法的 mermaid 语法**，不要用自创的箭头或分支符号。

```markdown
:::mermaid
graph TD
  A[用户触发操作] --> B{条件判断}
  B -->|是| C[处理 A]
  B -->|否| D[处理 B]
:::
```

所有 Mermaid 图表类型都可以用：flowchart、sequenceDiagram、stateDiagram、erDiagram 等。

## :::sequence — 时序图

描述多个参与者之间的交互顺序。

```markdown
:::sequence
sequenceDiagram
  participant 用户
  participant 前端
  participant 后端

  用户->>前端: 点击按钮
  前端->>后端: 发起请求
  后端-->>前端: 返回结果
  前端-->>用户: 显示结果
:::
```

## :::mindmap — 脑图

功能树、概念层级。用缩进表示层级。

```markdown
:::mindmap
- 根节点
  - 子节点 A
    - 子子节点
  - 子节点 B
:::
```

## :::callout — 高亮框

需要特别注意的业务规则或设计意图。

```markdown
:::callout
这里写需要特别注意的业务规则或设计意图。
:::
```

## :::tooltip — 技术细节

给想深入了解的读者看的补充信息。默认折叠，点击展开。

```markdown
:::tooltip
技术补充。用 PM 能理解的语言，解释数据存在哪、有哪些关键约束。
每个字段都要回答"影响什么用户体验"或"为什么需要它"。
:::
```

好的 tooltip：说出数据存在哪、列出核心字段并用业务语言解释、提及关键约束。
不好的 tooltip：只列技术实现、照搬 DDL、用只有开发才懂的缩写。

## :::impact — 影响链

产品和业务层面的连锁反应。第一个默认展开，其余折叠。

```markdown
:::impact
触发点: 修改某条核心规则
- 用户在哪个场景下会感知到这个变化
- 哪个相关功能的行为会跟着变
- 如果上下游没有同步调整，会出现什么不一致
:::
```

判断标准：每一条都是"对用户或业务有什么影响"，不是"需要改哪个文件"。

## :::tabs — 标签页

并列的、同级别的信息，减少垂直滚动。

```markdown
:::tabs
::tab[场景 A]
场景 A 的描述...
::tab[场景 B]
场景 B 的描述...
:::
```

## :::metric — 指标卡片

产品关键数字。用 `|` 分隔数值和标签。

```markdown
:::metric
42|活跃用户数
3|核心模块
5|API 接口
:::
```

## 异常场景提示

在旅程中标注异常/边界情况时，用标准 markdown blockquote 加粗条件：

```markdown
> **如果网断了：** 游戏卡在当前阶段，刷新页面后从最近的检查点恢复。
```

每个核心流程至少标注 1-2 个主要异常场景，放在相关流程描述之后。

## 内联语法

**术语提示（inline tooltip）：** `[显示文字](tip:鼠标悬停时显示的解释)` — 渲染为带虚线下划线的文字，悬停显示提示。

**概念交叉链接：** `[概念名](#anchor)` — 渲染为加粗链接，悬停弹出目标概念简介（Popover），点击跳转。
