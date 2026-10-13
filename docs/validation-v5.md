# 0.5.0 验证记录

验证日期：2026-10-13。环境：macOS arm64，内置 Node 24.21.0。轻量化目标继续是模型上下文可控。

| 检查 | 结果 |
| --- | --- |
| TypeScript / ESLint | 全项目 typecheck、lint 通过 |
| 运行时测试 | 15 个文件、255 项通过，包含既有功能及 artifact、checkpoint、提交去重、恢复、运行边界和评测适配 |
| 界面 E2E | 33 项通过，包含原有 24 项及 9 项运行策略、继续任务、评测未知值、取消、显式启动与 v0.4 缺陷回归 |
| Rust | 11 项通过；fmt 与 `clippy --locked --all-targets -- -D warnings` 通过，桥接方法与共享协议一致 |
| 上游 | `verify:upstream` 通过；Pi core / ai 与只读 submodule 均保持 1.1.0 |
| BFCL 评分适配 | 74 项评测模块测试包含在运行时总数中；另用未改动的官方 Python scorer 完成 60 项离线规则对照 |
| macOS 安装包 | 最终 app / DMG 0.5.0 构建通过；36 个编译文件逐文件 SHA256 与 app 内资源一致，资源版本、Info.plist 及 lockfile 摘要匹配 |
| 内置 Node smoke | 11 项通过；子 runtime 限定 `PATH=/usr/bin:/bin`，仅使用包内 Node 和独立临时 appData / workspace |

自动化检查共 **299 项**（255 + 33 + 11）。离线 scorer 对照与本地管线评测单独记录，不加作模型能力分数。所有结果针对当前源码与最终产物，不把历史 v0.4 验证当成本轮实测。

## 上下文与恢复

ArtifactStore 保留完整原文，默认 4096 token 本地估算阈值；读取默认 4096、最多 16384 Unicode code points，offset 从 0 开始。核验中文、emoji、单行 JSON、中部与尾部、8 MiB 边界、会话与授权 ID 隔离、符号链接拒绝、并发同内容去重和保存失败保留原结果。`read_file` 自己分页，附件读取保持原有 128 KiB 完整读取行为；分页、错误及 Skill 指令不再次外置。

只有出现引用且当前会话具备工具能力时才披露 `read_artifact`，纯聊天仍为 0 工具。旧的已完成大参数仅在模型投影中缩短，原始 transcript 保留；最近当轮、未完成调用和调用 / 结果配对不被删除。预览与真实请求共用同一投影。长无空白 Unicode 的估算性能回归通过；超过 64 KiB 使用 UTF-8 字节上界，其他长文本分块估算，不宣称精确 tokenizer 计数。

接受输入前保存 user message、checkpoint 与接收记录；工具 intent 在 execute 前保存，outcome 与对应 tool result 保存成功后才公布工具完成。保存失败立即阻止后续工具与模型请求；外部效果已经发生而 outcome 未保存时，回滚成功标记并保留结果未知。测试确认文件仅写一次，没有第二次请求或自动重放。

同一会话最近 64 个提交标识记录输入与非凭据配置指纹。同 ID 同参数返回原 run ID，修改系统提示词或 API 格式后复用 ID 会报冲突；继续任务同 ID 在运行中和结束后的重试也不重复输入或请求。模型、连接、密钥及运行策略在开始时固定；模型请求轮数和时限到达后暂停，显式继续才重新请求。

重启使未完成工具为 interrupted、旧审批为 expired，不自动执行任何工具；继续时写入与命令重新审批，不自动读取原附件路径。已有 v0.4 和旧会话兼容。测试使用故障注入、合法中断快照与重启恢复，没有宣称任意 shell exactly-once、原 provider 流恢复、跨进程锁或断电耐久。文件 flush 与 rename 构成当前快照边界；流式 `text.delta` 仍是易失显示，未完成文本可能丢失。

## 本地管线评测

执行实际 harness factory、Pi 请求格式化与 SSE 解析、工作区工具及 artifact 读取，provider 为进程内 fixture，无模型准确率或实际 usage。

| 固定样本 | 原文模式 | 外置模式 |
| --- | ---: | ---: |
| 35,177 字节合成日志 | 2 次请求 | 3 次请求，包含取回中部页 |
| 累计输入本地估算 | 11,873 | 2,369 |
| 命令执行 | 1 次 | 1 次 |

这个单一样本的估算减少 **80.05%**，包括额外 schema 和分页请求；原文 SHA256 一致，1536 字符中部页正确。它不代表所有任务的真实 token 收益或模型理解能力。0 / 4 工具空提示词首轮为 25 / 372 本地估算；2 轮边界、intent 保存失败 0 写入、outcome 保存失败 1 写入 / 0 重放也已执行。见 [可复现报告](benchmarks/harness-local.md)。

