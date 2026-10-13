# 产品与 Harness 公开评测来源核验

核验日期：2026-10-13（Asia/Shanghai）。近期来源窗口：2026-04-13 至 2026-10-13。原始事实摘录见 [JSON](./product-comparison-sources-2026-10-13.json)。本文件记录公开成绩和协议，未重新运行其他产品。

## 建议展示的同版本比较

当前主表建议使用 **Terminal-Bench 4.0**，而非已经冻结的 2.0。以下是 [官方榜单](https://www.tbench.ai/leaderboard) 2026-10-13 获取的登记结果；榜单整体最近更新为 2026-10-06。每个组合运行 66 题、每题 5 次，共 330 trials。分数为 trial resolution rate，误差为榜单报告的 95% 置信区间半宽。

| 产品 / Harness | 模型 | 推理档位 | TB 4.0 成绩 | 榜单登记日期（UTC） | 登记费用，覆盖见备注 |
| --- | --- | --- | ---: | --- | ---: |
| Claude Code | Opus 5.5 | max | 64.85% ± 3.11 | 2026-10-06 | $4,718.65 |
| Claude Code | Sonnet 5.5 | max | 61.82% ± 2.94 | 2026-10-06 | $7,333.64 |
| Codex | GPT-6 Astra | max | 58.18% ± 2.79 | 2026-09-03 | $3,267.18 |
| Codex | GPT-6.1 Sol | max | 58.18% ± 3.11 | 2026-10-06 | $634.24 |
| Grok Build | Grok 4.7 | xhigh | 37.58% ± 3.54 | 2026-09-21 | $3,683.287146（324/330 trials，部分费用） |
| mini-SWE-agent | Gemini 3.8 Flash | high | 19.09% ± 3.36 | 2026-09-03 | $1,828.77 |
| Muse Code | Muse Spark 1.3 | xhigh | 14.55% ± 2.94 | 2026-10-06 | 未知，原始费用字段为 0 |
| m1tera | GPT-6.1 Sol | 现有内置评测采用 low；TB 4.0 未配置 | **未评测** | — | — |

表中其他产品版本号、实际运行日期、逐行 sandbox 和输出 token 上限均未在榜单公开，不能擅自补成最新版本或默认值。`metadata.date` 的官方列名是 **Release Date**，表示模型发布日期；JSON 同时保存它和登记时间，避免混淆。费用记录需看覆盖范围：Grok 为 324/330 trials 的部分费用；其余非零行记录为整个登记的汇总，不能当成当前价格、订阅费或单题成本；Muse 的 0 无法证明免费，展示为未知。

这些配置的模型与推理档位不同，表格展示的是**整套配置的任务完成情况**，不能把差值全部归因于 Harness。m1tera 现有 BFCL、SimpleQA 20 题子集必须另表展示，不应与这些成绩计算综合排名。

## 版本、环境和原始数据

- 数据版本：`terminal-bench/terminal-bench@4.0.0`；[GitHub v4.0.0](https://github.com/harbor-framework/terminal-bench/releases/tag/v4.0.0) 对应提交 `452bf305c6daa62fc59061d22133a7cbc7c1572e`。GitHub release 发布时间为 2026-08-26，官网新闻日期为 2026-08-28，分别保留而不混写。
- 66 个任务已通过该提交的 `tasks` Git tree 核验。榜单 `n_trials` 为 330；[官方运行指南](https://www.tbench.ai/run) 使用 `-k 5`。任务由独立 verifier 检查产物或状态。
- [4.0 说明](https://www.tbench.ai/news/terminal-bench-4-0) 将每题 agent timeout 设为 8 小时，移除 8 个任务并修复 19 个任务。官方指南明确当前任务有 GPU 需求，使用 Modal GPU sandbox 举例，也提到 Daytona GPU 支持。逐行采用何种环境未公开。
- 4.0 是持续维护的数据版本；2.0、2.1、3.0、4.0 的任务与资源发生变化，不能跨版本横向排分。
- Exa 抓取当前榜单只能读到空表骨架。本次直接读取相同官方页面的 HTML，解析 `self.__next_f.push` 中 SSR query hydration 数据；没有使用搜索 snippet 的成绩，也没有执行页面脚本。JSON 保留行 UUID、原始 metadata、metrics、数据集 UUID、页面 SHA-256 和明确的未知字段。
- 官网登记没有逐行 `checked` 字段。这里标记为“官方榜单登记，m1tera 未复现”，不额外声称所有结果已独立审计。

## 新 Harness 发布时的评测集合

[Deep Agents v0.7 发布](https://www.langchain.com/blog/deep-agents-v0-7)（2026-07-29）以 Autonomous / Conversational / Long-context 三个轴验证 v0.6.12 至 v0.7 的上下文精简，覆盖四个模型。[评测方法说明](https://www.langchain.com/blog/how-we-benchmark-deep-agents)（2026-07-23）列出：Harbor-Index 82 题、τ³-bench 30 题对话子集、ContextBench 30 题校准子集；每个任务多次运行，并同时看任务结果、tokens 与成本。

当前 [UNIFIED_EVALS.md](https://github.com/langchain-ai/deepagents/blob/main/libs/evals/UNIFIED_EVALS.md) 又将 `research` 加入默认轴，`context` 成为可选轴；默认 `rollouts=3`，同时报告 `pass@K` 和 `avg@K`，缺失的 rollout 在 `avg@K` 中算失败。`conversation` 依赖 τ³ 的模拟用户运行时，不能把单次模型调用改名为对话评测。

建议 m1tera 新增的顺序：

| Benchmark | 衡量的能力 | 接入或复现要求 | 可比较的范围 |
| --- | --- | --- | --- |
| ContextBench | 文件检索、多跳关联、有限上下文下恢复原文 | 固定数据 revision、完整任务语料、同一分页/搜索工具；固定样本并说明是否复用官方校准集 | 对上下文优化最直接；子集只对同样子集比较 |
| τ³-bench | 多轮沟通、澄清、权限和状态变更 | 使用真实 user simulator 和 outcome grader；需要完整交互 adapter | 不可用单轮答案或 mocked 用户替代 |
| Harbor-Index | 跨领域自主完成任务 | 保留各任务环境与 verifier，固定 index revision、预算和 repeats | 不应拿自行挑选的简单任务当全量 index |
| Terminal-Bench 4.0 | 长时终端任务和真实产物 | Harbor adapter、容器/GPU 独立环境、66×5 trials、每题 8 小时约束 | 以上主表对应的版本；本机局部 smoke 不算正式分数 |

这些端到端集合应与 BFCL 工具选择、SimpleQA 知识回答互补，不能以同一平均值合并。

## 不纳入当前主排名的公开数据

| 产品 / 数据 | 核验结论 |
| --- | --- |
| Deep Agents，2026-07 v0.7 | 厂商发布和原始 PR 能证明上下文改善与对应评测，但没有同版 TB 4.0 产品登记。最新 TB 4.0 应留空。 |
| OpenHands | SWE-bench 官方整套 Verified 列表可读的 OpenHands 成绩主要是 2025 年记录；例如 GPT-5 配置 71.8%、2025-08-07，超出近期窗口。不能作为 2026-10 当前产品比较。 |
| Goose / Pi durable | 本次未验证到同版 TB 4.0 的产品登记成绩；留空，不从底座模型榜单补数。 |
| SWE-bench Verified / Pro | 可保留为带版本和限制的辅助能力指标。OpenAI [2026-07-08 审核](https://openai.com/index/separating-signal-from-noise-coding-evaluations/)报告 Pro 存在大量任务问题并撤回此前推荐；不能继续把 Pro 无条件写为更可靠的新主榜。 |

Deep Agents [PR #5009](https://github.com/langchain-ai/deepagents/pull/5009) 给出真实首轮 `hello` 输入 `5,395 → 1,895`（gpt-5.5，0.6.12 至 branch，约 -65%），而离线 schema 精简本身为 `4,005 → 2,302`（约 -43%）。它们与 m1tera 固定日志样本**整次流程输入估算 -80.05%**的口径不同，不能据此宣称 m1tera 优于 Deep Agents。

## 调研计数与来源质量

本工作流进行了 11 条成功搜索（80 个 result slots，含重复）以及 4 条初次参数失败的重试（32 个 slots 未返回来源）。按 Search skill 的“全部请求 `numResults` 相加、包含重试”口径，`sources_reviewed=112`；这不是 112 个已核验独立来源。真正用于成绩的是榜单运营者的原始结构化记录；厂商发布只支持其自行报告的改善，不替代第三方复现。聚合站、估计分数站、转载和旧版本排名均未作为当前主表数字来源。
