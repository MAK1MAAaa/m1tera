# Benchmark 接入核验（2026-10-13）

本文件记录接入时的源码与公共数据核验，不包含新增模型成绩。现有实现只读检查覆盖 `runtime/benchmarks.ts`、`runtime/service.ts` 的评测路径、类型协议、CLI、评测对话框和对应行为测试。未读取应用凭据、用户会话或应用数据，未启动真实模型请求，未在宿主机执行 benchmark 任务代码。

## 本轮优先选择

优先接入 **LongHarness Bench 的四套任务**，先用固定小样本验证工具检索、长上下文与累计 token 使用，再按相同预算扩充题量。其中 Program Execution Tracing 与 Constraint Solving Search 最适合作为先行路径：前者检验逐步检索与证据引用，后者检验选择性过滤与全量答案集合。Outlier Memo Detection 与 Equivalent Program Pair Search 复用同一加载和评分接口即可接入。

LongHarness 官方发布于 2026-09-29，比一般知识问答更直接对应当前应用的上下文优化目标。官方以同一模型对比 Direct、RLM、OpenCode、mini-swe-agent、ReAct，分别报告准确率和成本；这些是发布方的历史结果，不能直接与不同模型、预算或工具权限的小样本成绩排名。[官方论文](https://arxiv.org/abs/2609.38137)、[项目网站](https://stringnlplab.github.io/longharness/)

| 候选 | 当前公共数据与许可 | 评分及执行要求 | 当前应用接入判断 |
|---|---|---|---|
| LongHarness / Program Execution Tracing | 每套 50 题；320 个计算记录、8 步查询；HF 未设访问门槛，未声明 SPDX 许可 | 原版 Python 标准库评分器：最终 JSON 与证据集合均须精确一致；无需执行上下文中的 Python | 适合本轮。只读分页、字面检索工具可通过当前 Pi harness 多步运行，复用 ChatGPT 内存连接；不需要 user simulator 或 Docker |
| LongHarness / Constraint Solving Search | 每套 50 题；160 人分散资料、3–5 个条件；许可状态同上 | 比较完整匹配人名 ID 集合；不使用模型判分 | 适合本轮。可与 tracing 共享外置上下文、检索工具与 usage 累计 |
| LongHarness / Outlier Memo Detection | 每套 50 题；700 份 memo、2,500 个陈述；许可状态同上 | 完整 15 个 memo ID 集合精确匹配，不容重复；原文要求 `Final Answer: [M-…]`，适配器需明确格式解析 | 可同轮扩展。只读检索轨不会具备论文 shell/脚本验证能力，需披露工具差异 |
| LongHarness / Equivalent Program Pair Search | 每套 50 题；200 段 Python；来源包含 APPS；许可状态同上 | 规范化无序整数对后比较完整配对集合；原标签是测试输入契约内的行为等价 | 可同轮扩展。仅阅读轨无需执行代码，但不能将该轨等同于论文允许脚本执行的配置 |
| BFCL v4 多调用及多轮 | Gorilla 的 Apache-2.0；目前应用固定版本已核验 | Parallel 可继续 AST；真正多轮必须运行官方状态模拟器，同时通过 state 与 response 检查，不能只比调用文本 | 多调用扩展容易，但它仍是 BFCL 分类，不能宣传为两套独立新 benchmark。多轮接入需要 episode 级持久 agent 和模拟器 bridge |
| ContextBench | 源码 Apache-2.0；1,136 任务、66 个仓库，另需保留被测仓库各自许可 | 官方 Python / Tree-sitter 比较检索文件、符号、跨度、编辑位置；需要固定仓库快照和 trajectory 格式 | 很符合后续检索诊断。可做只读轨，输出检索 recall/precision/efficiency；不能替代 issue-resolution 成功率。需要增加按行视图与轨迹日志 |
| Terminal-Bench 2 / Harbor | 官方数据仓库和 Harbor 均 Apache-2.0；实际任务镜像的内容另有各自许可 | 独立容器、任务 verifier、Python Harbor；通常 Docker 或云隔离环境 | 适合后续系统操作评测。必须将 `run_command` 指向容器环境，不能只用 workspace cwd 冒充隔离。当前 ChatGPT 连接需保留在现有运行进程，通过受控 bridge 代理推理 |
| τ³-bench（仓库仍名 tau2-bench） | 官方仓库 MIT；文本域 airline/retail/telecom/mock，新增 banking knowledge 和 voice | 官方 domain policy、模拟工具、用户模拟模型、状态与交互评分；voice 另需多家语音服务 | 不作为本轮第一优先。文本模式不必 Docker，但还需 user simulator 的模型配置与统计；只运行默认脚手架衡量的是该脚手架而非 m1tera |

来源：[LongHarness 数据卡](https://huggingface.co/datasets/StringNLP/longharness)、[BFCL 论文](https://proceedings.mlr.press/v267/patil25a.html)、[ContextBench 源码](https://github.com/EuniAI/ContextBench)、[Harbor 自定义 Agent 接口](https://harborframework.com/docs/agents)、[Terminal-Bench 2](https://github.com/harbor-framework/terminal-bench-2)、[τ-bench 官方仓库](https://github.com/sierra-research/tau2-bench)。

## LongHarness 的固定来源和许可边界

实际只读 API 核验结果：

- HF `StringNLP/longharness`：`private=false`、`gated=false`，revision `95c54a1646cc486f6702308a1e820cb361960fd4`。完整 200 题可公开下载，官网“release preparation 期间需要 private access”提示与当前 API 状态不一致。
- GitHub `StringNLPLAB/longharness`：固定提交 `6e3da81caa79a0fa53c150aa458b7e4e0c074e87`。GitHub 仅保留每类两例，共八例；HF 提供完整数据。
- GitHub metadata 的 `license=null`，递归文件树未发现 LICENSE、COPYING、NOTICE；HF README 的 YAML 无 license 字段。官方 README 明确其 Intended Use 为 evaluation，但这不能转换为 MIT/Apache 再分发许可。
- 因此应用应通过显式公开来源下载到评测缓存；仓库保留 URL、revision、checksum、独立适配代码和成绩。不要将未获明确再分发许可的数据原文或原版 `score.py` 放入安装包。原版评分器可外置下载用于本地复核。

| 文件 | SHA-256 |
|---|---|
| 根 manifest（200 行） | `28b7f2418982db028427f35fd79a119acf83b4a7c254b2ee69c9162e0c01df9a` |
| `score.py` | `0a59d0ec8d2a1b9108f277d19260abd2638034ee9a284015f22d90792baa1729` |
| `RELEASE.json` | `3c82b2cf98709f9b6c60810f898dc056894a71657b2acaf48d2e5a1971496fb4` |
| `DATA_CHECKSUMS.sha256` | `e0566948242e72918c760aa42e39c1bbbc38e59f5dbe2f416665da4e77b6f822` |

目录结构为 `tasks/<task>/contexts/sample-00000.md`、`tasks/<task>/answers/sample-00000.json`。根 manifest 行包含 `task`、`index`、`context_path`、`context_bytes`、`context_sha256`、`answer_path`。四套任务 0 号样例的上下文分别为 472,800、252,876、301,470、390,781 字节。

上下文已经包含任务说明：constraint、pairs、tracing 的末尾是 `### Final Query`，memo 的说明位于开头。推理时只暴露选中上下文及原题指令；不得暴露 gold、score.py、带答案路径的 manifest、其他实例或可浏览完整缓存根目录的工具。

评分器仅依赖 Python 标准库，入口为 `score_one(task, prediction, gold)`。每行预测为 `{task,index,prediction}`，脚本可接受单独的选中 manifest。四种预测：`{matches:string[]}`、`number[][]`、`string[]`、`{answer:JSON,evidence:number[]}`。对于程序 tracing，证据采用集合比较且拒绝重复，而非要求证据数组顺序等同 gold。所有任务的主成绩都是完整实例 exact；tracing 另报 answer-only 辅助成绩。

## 最小实施合同

当前 `BenchmarkTask` 可复用 `maxTurns`，但执行路径每题新建 agent。LongHarness 同一实例在一个 `agent.prompt()` 的 tool loop 中多步检索，尚不需要跨用户消息的 episode API。新增数据模块只需提供：

1. 固定源元数据、task ID 枚举、下载与 SHA 校验；按公开固定 ID 选择样本，网络或校验失败明确失败，不改用虚构数据。
2. 将模型可见 context 与 gold 对象隔离。工具闭包只接收一份 context 字符串，不持有答案或全缓存路径。
3. 只读 `read_context`、`search_context`、目录/区块索引工具；限制页面和检索结果体积，字面搜索避免任意正则开销。工具只能访问当前 context，无宿主文件、网络、命令或隐藏数据能力。
4. 逐项 exact 判分，以及离线原版 Python oracle 对照；测试缺项、额外项、重复项、整数对规范化、tracing 证据与 JSON、非法格式。格式/运行错误与未知值区别报告。
5. 报告新增实际 model request/tool 次数、累计 input/output/cache usage、policy 和 context-access mode；如果服务商 usage 缺失，保持未知，不以估算冒充实际用量。

`BenchmarkSuiteId`、描述数组、`runBenchmark()`、service 校验、CLI 选项和 GUI 选项需要同步扩展；`BenchmarkReport.settings.maxAnswerTurns` 应由字面量 `1` 改为数值，并记录实际题目预算。旧 BFCL/SimpleQA 路径保留原行为和旧报告兼容。

论文为每个实例规定 3M 累计 input+output token 预算，公开表格采用各套 50 题。若本轮采用较低轮数、只读工具、固定小样本，应完整披露这些差异；不得将其宏平均准确率直接插入作者 200 题表格作为同条件新排名，也不应把 ChatGPT 订阅使用量换算成未经核验的 API 美元成本。

## 隔离式通用 adapter

面向后续 Harbor/Terminal-Bench，可创建一个 Python `BaseAgent` 外部适配器和一个 Node JSON Lines worker。适配器将工具调用映射到 `BaseEnvironment.exec/upload_file/download_file`，任务工作区与 verifier 全部留在独立容器，worker 只保留 Agent 状态和模型流。把 `createHarnessAgent` 的工具执行边界抽成环境接口，桌面模式用本地工作区，benchmark 模式用容器操作；不要将命令字符串转给宿主 `executeCommand()`。

ChatGPT 授权令牌继续仅留在已授权应用运行进程。若要复用该连接，由应用持有一个仅当前评测可用的受控 RPC 通道负责模型请求，记录脱敏 usage 和调用轨迹；不要把令牌复制给 Harbor、Docker、其他产品、环境变量或报告。外部 benchmark 引擎必须只获得任务指令与公开工具接口，不能获得 verifier 或答案。额外产品的实测需要各自明确可用的 API/账号连接；同模型、同题目、同预算的受控对照需要单独记录，发布方成绩可作为来源明确的外部参考。

检索计数 `sources_reviewed: 51`，为 Exa 每次请求的 `numResults` 总和，包含一次参数重试及重复结果；此数字不是 51 个独立已验证官方来源。结论使用上述原始仓库、官方文档、公共 API 与源码，不使用转载评论作技术依据。

## 独立适配模块验证

已新增 `benchmarks/longharness.ts` 和 `tests/runtime/longharness.test.ts`。四类数据下载接口、内容寻址缓存、固定 SHA 校验、任务说明提取和 deterministic scorer 由独立模块提供；真实运行与 GUI 集成由应用评测入口完成。

- 56 项模块行为测试通过：完整 manifest 结构、路径/索引/校验失败、取消、下载错误、缓存污染、目录/文件符号链接与大小限制，以及四类 exact 规则、重复项、错误类型和原版 memo 输出格式。
- 四类官方公开 0 号样例均通过外置缓存加载与 checksum 校验；模型可见文件仅为 `context.md`。随后使用真实 Node fetch 下载每类 1 号样例，四类各两例、共八例均通过加载与校验。将样例答案直接送入 scorer 仅用于加载/评分验证，未作为模型作答或模型成绩。
- 下载到临时目录的原版 `score.py` 先验证 SHA，再以其 `score_one` 对照 60 个合成正反例；TS 与官方 exact、answer-only、tracing evidence 结果 **60/60 一致**。不调用模型，不执行上下文中的程序，不将源码或题目原文加入本仓库。
- 格式适配只接受完整 JSON、单个完整 JSON 围栏、memo 原版 `Final Answer: [M-…]`。不从任意解释文本中猜取答案，不执行 Python 表达式，不做字符串/整数语义转换。

以上为适配正确性验证，不构成 LongHarness 模型成绩，也不构成与其他产品的实测对照。
