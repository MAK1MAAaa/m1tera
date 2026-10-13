# m1tera desktop

本规范将现有 m1tera 桌面界面整理为工作区驱动的产品，覆盖 v0.3 的 composer、上下文圆环和按需 Skills、v0.4 的账号模型目录与多接口配置，以及 v0.5 的运行策略、持久恢复与评测。交互层级参考用户提出的 Codex 方向；颜色、尺寸与布局是项目自有决策，没有使用或声称使用 Codex 官方 token。

## 文件

- [SKILL.md](./SKILL.md)：可复用规范、组件映射、模型配置、命令/文件/Skills 交互、运行恢复与评测约束。
- [tokens/colors_and_type.css](./tokens/colors_and_type.css)：原始与语义 token。
- [桌面交互参考](../../mockups/desktop-v2/index.html)：v0.2 的模型、审批、工作区、置顶、分类与改名历史参考；全部为演示状态，不表示 v0.3/v0.4/v0.5 行为已验证。
- [组件参考](./ui-kit-desktop/index.html)：现有消息/工具结果结构与新版 token；对应 JSX 位于 `ui-kit-desktop/components/Message.jsx`。

## 已查阅的来源

- 项目 `src/App.tsx`：现有导航、聊天、composer、上下文布局。
- 项目 `src/App.css`、`src/index.css`：已有字体、m 标识、颜色与滚动规则。
- 项目 `src/components/SettingsDialog.tsx`：真实模型连接、提示词与工具配置。
- 项目 `src/components/ModelSettings.tsx`、`ModelPicker.tsx`：v0.4 的官方 OAuth、多接口编辑、模型勾选与按服务商选择。
- 项目 `runtime/model-config.ts`、`chatgpt-auth.ts`、`service.ts`、`shared/protocol.ts`：账号目录协议、生命周期判断、配置迁移、凭据与目录隔离。
- 项目 `src/components/ApprovalDialog.tsx`：真实审批语义。
- 项目 `src/components/BaselinePanel.tsx`：真实估算与实测分离。
- 项目 `src/components/Composer.tsx`、`ContextRing.tsx`、`SkillsDialog.tsx`：v0.3 输入候选、圆环与技能管理。
- 项目 `runtime/service.ts`、`skills.ts`、`attachments.ts`、`hosted-web-search.ts`、`web-search.ts`：本轮上下文准备、只读计划、按需指令与搜索执行。
- 项目 `runtime/harness.ts`、`artifacts.ts`、`checkpoints.ts`、`storage.ts`、`tools.ts`：v0.5 的上下文投影、可取回结果、Unicode 分页、提交边界与保守恢复。
- 项目 `src/components/BenchmarksDialog.tsx`、`runtime/benchmarks.ts`、`benchmarks/README.md`：固定公开原题子集、评分、未知值、进度与报告呈现。
- [Harness 调研](../../../docs/harness-research-v5.md)：Deep Agents / Pi durable 的官方机制、采用范围和未采用的边界。
- 用户要求：参考 Codex、模型选择、自动审批、固定窗口、会话组织、工作区，以及按需文件和 Skills。

## v0.5 运行与评测约束

- “运行与上下文”可配置长工具结果精简、阈值、模型轮数及运行时限，下次运行生效；默认 4096 本地估算 tokens、24 轮和 300 秒。这些不是模型容量或自动摘要。
- 大结果保留为会话隔离的 artifact，模型收到短预览及引用，只有需要时披露 `read_artifact`。Unicode 分页默认 4096、最多 16384 字符；`read_file` 允许最多 8 MiB 文本，`@` 附件仍完整读取且最多 128 KiB。纯聊天仍为 0 工具，错误、分页读取及 Skill 指令不重复外置。
- 输入、完整消息、工具意图/结果与审批在相应确认或执行前保存；流式文本增量仍易失。显式继续须检查未知外部效果，旧审批失效，写入/命令恢复为逐次审批，不自动重放旧工具，不宣称任意操作 exactly-once。
- 顶栏评测复用当前模型连接及内存凭据，每题空历史。BFCL v4 为 10 道 `simple_python` + 10 道 `multiple` 原题，本地 AST 移植通过 60 份官方评分器行为对照；SimpleQA 为官方 seed=0 的 20 道无浏览原题，标准答案仅进入另次独立 A/B/C grader 请求。当前同模型 grader 有偏差，两套小样本均不对标完整榜单。
- 报告展示已判分/总题数、未知与准确率分母，失败不能填为正确或错误；fixture 的模型准确率永远未知。实际 usage 缺失时保持未知，本地估算单列。数据、SHA256、抽样、许可和具体评分差异见 [评测资料](../../../benchmarks/README.md)。
- [本地管线评测](../../../docs/benchmarks/harness-local.md) 的约 35 KiB 日志输入估算由 11873 降为 2369（80.05%），包括额外读取与 schema；只是确定性单样本，不证明真实模型能力。v0.5 已使用官方 ChatGPT `gpt-6.1-sol` 完成真实固定子集：BFCL 18/20（90%）、SimpleQA 16/20（80%），未知均为 0；实际 BFCL 预测与官方 scorer 逐题一致。同模型 grader 与子集限制见 [评测报告](../../../docs/benchmarks/evaluation-v5.md)。
- 只有显式激活“开始评测”按钮才发起模型请求。切换评测集、编辑题数和表单 implicit submit 不启动评测；按钮支持键盘激活。
- 小窗口中的 picker 搜索入口、多条目录警告、长接口名称和评测长表格均需留在内部滚动区域。目录刷新失败时设置草稿也降为未验证，状态文案保持可读，不用低对比 10px 文字。

