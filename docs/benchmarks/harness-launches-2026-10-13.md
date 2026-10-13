# Harness 发布评测调研（2026-10-13）

本报告核对发布者官网、官方代码及原始榜单，供 README 展示和新增评测选型使用。检索优先窗口按客户端日期计算：2026-10-13 减 6 个月 = **2026-04-13 至 2026-10-13**；持续更新的较早官方榜单另标日期。下列数字是发布者报告，**不是 m1tera 复测结果**。

检索统计：7 条有效 Exa 搜索请求的 `numResults` 合计 **47**；首轮 4 条请求因缺少连接器必填 `objective` 被拒绝（请求数量合计 32）。按技能“含重试的 numResults 合计”口径，`sources_reviewed=79`；没有把这 79 当成实际验证的 79 个独立来源。去重后验证了 **25 个 primary URL**；OpenHands Index 动态榜单没有提取到正文，未计入已验证来源。搜索中的媒体复述和同名非官方页面未用于成绩。

## 发布者展示什么

| 产品 / 发布 | 发布时间 | 发布评测集 | 重点与适配判断 |
| --- | --- | --- | --- |
| Deep Agents 0.7 | 2026-07-29 | Harbor-Index、τ³-bench、Letta Context-Bench | 从单步工具调用扩展到自主任务、多轮对话和多文件上下文检索。Letta filesystem-cloud 最适合当前 Node / Pi harness；可执行文件操作，保留相同 rubric，同时报告真实 usage。 |
| Deep Agents 0.6 | 2026-05-13 | Terminal-Bench 2.0、tau2-bench | 发布页给出同模型 harness 调整前后结果；版本及预算未完整披露的数字不能与 m1tera 作排名。 |
| Hermes Index / Hermes Agent | 官网未写精确发布日期；抓取日期 2026-10-13 | Hermes Bench、TerminalBench 4、TerminalBench Science、SkillsBench | 综合任务完成与每题成本，覆盖 skills、记忆、研究、图形等。适合规划更全面能力矩阵；当前公开页未固定 harness SHA 和全部评测数据 SHA，不能宣称已复现。 |
| OpenHands SDK / Index | 引介页日期未知；SDK 论文 MLSys 2026 | SWE-Bench Verified、Commit0、SWE-Bench Multimodal、SWT-Bench、GAIA | 软件工程能力和成本 / 时长分开列出；需要容器、完整工作区和专门 verifier。应作为后续 Harbor 适配，不能用简短问答代替。 |
| Pydantic AI Harness | AI v2：2026-06-23；Harness Week：2026-07-20 | 已核对的发布页 / 官方 repo 未提供可核验公开综合 benchmark 成绩表 | 不能填零分，也不能把 capability 数量当评测成绩。其工具按需加载、代码执行时过滤中间结果可作为上下文效率评测的实验变量。 |

