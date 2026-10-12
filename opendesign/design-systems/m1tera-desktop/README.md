# m1tera desktop

本规范将现有 m1tera 桌面界面整理为工作区驱动的产品，并记录 v0.3 的 composer、上下文圆环和按需 Skills 交互。交互层级参考用户提出的 Codex 方向；颜色、尺寸与布局是项目自有决策，没有使用或声称使用 Codex 官方 token。

## 文件

- [SKILL.md](./SKILL.md)：可复用规范、组件映射、命令/文件/Skills 交互与上下文约束。
- [tokens/colors_and_type.css](./tokens/colors_and_type.css)：原始与语义 token。
- [桌面交互参考](../../mockups/desktop-v2/index.html)：v0.2 的模型、审批、工作区、置顶、分类与改名历史参考；全部为演示状态，不表示 v0.3 行为已验证。
- [组件参考](./ui-kit-desktop/index.html)：现有消息/工具结果结构与新版 token；对应 JSX 位于 `ui-kit-desktop/components/Message.jsx`。

## 已查阅的来源

- 项目 `src/App.tsx`：现有导航、聊天、composer、上下文布局。
- 项目 `src/App.css`、`src/index.css`：已有字体、m 标识、颜色与滚动规则。
- 项目 `src/components/SettingsDialog.tsx`：真实模型连接、提示词与工具配置。
- 项目 `src/components/ApprovalDialog.tsx`：真实审批语义。
- 项目 `src/components/BaselinePanel.tsx`：真实估算与实测分离。
- 项目 `src/components/Composer.tsx`、`ContextRing.tsx`、`SkillsDialog.tsx`：v0.3 输入候选、圆环与技能管理。
- 项目 `runtime/service.ts`、`skills.ts`、`attachments.ts`、`hosted-web-search.ts`、`web-search.ts`：本轮上下文准备、只读计划、按需指令与搜索执行。
- 用户要求：参考 Codex、模型选择、自动审批、固定窗口、会话组织、工作区，以及按需文件和 Skills。

## v0.3 使用约束

- 圆环显示发送前的本地预计输入与可信模型上下文上限，悬停查看数值、点击打开详情；上限或 usage 缺失时保持未知。切换模型或修改提示词不清空已取得的目录上限缓存。ChatGPT 原生 web search 的有效上限为可信模型上限与 128,000 tokens 中的较小值，未知模型上限仍保持未知。
- `/plan` 仅制定计划，保留已启用的只读工具；`/websearch` 实际搜索并提供 citations；`/new` 新建会话，`/clear` 清空草稿与引用，`/skills` 打开管理。
- `@` 选择当前工作区文件，发送时读取已选正文；`$` 手动选择已启用 Skills，只将所选指令按需加入本轮请求。候选支持键盘选择，引用标签可以移除。
- Skills 管理支持自定义技能创建、编辑、导入 `SKILL.md`、启停和删除；内置技能仅启停，指令只读。导入不自动发现项目文件。
- 自动匹配默认关闭。启用后提供简短技能目录与 `use_skill`，由模型按任务调用后加载指令；完整指令只保留在本轮工具链，后续请求将旧调用结果压成短标记，避免关闭自动匹配或停用后重新注入指令。不预先加载整个技能库，也不授予额外工具权限。选择工作区不自动读取项目指令、文件或记忆。
- OAuth 凭据与 API key 仅保存在后端内存，退出后需要重新登录或配置。

模型列表与自动审批能力最终以应用运行时协议为准，参考页面不连接真实账号、不执行工具。搜索协议与 citations 已通过 fixture 验证，DuckDuckGo 客户端搜索已使用应用相同的系统代理配置实测成功；真实 ChatGPT 账号原生搜索尚未验证。实际检查结果见 [v0.3 验证记录](../../../docs/validation-v3.md)，保留 [v0.2](../../../docs/validation-v2.md) 与 [v0.1](../../../docs/validation.md) 历史结果，不能用历史或演示状态替代新功能实测。