## v0.4 模型配置约束

- 官方 ChatGPT OAuth 始终可见；当前账号通过 Bearer 请求 `GET https://api.openai.com/v1/models`，解析 `models[{slug, display_name, visibility}]`，只保留 `visibility = list` 并维持返回顺序。不回退全 Pi 静态目录；未登录或失败仅显示显式 sol 默认项或同账号最近缓存，标为未验证并警告。
- 登录、目录发现与复选框启用独立。新发现和手动新增默认不勾选，只有已启用且未明确不可用的模型进入 composer；运行时拒绝未启用模型。停用、移除当前模型或删除接口后保留待重选状态，不自动换模型。
- 自定义接口按 `/models` 的 `data[].id` 读取目录，以 `lifecycle`、`deprecated`、`shutdown_date` 等明确状态判断可用性；`created` 不用于猜测。已弃用、已停用及明确计划停用不可启用；计划停用不得描述为已经下架。
- 最多 12 个自定义接口，各自配置名称、base URL、API key、Responses/Chat Completions 格式及最多 256 个模型配置。目录合法条目不按数量截断，响应仅限制为 1 MiB。手动 ID 可附显示名称与上下文上限，支持未列出的网关模型，明确显示未验证；不能绕过已知停用状态。
- 密钥按服务商隔离且仅存内存：留空保留，显式清除复选框清除；URL 改变或删除接口清除 key，同 URL 改 API 格式保留。持久保存的是服务商名称/base URL/API 格式、模型 ID/来源/勾选状态和用户手工指定的名称/容量；旧单接口配置迁移为 `custom-default`，同名模型与容量缓存按服务商区分。
- 新接口保存前的目录候选通过仅内存的 SHA256 密钥指纹与 URL 匹配后归入该接口的本次运行目录，保证同次运行保存后不丢发现结果；目录候选、key 和指纹不落盘。刷新失败保留已知名称/容量并降为未验证、显示警告；成功完整目录不含旧接口项时标为不可用，手动缺失项保留显式配置意图。
- 实时目录元数据仅在内存中保留，退出后重连账号或配置 key 并重新拉取；不自动转为永久手动覆盖值，避免遮蔽未来容量更新。服务商配置与目录元数据不进入模型上下文。

参考协议：[OpenAI 模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[OpenAI 弃用说明](https://developers.openai.com/api/docs/deprecations)；多接口组织参考 [OpenCode providers](https://opencode.ai/docs/providers/)。v0.5 已通过用户本轮官方 OAuth 授权取得真实账号的 7 个可见模型，`gpt-6.1-sol` 的可信上限为 500,000 tokens；其他发现项保持未启用。未读取或复制既有凭据。

## v0.3 使用约束

- 圆环显示发送前的本地预计输入与可信模型上下文上限，悬停查看数值、点击打开详情；上限或 usage 缺失时保持未知。切换模型或修改提示词不清空已取得的目录上限缓存。ChatGPT 原生 web search 的有效上限为可信模型上限与 128,000 tokens 中的较小值，未知模型上限仍保持未知。
- `/plan` 仅制定计划，保留已启用的只读工具；`/websearch` 实际搜索并提供 citations；`/new` 新建会话，`/clear` 清空草稿与引用，`/skills` 打开管理。
- `@` 选择当前工作区文件，发送时读取已选正文；`$` 手动选择已启用 Skills，只将所选指令按需加入本轮请求。候选支持键盘选择，引用标签可以移除。
- Skills 管理支持自定义技能创建、编辑、导入 `SKILL.md`、启停和删除；内置技能仅启停，指令只读。导入不自动发现项目文件。
- 自动匹配默认关闭。启用后提供简短技能目录与 `use_skill`，由模型按任务调用后加载指令；完整指令只保留在本轮工具链，后续请求将旧调用结果压成短标记，避免关闭自动匹配或停用后重新注入指令。不预先加载整个技能库，也不授予额外工具权限。选择工作区不自动读取项目指令、文件或记忆。
- OAuth 凭据与 API key 仅保存在后端内存，退出后需要重新登录或配置。

模型列表、审批和运行恢复最终以应用运行时协议为准，参考页面不连接真实账号、不执行工具。搜索协议与 citations 已通过 fixture 验证，DuckDuckGo 客户端搜索已使用应用相同的系统代理配置实测成功；真实 ChatGPT 账号原生搜索尚未验证。当前 299 项自动化检查通过（255 runtime、33 E2E、11 Rust），包内 smoke 11 项通过，真实账号固定子集评测另行记录；独立视觉、其他平台与独立无 Node 机器安装仍未验收。v0.4 的视觉问题已修改代码并补充 E2E，最终独立视觉复核待交接。

当前检查结果见 [v0.5 验证记录](../../../docs/validation-v5.md)，保留 [v0.4](../../../docs/validation-v4.md)、[v0.3](../../../docs/validation-v3.md)、[v0.2](../../../docs/validation-v2.md) 与 [v0.1](../../../docs/validation.md) 历史结果，不能用历史或演示状态替代新功能实测。