来源：[Deep Agents 0.7](https://www.langchain.com/blog/deep-agents-v0-7)、[Deep Agents 0.6](https://www.langchain.com/blog/deep-agents-0-6)、[Deep Agents 评测方法](https://www.langchain.com/blog/how-we-benchmark-deep-agents)、[Hermes 原始榜单](https://portal.nousresearch.com/bench)、[OpenHands Index 引介](https://www.openhands.dev/blog/openhands-index)、[OpenHands SDK 论文](https://arxiv.org/html/2511.03690)、[Pydantic Harness Week](https://pydantic.dev/articles/harness-week)。

## 可展示的精确公开成绩与条件

| 产品 / harness 版本 | 模型 | Benchmark 精确集合 | 分数及单位 | 题量 / 次数 | 环境、预算、复现条件 | 与 m1tera 可比性 |
| --- | --- | --- | --- | --- | --- | --- |
| Deep Agents bare，固定源码 `a96a3b63…` 的公开 scorecard | gpt-5.6-sol | unified lite：15 Harbor-Index + 11 τ³ + 10 Letta context | macro avg@3 **0.568**；micro avg@3 **0.528** | 36 题，每题 3 rollout | Docker；run 29885020820；具体模型 token / 时间预算未在 scorecard 列明；harness release tag 未列明 | 原始版本可审计，但不是 gpt-6.1-sol、不是 pass@1，也不是 BFCL / SimpleQA；只能作外部参考 |
| 同上 | gpt-5.6-sol | Letta context-retrieval lite | avg@3 **1.000**，pass@3 **1.000** | 10 题 × 3 | 同一 run；LLM rubric；精确集合见 lite profile | 可在相同子集复测；模型 / judge / 工具集差异仍须保留 |
| Deep Agents bare，full scorecard | gpt-5.6-terra | Letta context-retrieval-evals | avg@3 **0.811**，pass@3 **0.967** | 30 题 × 3 | 重新用忠实 model_judge 评分；judge gpt-5.6-luna；run 29883830538 | 不能和一次 rollout 的准确率直接相减 |
| Deep Agents bare，full scorecard | gpt-5.6-luna | 同上 | avg@3 **0.911**，pass@3 **0.967** | 30 题 × 3 | judge gpt-5.6-terra（独立）；同一 run | 与 self-judge 的结果须分开 |
| Hermes Agent，版本 / SHA 未列明 | Claude Opus 5.5 | Hermes Bench 150 tasks / 25 categories | mean reward **76.73 / 100**；**$0.516 / task** | 一次尝试；64 自动、77 hybrid、1 LLM judge、8 vision judge | 支持时 reasoning high；完整 token / 时间预算未知 | 官方 FAQ 明确 partial credit，**不是 76.73% 全部成功题数**；与 m1tera 现有集不可直接排名 |
| 同上 | GPT 6 Sol | Hermes Index 四 suite 宏平均 | **44.10 / 100**，**$2.23 / task** | 官网标 pass@1；总题数未知 | TB4 排除 4 GPU 题；四 suite 平均；harness SHA 未列明 | 不是 gpt-6.1-sol；不能与 m1tera BFCL 90% 比高低 |
| 同上 | GPT 6 Sol | Hermes Bench / TB4 / TB Science / SkillsBench | **73.50 / 23.8 / 18.6 / 60.5**（0–100） | Hermes Bench 150；其余当前页题数未知 | 对应每题成本 **$0.263 / $2.53 / $5.70 / $0.42** | 各 suite 独立展示，禁止混成“Agent 准确率” |
| OpenHands SDK V1，论文架构 | Claude Sonnet 4.5 | SWE-Bench Verified | V0 **64.6%** → V1 **72.8%** | 论文这一表未列尝试次数 | matched model；V1 新增 extended thinking；具体 SDK SHA 和推理预算未知 | 同模型仍改变推理功能，不能全归因于上下文优化；外部历史参考 |
| Letta code agent，Filesystem v2 榜单 | openai/gpt-5.2-codex-xhigh | Filesystem v2 | rubric **93%**，**$44.46 总成本** | 当前页面未列分母 / 次数 | 最后更新 **2026-03-13**，不在近期窗口；不是 cloud 30 题版本 | 保留为持续更新原始榜单，不能当 Deep Agents 用的 cloud 子集成绩 |

精确来源：[Deep Agents 固定 scorecard](https://github.com/langchain-ai/deepagents/blob/a96a3b63b206feef23af9237a1a64a93d1f52aef/libs/evals/UNIFIED_SCORECARD.md)、[30 题集合与校准](https://github.com/langchain-ai/deepagents/blob/a96a3b63b206feef23af9237a1a64a93d1f52aef/libs/evals/datasets/context-retrieval-evals/README.md)、[Hermes 榜单与 FAQ](https://portal.nousresearch.com/bench)、[OpenHands 论文 Table 4](https://arxiv.org/html/2511.03690)、[Letta 原始榜单](https://leaderboard.letta.com/)。

Hermes 的 Opus 总 Index 63.31 / $4.99 与 Sonnet 总 Index 53.14 / $2.82 都标 `*`，官网解释为部分运行或成本估计、待完整重跑，README 若展示必须带 provisional。SkillsBench 部分模型曾检索公共 solution；官网以 clean 分数计算 Index，并将 raw 分数旁列。没有把 clean / raw 混用。

## 上下文效率：基线令牌与任务全过程分开

Deep Agents 0.7 发布的 65% 是默认首轮 **base input footprint**。原始 PR #5009 单次 gpt-5.5 “hello” 请求实际 input usage 为 5,395 → 1,895。工具描述离线统计为 4,005 → 2,302（43%）。这些不是任务准确率，也不能与 m1tera 单个长日志样本“全过程输入减少 80.05%”同台排名。[原始实验 PR](https://github.com/langchain-ai/deepagents/pull/5009)

PR 当前网页的 cross-branch 配对报告比较 `beta/deepagents-0-6-12` 与 `beta/deepagents-0-7-0b2`，**36 题 × 每题 3 次**。gpt-5.6-luna：mean reward 0.3657 → 0.3796（+3.8%，95% CI −9.9% 至 +18.4%）、成本 $14.37 → $12.18（−15.2%）、总 tokens 48.60M → 31.33M（−35.5%，CI −42.3% 至 −28.7%）。reward CI 跨 0，不能称质量显著改善。发布 blog 将 tokens 变化概述为 −34%；本报告保留原始 PR 的数值与版本，未把两者拼成同一次精确试验。

适合 m1tera README 的上下文效率列：相同任务的正确率 / mean reward、首轮实际输入、所有步骤输入（含缓存）、输出、模型调用次数、工具调用次数、wall time、judge 用量。服务商缺 usage 时保持 unknown；用量估算另列。如果换模型、额外 tool、judge 或任务子集，不能把差异全部记到 harness 上。

## 优先新增：Letta Context-Bench filesystem-cloud

这不是另一套同名的代码库 ContextBench（1136 repo tasks）。Deep Agents 使用的是 Letta 合成人物 / 车辆 / 宠物 / 账户 **filesystem-cloud**，符合 m1tera 当前工作区文件工具和上下文裁剪目标。

| 项目 | 已核条件 |
| --- | --- |
| 原始官网 / repo | [leaderboard.letta.com](https://leaderboard.letta.com/)；[letta-ai/letta-evals](https://github.com/letta-ai/letta-evals/tree/main/letta-leaderboard) |
| 原始数据 | `letta-leaderboard/filesystem-agent/datasets/filesystem_cloud.jsonl`，100 records；`files/*.txt`，10 文件 |
| 冻结来源建议 | 用 Deep Agents 已核固定 commit `a96a3b63b206feef23af9237a1a64a93d1f52aef` 的 `libs/evals/harbor_adapters/contextbench/vendor/`；记录每个文件 SHA256，避免 main 更新漂移 |
| 许可证 / gate | vendored 未改 Apache-2.0 LICENSE；上游无 NOTICE。已核数据页无需登录；无需 Hugging Face token |
| 发布集合 | [30 题 README](https://github.com/langchain-ai/deepagents/blob/a96a3b63b206feef23af9237a1a64a93d1f52aef/libs/evals/datasets/context-retrieval-evals/README.md)：2 easy、10 medium、18 hard；源数据 100 题，不是 30 题全榜 |
| 完整输入 | 每题给相同的完整 10 文件语料（源 64.7K 行）；不要只放 required_files，以免透露检索路线 |
| 隐藏字段 | `ground_truth`、`agent_args.extra.required_files`、`verification_query` 只进入 verifier / 审计记录，不能进入 agent prompt、工具结果或可读取工作区 |
| 原始运行配置 | [filesystem_cloud.yaml](https://github.com/letta-ai/letta-evals/blob/main/letta-leaderboard/filesystem-agent/filesystem_cloud.yaml)：`num_runs=3`、`target.kind=letta_agent（agent_script 为 setup_cloud_agent.py:setup_agent）`、judge `gpt-5-mini`、`extractor=last_assistant`；具体 task 时间 / token 上限未列明 |
| 评分 | [原始 rubric](https://github.com/letta-ai/letta-evals/blob/main/letta-leaderboard/filesystem-agent/rubric.txt) 仅 0 / 0.5 / 1：正确=1，失败=0，明确 refusal 且未尝试才=0.5。名字、数值、措辞和隐含单位可等价，因此不应使用简单 exact match |
| Deep Agents 评分差异 | [固定 judge.py](https://github.com/langchain-ai/deepagents/blob/a96a3b63b206feef23af9237a1a64a93d1f52aef/libs/evals/harbor_adapters/contextbench/templates/judge.py)：相同 rubric / json_schema，judge 由环境注入、输出读取 `/app/answer.txt`；保留这两项区别 |
| 新版实现建议 | 独立临时工作区，整个语料只读；相同工具和预算；直接调用现有 createHarnessAgent；保存逐题轨迹与真实 usage；评分失败标 unknown，拒绝自动记成0；最终 mean reward 与完全正确比例同时列出 |
| 可比性 | 最好固定发布者相同 30 题，再运行 3 次与独立 judge。若只做20题/1次或用当前 gpt-6.1-sol self-judge，结果明确另列，不能算发布者成绩的提升百分比 |

Harbor-Index、τ³ 的适配成本更高：前者涵盖 82 个真实环境任务，后者需要用户模拟器和领域状态；Deep Agents 当前源码默认 3 rollouts，并区分 pass@K（至少成功一次）和 avg@K（全部预期 trial 的平均 reward，缺失 trial 计失败）。这些指标应保留原名。发布页和源码后来增加的 DRBench research axis 也要分日期，不能倒推成 0.7 当时已经测了四项。

## 已验证 primary URL 清单

下列 25 个 URL 去重计数；仅记录核对范围，不是每页都提取成绩：

1. https://www.langchain.com/blog/deep-agents-v0-7
2. https://www.langchain.com/blog/deep-agents-0-6
3. https://www.langchain.com/blog/how-we-benchmark-deep-agents
4. https://github.com/langchain-ai/deepagents/pull/5009
5. https://github.com/langchain-ai/deepagents/blob/main/libs/evals/UNIFIED_EVALS.md
6. https://github.com/langchain-ai/deepagents/blob/a96a3b63b206feef23af9237a1a64a93d1f52aef/libs/evals/UNIFIED_SCORECARD.md
7. https://github.com/langchain-ai/deepagents/blob/a96a3b63b206feef23af9237a1a64a93d1f52aef/libs/evals/datasets/context-retrieval-evals/README.md
8. https://github.com/langchain-ai/deepagents/blob/a96a3b63b206feef23af9237a1a64a93d1f52aef/libs/evals/harbor_adapters/contextbench/vendor/README.md
9. https://github.com/langchain-ai/deepagents/blob/a96a3b63b206feef23af9237a1a64a93d1f52aef/libs/evals/harbor_adapters/contextbench/templates/judge.py
10. https://github.com/langchain-ai/deepagents/blob/a96a3b63b206feef23af9237a1a64a93d1f52aef/libs/evals/harbor_adapters/contextbench/adapter.py
11. https://www.openhands.dev/blog/openhands-index
12. https://www.openhands.dev/blog/introducing-the-openhands-software-agent-sdk
13. https://arxiv.org/html/2511.03690
14. https://github.com/OpenHands/benchmarks
15. https://github.com/NousResearch/hermes-agent
16. https://portal.nousresearch.com/bench
17. https://pydantic.dev/articles/harness-week
18. https://pydantic.dev/articles/pydantic-ai-v2
19. https://pydantic.dev/docs/ai/harness/overview/
20. https://github.com/pydantic/pydantic-ai-harness
21. https://leaderboard.letta.com/
22. https://github.com/letta-ai/letta-evals/tree/main/letta-leaderboard
23. https://github.com/letta-ai/letta-evals/blob/main/letta-leaderboard/filesystem-agent/filesystem_cloud.yaml
24. https://github.com/letta-ai/letta-evals/blob/main/letta-leaderboard/filesystem-agent/rubric.txt
25. https://github.com/letta-ai/letta-evals/blob/main/letta-leaderboard/filesystem-agent/datasets/filesystem_cloud.jsonl

来源质量：上述来源均为 benchmark 作者、harness 维护者或官方发布者的直接材料。它们能核对原文数字与实现，仍有发布者自测、子集选择和缺失配置的偏差；没有因此将不同榜单合成统一产品排名。

