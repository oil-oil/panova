# panova

从代码库或 PRD 梳理用户旅程、实体和业务规则，生成交互式业务报告。

完整执行规则见 [SKILL.md](SKILL.md)。

## 配置、依赖与使用边界

使用 bundled 渲染脚本与 Node.js；无需专用账号或 API Key。先读取 BLOCKS.md，再按真实项目内容组织报告。

只读取用户指定的项目与文档；报告区分代码事实和推断，不扫描无关个人目录，不编造业务指标。

使用示例：

```text
帮我梳理当前项目的下单流程，生成给产品经理看的业务报告。
```

## GitHub 安装

把 [仓库地址](https://github.com/oil-oil/panova) 交给 Agent，要求按 README 安装；也可运行：

```bash
npx skills add oil-oil/panova
```

安装后由宿主重新加载 Skill。