## 真实连接与公共评测

最终原生 app 已恢复原会话与工作区。用户于本轮完成官方 ChatGPT 授权，应用显示已连接；真实账号模型目录返回 7 个可见模型，其中 gpt-6.1-sol 的可信容量为 500,000 tokens，其他发现项保持未启用。未读取或复制 Codex 既有凭据。

BFCL v4 固定 10 道 simple_python + 10 道 multiple 原题，本地 AST 评分移植；SimpleQA 为官方 seed=0 抽样 20 原题，无浏览，使用同一模型另次请求官方 A/B/C grader。答案不进入作答请求，每题隔离；使用当前内存连接与同一个 harness factory。部分失败为 unknown，必须同时显示已判分 / 全部；fixture accuracy 固定 null。

| gpt-6.1-sol 真实评测 | 正确 / 已判分 | 错误 / 未作答 / 未知 | 准确率 | 输入 usage | 耗时 |
| --- | --- | --- | ---: | ---: | ---: |
| BFCL v4 | 18 / 20 | 2 / 0 / 0 | 90% | 3407 | 93.814 秒 |
| SimpleQA | 16 / 20 | 3 / 1 / 0 | 80% | 28673（包含评分请求） | 292.676 秒 |

真实请求合计 60 次（BFCL 20、SimpleQA 作答 20 / 评分 20），总输入 usage 32080 tokens，包含缓存输入。BFCL 另用未改动的官方 Python scorer 对保存的真实预测复核，20 / 20 与本地判定一致；见 [BFCL 逐题结果](benchmarks/bfcl-v4-gpt-6.1-sol-live.json)、[官方 scorer 核验](benchmarks/bfcl-v4-official-check.json)、[失败分析](benchmarks/bfcl-v4-failure-analysis.md) 和 [SimpleQA 逐题结果](benchmarks/simpleqa-gpt-6.1-sol-live.json)。

数据提交、哈希、许可、抽样及评分差异见 [评测资料](../benchmarks/README.md)。这些是小规模单轮子集，不对标完整官方榜单或多轮 Agent 任务；SimpleQA 使用同模型 grader，存在偏差；BFCL 其中一题多意图表达与单函数参考存在评测边界，保留失败而不修改真值。

## 界面与交付边界

已用真实 React/CSS 的行为和几何回归修复 v0.4 的多接口警告裁切 picker、局部目录刷新失败仍已验证、合法长接口名横向溢出，以及辅助状态文字字号问题。独立视觉复核另行交付，自动化和辅助功能树不替代视觉结论。

原生选择评测集后按回车曾提交表单；最终界面改为仅“开始评测”按钮启动，选择、题数和 implicit submit 均不发送请求，按钮键盘激活仍可用。这项修复不改变已经测量的 harness / 模型管线，没有重跑样本。运行账户保持连接，没有为重新打包读取或搬运凭据。

其他平台构建、独立无 Node 机器安装、公开签名与公证仍未验收。当前包携带 Node，API key / OAuth 只在后端内存，退出后需重新连接。产物大小、SHA256 与锁文件摘要见 [产物清单](release-artifacts.json)，[0.4.0](release-artifacts-0.4.0.json) 保留为历史清单。

包内 smoke 完成 6 次 localhost fixture 聊天，核验登录前 BFCL/SimpleQA 拒绝、策略保存、RPC 去重、Unicode 分页、轮次暂停、artifact 原文 hash 与延迟读取、重启恢复但密钥不恢复。256 intent 上限属于包内 reducer 检查，没有真的执行 256 个工具。没有生成模拟公共 benchmark 分数，临时数据与进程均已清理；此检查不能代替独立无 Node 机器安装。

## 独立视觉复核补充

2026-10-13 的独立 verifier 使用当前生产 React/CSS 与 `tests/e2e/fixtures.ts`，完成 1280×850、800×600 各浅深色的 8 个临时隔离检查，捕获64张截图和64份几何证据。人工检视关键状态确认运行策略、恢复提示、评测进度/取消/未知值/内部滚动及 v0.4 三个缺陷的定点回归通过。选择框回车、题数回车和 implicit submit 的 fixture 启动计数为0；显式开始按钮 Enter / Space 可启动。临时测试与进程已清理，未请求真实模型、操作原生应用或读取用户凭据；这些临时检查不加入上面的299项固定检查计数。

完整设计规范验收仍有字体偏差：生产 `src/index.css` 和实际 computed fontFamily 使用系统字体栈，没有接入规范指定的 DM Sans。除该项外，本轮未发现溢出或误启动问题；不能把本轮描述为已验证复用 DM Sans 或原生窗口已验收。详见 [独立视觉报告](visual-verification-v5.md)，包含源码 SHA256、截图和窗口/scrollHeight证据。
