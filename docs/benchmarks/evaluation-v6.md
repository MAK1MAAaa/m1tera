# 0.6.0 真实评测

使用用户为本应用独立授权的官方 ChatGPT 连接，模型为 `gpt-6.1-sol`、low 推理，目录上下文上限为 500,000 tokens。每题空历史、空系统提示词、不加载用户文件、Skills 或记忆；只有固定公共评测语料进入请求。运行日期为 2026-10-13（Asia/Shanghai），每题按完整协议一次尝试，样本为固定前缀；此前适配调试另列，不选取多次运行的最高分。

## 已完成结果

| 集合 / 轨道 | 正确 / 已判分 | 未知 / 全部 | 输入 tokens | 请求 / 工具执行 | 耗时 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Letta Filesystem cloud · Agent | 3 / 3 | 0 / 3 | 175,037 | 27 / 92 | 153.7 秒 |
| LongHarness 条件搜索 · Agent | 0 / 1 | 1 / 2 | 总量未知；已知 334,877 | 未知 / 未知 | 176.8 秒 |
| LongHarness 条件搜索 · Direct | 2 / 2 | 0 / 2 | 214,225 | 2 / 0 | 30.4 秒 |
| LongHarness 冲突备忘录 · Agent | 0 / 2 | 0 / 2 | 总量未知；已知 676,519 | 31 / 29 | 199.0 秒 |
| LongHarness 冲突备忘录 · Direct | 0 / 2 | 0 / 2 | 123,982 | 2 / 0 | 158.0 秒 |
| LongHarness 程序追踪 · Agent | 0 / 1 | 1 / 2 | 总量未知；已知 38,152 | 未知 / 未知 | 125.8 秒 |
| LongHarness 程序追踪 · Direct | 2 / 2 | 0 / 2 | 255,149 | 2 / 0 | 26.8 秒 |
| LongHarness 等价程序 · Agent | 0 / 1 | 1 / 2 | 总量未知；已知 334,130 | 未知 / 未知 | 106.4 秒 |
| LongHarness 等价程序 · Direct | 0 / 1 | 1 / 2 | 总量未知；已知 79,555 | 未知 / 未知 | 61.3 秒 |

九份有效报告共处理 19 个样本，15 个已判分、4 个未知；不合成跨数据集能力总分。输入已知小计为 2,231,626 tokens，其中缓存为 138,112，已包含在小计内；五份报告存在缺失 usage，完整总用量未知。六题适配调试消耗另见 [调试记录](debug-runs/README.md)。

Letta mean reward 与全正确比例均为 100%。其评分是另一次同模型请求，存在自评偏差；输入、输出及请求数包含评分。全量有 100 题，三题不足以估计总体能力。LongHarness 每类 50 题，本轮各两题，不据此申报榜单或合成跨数据集总分。

Agent 初始使用本题虚拟目录的列目录、Unicode 分页读取与字面搜索，出现外置结果后可加入只读本题的 `read_artifact`；不执行程序。Direct 一次放入完整原文，零工具。报告工具名称记录请求中出现的 schema，工具执行次数另记。输入 tokens 已包含 cache read/write，不再额外相加；耗时包含数据加载及本地运行开销，不等同于纯模型推理延迟。

每题作答预算累计 300,000 input+output tokens，在完整响应后检查，一次请求可能跨过预算；缺 usage 时总量未知，但保留已报告小计。Agent 默认最多 24 次模型请求、300 秒，Direct 最多一次请求、120 秒。Letta 的 grader 另计。作答触达预算、轮数或超时边界计失败；评分触达边界或请求异常计未知。

## 失败与适配边界

条件搜索 Agent 首题触达 token 预算，另一题发生请求异常，原因未确认，不能补成错题。备忘录 Agent 两题均触达预算；Direct 两题返回合法 ID 集合，但未满足完整 exact 集合。保留这些失败，不放宽 gold 或按部分命中改算成功。

等价程序 Agent 一题请求异常、一题触达 token 预算；Direct 一题返回合法但不完整的配对集合，另一题请求异常。异常具体原因未确认，不能将未知题目当作能力失败或估算缺失用量。

程序追踪首次调试漏传了上游 `answer` / `evidence` 要求，v2 仍未明确 `answer` 为对象，不能作为能力结果。原始报告作为 [调试记录](debug-runs/README.md) 保留。修复仅补齐程序追踪的公开输出协议，其他三类 prompt 不变；最终 v3 的 Agent/Direct 四题已完成重测。Agent 一题请求异常；另一题结构化结果精确正确，但证据集合不匹配，因此完整 exact 失败。Direct 两题的结果与证据均精确正确，未知为 0。新报告记录协议版本与基础任务指令摘要，数据摘要不代替运行协议摘要；[八例真实缓存的字节核验](longharness-protocol-v3-check.json) 证明条件搜索、备忘录与配对 prompt 保持一致。

当前结果表明，分段检索在本组样本中可能反复发送历史，导致累计输入超过 Direct；它不证明 Agent 普遍更差，也不证明较短首轮提示词会降低总成本。需要更大样本、重复运行和同条件消融才能判断优化方向。

## 原始报告与复核

- [Letta Agent](letta-context-gpt-6.1-sol-live-v6.json)
- [条件搜索 Agent](longharness-constraint-agent-gpt-6.1-sol-live-v6.json)、[Direct](longharness-constraint-direct-gpt-6.1-sol-live-v6.json)
- [冲突备忘录 Agent](longharness-memos-agent-gpt-6.1-sol-live-v6.json)、[Direct](longharness-memos-direct-gpt-6.1-sol-live-v6.json)
- [程序追踪 Agent](longharness-tracing-agent-gpt-6.1-sol-live-v6.json)、[Direct](longharness-tracing-direct-gpt-6.1-sol-live-v6.json)
- [等价程序 Agent](longharness-pairs-agent-gpt-6.1-sol-live-v6.json)、[Direct](longharness-pairs-direct-gpt-6.1-sol-live-v6.json)
- [固定官方 Python 复核](longharness-official-check-live-v6.json)：8 份可评分预测逐题与本地判定一致，另 8 题为运行边界或未知而不复核；未新增模型请求，也不将未知题目强行判成错误。

数据版本、下载校验、评分协议及 CLI 见 [运行说明](../../benchmarks/README.md)。外部 Terminal-Bench 4.0 榜单和 LongHarness 论文采用独立条件，见 [产品比较](comparison-2026-10-13.md)。v0.5 BFCL / SimpleQA 保留在 [历史报告](evaluation-v5.md)。
