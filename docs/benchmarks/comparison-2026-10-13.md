# Benchmark 与产品比较（2026-10-13）

本报告区分三种证据：m1tera 的保存后真实报告、榜单运营者的公开登记、论文作者的同模型实验。没有重新运行其他产品，也不把不同数据、模型、推理档位和预算的数字合成总排名。日期使用 Asia/Shanghai；表中登记时间按原始记录保留 UTC。

## 为什么扩充这些集合

新版 Harness 发布正在同时展示任务结果、上下文开销和计算成本。Deep Agents 0.7 的发布与评测方法覆盖 Harbor-Index 自主任务、τ³ 多轮对话和 Letta 文件上下文检索；LongHarness 则在同模型下比较 Direct、RLM、OpenCode、mini-swe-agent、ReAct 的精确正确率与成本。本轮先加入 **Letta Filesystem cloud 和 LongHarness 四套任务**，补充 BFCL 工具 schema 与 SimpleQA 知识问答不能反映的检索、多跳证据和上下文策略能力。[Deep Agents 发布](https://www.langchain.com/blog/deep-agents-v0-7)、[评测方法](https://www.langchain.com/blog/how-we-benchmark-deep-agents)、[LongHarness 论文](https://arxiv.org/abs/2609.38137)

| 已接入集合 | 主要测量 | 默认题量 | 当前证据 |
|---|---|---:|---|
| BFCL v4 固定子集 | 工具选择、参数 | 20 | v0.5 真实报告；官方 AST scorer 复核 |
| SimpleQA 固定子集 | 无浏览事实回答 | 20 | v0.5 真实报告；同模型独立 A/B/C judge |
| Letta Filesystem cloud | 完整十文件、多跳关联 | 3 / 100 | Agent 3/3，mean reward 1.0，未知 0 |
| LongHarness 条件搜索 | 分散资料的全条件交集 | 2 / 50 | Agent 0/1 已判分、未知 1；Direct 2/2、未知 0 |
| LongHarness 冲突备忘录 | 分散关系中的完整矛盾集合 | 2 / 50 | Agent 0/2（预算失败），Direct 0/2；未知均为 0 |
| LongHarness 程序追踪 | 依赖检索、最终结果及证据 | 2 / 50 | v3：Agent 0/1 已判分、未知 1；Direct 2/2、未知 0 |
| LongHarness 等价程序 | 语义区分与完整配对 | 2 / 50 | Agent、Direct 各 0/1 已判分、未知 1 |

新增集合保留原题和全部对应语料。Agent 模式初始提供题目虚拟文件的列目录、分页读取、字面搜索；外置后按需加入只读本题 artifact 的 `read_artifact`；LongHarness 另支持同模型 Direct 完整上下文、0 工具的一次请求对照。所有样本为固定前缀，每题一次尝试，不是官方全量或三次 rollout 的比较。[实现协议](../../benchmarks/README.md)

## m1tera 已保存的真实成绩

以下均来自 v0.5、独立官方 ChatGPT 授权的 `gpt-6.1-sol`，每题空历史，无浏览。它们保持为历史结果，不因新增评测重写。

| 集合 | 完整正确 / 已判分 | 准确率 | 未知 | 服务商输入 tokens | 请求数 | 评分限制 |
|---|---:|---:|---:|---:|---:|---|
| BFCL v4 固定子集 | 18 / 20 | 90% | 0 | 3,407 | 20 | 非全量 BFCL；保存后的规范化 calls 官方复核一致 |
| SimpleQA 固定子集 | 16 / 20 | 80% | 0 | 28,673 | 40 | 3 错误、1 未作答；含 judge 请求，同模型评分偏差 |

输入合计 32,080 tokens，包含缓存输入与评分请求。逐题原始报告、两道 BFCL 失败解释、官方复核与抽样限制见 [v0.5 评测报告](evaluation-v5.md)。

v0.6 使用同一模型、low 推理。Letta 三题全正确，累计输入 175,037 tokens（含评分）；LongHarness 条件搜索 Direct 两题全正确，但 Agent 首题触达作答预算、另一题请求异常。备忘录 Agent 两题达到预算，Direct 两题未满足完整集合 exact。真实成绩及用量见 [v0.6 评测报告](evaluation-v6.md)，不将适配单测或 gold 自评分包装为模型成绩。程序追踪旧版缺少完整公开输出协议，调试记录单独保留；v3 四题已重测，Direct 2/2，Agent 一题未知，另一题结果正确但证据错误。九份报告共 19 个样本、4 个未知；只有可评分预测参与严格评分，固定官方 Python 对 8 份预测的复核全部一致。

## 公开产品登记：Terminal-Bench 4.0

取自 [Terminal-Bench 官方榜单](https://www.tbench.ai/leaderboard) 的 **2026-10-13 快照**，榜单整体最近更新为 2026-10-06。固定数据版本 `terminal-bench/terminal-bench@4.0.0`，GitHub tag 对应提交 `452bf305c6daa62fc59061d22133a7cbc7c1572e`。每条为 66 题 × 5 次 = 330 trials；准确率是任务 verifier 判定的 trial resolution rate，± 为官方 95% 置信区间半宽。

| 产品 / Harness | 模型 | 推理档位 | TB 4.0 成绩 | 登记日期（UTC） | 330 trials 费用（官方记录） |
|---|---|---|---:|---|---:|
| Claude Code | Opus 5.5 | max | 64.85% ± 3.11 | 2026-10-06 | $4,718.65 |
| Claude Code | Sonnet 5.5 | max | 61.82% ± 2.94 | 2026-10-06 | $7,333.64 |
| Codex | GPT-6 Astra | max | 58.18% ± 2.79 | 2026-09-03 | $3,267.18 |
| Codex | GPT-6.1 Sol | max | 58.18% ± 3.11 | 2026-10-06 | $634.24 |
| Grok Build | Grok 4.7 | xhigh | 37.58% ± 3.54 | 2026-09-21 | $3,683.287146，费用仅含 324/330 trials |
| mini-SWE-agent | Gemini 3.8 Flash | high | 19.09% ± 3.36 | 2026-09-03 | $1,828.77 |
| Muse Code | Muse Spark 1.3 | xhigh | 14.55% ± 2.94 | 2026-10-06 | 未知（原始字段 0） |
| m1tera | GPT-6.1 Sol | TB 4.0 未配置 | **未评测** | — | — |

该表展示整套产品加模型配置的表现，不能识别纯 Harness 效应。官方没有公开逐行产品版本号、实际运行日期、sandbox 或输出 token 上限；这些保持未知，不补成“当前最新版本”。`metadata.date` 是模型发布日期，而本表采用 `created_at` 的榜单登记日期。费用是历史登记的总数，不是当前 API 价格、订阅费或单题成本；Muse 的 0 也不证明免费。

TB 4.0 官方指南包含 GPU 任务环境，单题 agent timeout 8 小时。66×5 trials、环境与 verifier 是可复现协议的一部分；Docker daemon 可用或个别题 smoke 不能替代完整成绩。不同 TB 2.x / 3.x / 4.0 数据版本不得合并，本项目 BFCL 90% 也不得与 TB 4.0 58.18% 比高低。[官方运行指南](https://www.tbench.ai/run)、[4.0 变更说明](https://www.tbench.ai/news/terminal-bench-4-0)

原始行 UUID、metadata、metrics、费用不完整标记、抓取页 SHA 与明确未知字段见 [来源 JSON](product-comparison-sources-2026-10-13.json)，抽取方法与日期口径见 [来源核验](product-comparison-sources-2026-10-13.md)。这里是官方登记，m1tera 未独立复现，不额外声称所有行已被独立审计。

## 同模型实验：LongHarness 发布论文

下表为论文作者报告的 **GPT-5.6-sol、high 推理、每套 50 题、四套共 200 题、每实例 3M 累计输入加输出 token 预算**。任务主指标为完整实例 exact，宏平均等权平均四套准确率。程序追踪列采用论文的格式容错答案加引用复核；其原始严格格式值另留在作者任务报告。成本为当时价格假设下的美元估算，不是本项目实测花费。[原始论文 Table 2 / 4](https://arxiv.org/html/2609.38137)

| Harness | 条件搜索 | 冲突备忘录 | 程序追踪 | 等价程序对 | Exact 宏平均 | USD / 实例（论文估算） |
|---|---:|---:|---:|---:|---:|---:|
| Direct | 58% | 44% | 94% | 44% | 60.0% | $0.822 |
| RLM | 44% | 92% | 76% | 2% | 53.5% | $4.30 |
| OpenCode | 56% | 10% | 96% | 0% | 40.5% | $2.90 |
| mini-swe-agent | 42% | 100% | 88% | 42% | 68.0% | $0.816 |
| ReAct | 32% | 6% | 82% | 52% | 43.0% | $1.93 |

论文使用同模型，适合展示 Harness 的效能差异，但工具和计算策略也不同：部分可执行脚本或 shell，RLM 可追加子模型调用。不能把所有差异都解释为短提示词或压缩比，也不能由宏平均推断每个任务的优劣；例如 mini-swe 的备忘录表现与 OpenCode 的程序追踪表现不同。

| 条件 | 作者实验 | m1tera 当前新增评测 |
|---|---|---|
| 模型 / 推理 | GPT-5.6-sol / high | GPT-6.1-sol / low（当前选用模型） |
| 题量 / repeats | 每套 50 题；论文实验 | 默认每套 2 题；固定前缀、单次尝试 |
| Agent 工具 | 按 Harness 的实际能力，包括脚本与额外模型策略 | 初始目录、分页读取、字面搜索；外置时本题 `read_artifact` |
| Direct 工具 | 直接读取 | 完整选中上下文、0 工具、1 次模型请求 |
| 累计 tokens | 每实例 3M 输入加输出 | 300,000，完整响应后检查；单请求可越界，缺 usage 时无法证明遵从 |
| Agent 轮数 / 时限 | 按作者 Harness 配置，未把本项目默认值归入作者实验 | 默认最多 24 次模型请求、300 秒；设置可调整至最多 24 轮 / 600 秒，Direct 最多 1 轮 / 120 秒 |
| 费用 | 论文当时 API 价格、缓存假设下估算 | ChatGPT 订阅请求不据此换算美元成本 |

因此本项目新增成绩另表保存，不插入这张论文表作为同条件排名。未来若做 Harness 消融，至少固定模型、推理档位、题目 IDs、工具权限、budget、repeats 和 grader，并保留真实累计 usage、未知数和边界停止原因。LongHarness 对程序等价的标签是测试契约内行为一致，不是任意 Python 输入上的形式证明。[数据卡与限制](https://huggingface.co/datasets/StringNLP/longharness)

## 其他发布成绩的口径

| 产品 / 发布来源 | 可核验公开结果 | 不能直接合并的原因 |
|---|---|---|
| Deep Agents 固定 scorecard | gpt-5.6-sol unified lite 36 题、每题 3 rollout，macro avg@3 0.568；其 Letta context lite 10 题 avg@3 1.000 | 不是单次 pass@1，不是 m1tera 的固定前缀，模型 / judge / 工具不同 |
| Hermes Bench | Opus 5.5：150 tasks 的 mean reward 76.73/100，$0.516/task | 存在部分奖励，不能改成 76.73% 完整成功；版本 SHA 与全部预算未公开 |
| Letta Filesystem v2 | 2026-03-13 更新页：gpt-5.2-codex-xhigh rubric 93%，总成本 $44.46 | 是 Filesystem v2，不是本项目或 Deep Agents 的 filesystem-cloud 子集，页面分母 / repeats 未列明 |
| OpenHands SDK 论文 | matched Sonnet 4.5：V0 64.6% → V1 72.8% SWE-bench Verified | 论文历史实验；V1 同时增加 extended thinking，不能全归因于上下文处理，也没有补为当前 TB 4.0 登记 |

以上是发布方数据，来源和具体条件见 [Harness 发布评测调研](harness-launches-2026-10-13.md)。Deep Agents、OpenHands、Goose、Pi durable 本轮没有核验到同版 TB 4.0 产品成绩的项目保持空白，不从其底座模型补数。

m1tera 固定日志样本的累计输入**估算**减少 80.05%，与 Deep Agents 首轮 hello **实际输入**减少约 65% 的测量对象、来源、工具集均不同；它们只能各自说明一个场景，不构成产品高低比较。[本地管线样本](harness-local.md)、[Deep Agents 原始 PR](https://github.com/langchain-ai/deepagents/pull/5009)

作答的累计 token 预算按已完成响应统计；Letta 评分请求另计。报告中的累计 usage 包括评分，所以不能用包含评分的总量验证作答预算。
