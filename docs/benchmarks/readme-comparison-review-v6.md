# README Benchmark 与外部比较终审（v0.6 / LongHarness 合同 v3）

日期：2026-10-13。范围：README Benchmark 章节、比较来源 Markdown/JSON、产品比较、Harness 发布调研、评测协议，以及直接相关的预算、工具、评分与用量代码。最终公开合同 v3 及实测文档终审通过，没有发现需要再次修改代码或构建的协议缺漏。本审查未修改产品实现或主文档，未重新调用模型或其他产品，未读取用户会话或凭据。已独立核对主代理保存的九份有效实测报告、官方复核与最终四份文档；没有剩余修改清单。

## 核对通过

- TB 4.0 五家产品、七种配置的模型、推理档位、成绩、95% CI 半宽与 UTC 登记日期，逐行匹配保存的原始 JSON。330 trials、66 题 × 5 次的分母保持独立；登记日期没有改写成模型发布日期或实际运行日期。模型不同与产品配置未知的限制已写明，没有将本项目 BFCL/SimpleQA 子集并入该排名。
- LongHarness 论文 Table 2 的 GPT-5.6-sol 五行宏平均与每实例美元成本完全匹配：Direct 60.0% / $0.822、RLM 53.5% / $4.30、OpenCode 40.5% / $2.90、mini-swe-agent 68.0% / $0.816、ReAct 43.0% / $1.93。论文采用 high 推理、3M 累计输入加输出预算；四任务名称与每套 50 题、共 200 题，由固定 revision 数据卡确认。比较报告保留程序追踪的格式容错答案加引用复核条件，未将论文美元成本解释为 ChatGPT 订阅花费。[论文](https://arxiv.org/html/2609.38137)、[固定数据卡](https://huggingface.co/datasets/StringNLP/longharness/blob/95c54a1646cc486f6702308a1e820cb361960fd4/README.md)
- Letta Filesystem cloud、Filesystem v2、EuniAI 的代码 ContextBench 已区分。官方 rubric 的 0.5 是明确拒绝且未尝试，不能作为一般部分正确奖励；本地 meanReward 与 reward=1 完整正确率分开。Letta v2 的 93% / $44.46 / 2026-03-13 与官网一致，未用于 cloud 子集排名。[rubric](https://raw.githubusercontent.com/letta-ai/letta-evals/main/letta-leaderboard/filesystem-agent/rubric.txt)、[Letta 榜单](https://leaderboard.letta.com/)
- Deep Agents 固定 scorecard 的 sol macro avg@3 0.568、micro avg@3 0.528、context lite avg@3 1.000 与源码一致；Hermes 官网明确 150 tasks 和 mean reward 中包含部分奖励。README 没有将这些指标改写为单次完整成功率。[固定 scorecard](https://raw.githubusercontent.com/langchain-ai/deepagents/a96a3b63b206feef23af9237a1a64a93d1f52aef/libs/evals/UNIFIED_SCORECARD.md)、[Hermes 榜单与 FAQ](https://portal.nousresearch.com/bench)
- v0.5 的 18/20、90%；16/20、80%；未知均为 0，以及 32,080 输入 tokens 匹配保存报告。两套旧结果明确限定为固定 20 题单轮子集；SimpleQA 同模型评分与 3 错误、1 未作答已披露，没有扩展成新版长任务或完整 Agent 成绩。
- 当前七套默认共 51 题、五套新集合固定前缀且每题一次尝试、Direct 仅作用于 LongHarness，匹配目录与 CLI。题目工具只闭包读取本题语料，gold 与路线提示没有进入作答 prompt 或工具。
- 文件类作答预算为 300,000 累计输入加输出，按完整响应检查；单次越界、usage 缺失无法证明遵从、Letta judge 另计而报告总量包含 judge，均已明确。fixture 能力分数为 null，未知成绩与已知 usage 小计分开，没有用 0 补足真实用量。

## 已反馈并修正的实质条件

1. **Letta target。** 已纠正为官方 YAML 的 `target.kind=letta_agent`，并注明 `agent_script=setup_cloud_agent.py:setup_agent`；num_runs、judge 与 extractor 均匹配。[官方 YAML](https://raw.githubusercontent.com/letta-ai/letta-evals/main/letta-leaderboard/filesystem-agent/filesystem_cloud.yaml)
2. **费用覆盖。** 来源 Markdown、比较表与 JSON 限制段均已注明 Grok 费用仅覆盖 324/330 trials；原始费用和 metrics 保留。
3. **CLI 本地端点例外。** 已限定远程接口无凭据时 blocked；本地端点可以通过配置预检，configured 不证明连通性或模型成绩。
4. **动态工具与运行边界。** README、比较表与评测协议已统一披露初始三工具、外置后本题限定 read_artifact、Agent 上限 24 轮 / 600 秒、作答达到边界计失败与 grader 达到边界计未知。

以上均是条件或来源字段的校正，不要求编造新成绩，不构成已核模型分数的数字错误。主代理已修正上述来源字段、JSON 限制段、CLI 例外及工具/预算/评分边界说明；已只读复核这些同步修改。

## 最终实测与四份文档终审

已逐行核对 README、[v0.6 实测](evaluation-v6.md)、[产品比较](comparison-2026-10-13.md)、[v0.6 验证记录](../validation-v6.md) 与九份有效原始报告。各集合结果如下，未知不进入已判分分母：

| 集合 / 轨道 | 正确 / 已判分 | 未知 / 全部 | 服务商输入或已知小计 |
| --- | ---: | ---: | ---: |
| Letta Agent | 3/3 | 0/3 | 175,037，含另次同模型评分 |
| 条件搜索 Agent | 0/1 | 1/2 | 总量未知；已知 334,877 |
| 条件搜索 Direct | 2/2 | 0/2 | 214,225 |
| 冲突备忘录 Agent | 0/2 | 0/2 | 总量未知；已知 676,519 |
| 冲突备忘录 Direct | 0/2 | 0/2 | 123,982 |
| 程序追踪 v3 Agent | 0/1 | 1/2 | 总量未知；已知 38,152 |
| 程序追踪 v3 Direct | 2/2 | 0/2 | 255,149 |
| 等价程序 Agent | 0/1 | 1/2 | 总量未知；已知 334,130 |
| 等价程序 Direct | 0/1 | 1/2 | 总量未知；已知 79,555 |

九份有效报告共处理 19 个样本：15 个已判分、4 个未知，其中 7 个正确、8 个失败；这只是计数核对，不合成为跨数据集能力总分。另目录中的六题 tracing v1/v2 调试记录已排除，不选择重跑的最高分。

已知输入小计独立相加为 **2,231,626 tokens**，已包含已知 cache read **138,112**，已知 cache write 为 0。每条已报告 usage 都满足 input + cacheRead + cacheWrite = totalInput。五份报告存在缺失 usage，完整输入、输出及全部请求/工具总数不能由已知小计补成确定值。文档正确保留这些未知，没有再加一次缓存，也没有把本地估算用作服务商实际用量。

最终 tracing 两报告的协议均为 v3，prompt SHA 与公开合同终审一致。Agent 可评分题的 answer 是 JSON 对象且 answerExact=true，但证据集合不匹配，完整 exact 失败；另一题请求异常，成绩与用量保持未知。Direct 两题 answer/evidence 均 exact，输入 255,149、输出 312、2 次请求、零工具、26.754 秒；文档按 26.8 秒展示正确。Agent 耗时 125.800 秒，按 125.8 秒展示正确。

[固定官方 Python 复核](longharness-official-check-live-v6.json) 中 8 份完整可评分预测与本地逐题判定 **8/8 一致**；另 8 个 LongHarness 样本为运行边界或未知，没有强行评分。复核没有新增模型请求。九份表中请求、工具执行与耗时的其余数值同样匹配原始报告。

四份最终文档没有残留的待测、待授权或另行补录承诺，检查到的本地链接均存在；README 和产品比较的 TB4 七配置再次与来源 JSON 匹配。v0.5 历史数字保留；当前验证链接指向 v0.6。453 项固定自动化检查与 8 组包内 smoke / 499 条断言的文档计数匹配保存记录，本审查未重新执行这些检查。

## LongHarness 最终公开合同 v3

已核对固定 GitHub 提交 `6e3da81caa79a0fa53c150aa458b7e4e0c074e87` 的四类任务说明、固定 HF revision `95c54a1646cc486f6702308a1e820cb361960fd4` 的全局 Evaluation Protocol、官方 scorer，以及最终 `buildLongHarnessPrompt` / 运行包装。[官方全局 schema](https://huggingface.co/datasets/StringNLP/longharness/blob/95c54a1646cc486f6702308a1e820cb361960fd4/README.md)、[官方 tracing 说明](https://github.com/StringNLPLAB/longharness/blob/6e3da81caa79a0fa53c150aa458b7e4e0c074e87/tasks/program-execution-tracing/README.md)

| 任务 | 模型可见合同 | 与评分规则的关系 |
| --- | --- | --- |
| 条件搜索 | 单个 JSON 对象、唯一键 matches、全部满足条件的字符串人名 ID、字典序排序 | 完整 ID 集合 exact；与官方一致，不要求证据 |
| 冲突备忘录 | 全部 15 个冲突 memo ID，保留原文 Final Answer 列表格式 | 完整 ID 集合 exact，拒绝重复；原文裸 ID 列表可解析为字符串集合 |
| 等价程序对 | JSON 整数二元组数组、每个 cell 最多出现一次、全部配对、规定排序 | 配对成员与外层集合规范化后 exact；不猜测或补缺少的配对 |
| 程序追踪 | 唯一 answer / evidence 两键；answer 是最终 out 的 JSON 对象，保留字段和值类型，明确禁止 JSON 编码字符串或 quoted stdout；evidence 为八个互异整数 cell ID | 对象结果深度 exact 与证据集合同时 exact；无字符串反序列化或数值/ID 转换 |

tracing 原始 Final Query 与禁止执行的要求保留。v3 是对公开 schema 的完整传达，不根据 gold 生成字段或示例。全局 README 含其他题的答案示例，仅在外置缓存中验证来源，不拼入 prompt；模型只得到选中上下文与不含答案值的固定合同文字。

独立直接调用纯函数 `buildLongHarnessPrompt`，读取八个公开样本，重算上下文与 prompt SHA：全部与 [v3 来源核验](longharness-protocol-v3-check.json) 一致。constraint、memos、pairs 各两例，共六例的 prompt 字节与原协议完全相同；通用 Agent / Direct 包装也未改变，无需因这次合同修复重测。tracing 两例的最终 prompt SHA 分别为：

- `program-execution-tracing_00000`：`0854d04e108e45459eca66fedb34b5ed5cf5967dc643d600027d43b0d8df5758`
- `program-execution-tracing_00001`：`de535f2dbe0c771c1ed5aded3b4d72a15e8865d0fec6c1c2f99684009428eec1`

独立文件哈希复核：全局 README 为 `f5e0145805d15bcd6ecabdf1b0e957f6200ca8bf7fd73f5fe7da682e2192aefd`；tracing README 为 `5e132a34f8793ce627acf02d0193d782de6d2c25af17489ab25b4fbf7c98991f`；官方 score.py 全文为 `0a59d0ec8d2a1b9108f277d19260abd2638034ee9a284015f22d90792baa1729`。核验 JSON 中的 `scorerUnchangedSHA256=9611d0…` 指 TypeScript 模块从 `function strings(` 到文件末尾的评分段，其哈希同样独立匹配；它不是官方 Python 文件全文哈希。评分段保持严格比较，没有因模型输出改动解析规则。

## 旧 tracing 输出与答案隔离

v1 没有传达 answer / evidence；v2 补充了两字段与证据，但未明确 answer 对象类型，而原 query 使用 print(json.dumps(out))，存在编码字符串歧义。旧 v1 / v2 报告只保留用于调试，不作能力成绩。v2 Direct 两题的严格 0/2 与证据 exact 成立，但不能据此声称计算或证据能力为 0；不解码旧答案以补算成功。[论文 Table 4](https://arxiv.org/html/2609.38137) 提到格式容错复核，未提供足以确认本类字符串容错的规则，不能替作者推定成功。

服务端历史摘要与 UI 历史、详情都以 `longharness-task-contract-v3` 为有效 tracing 门槛；非 v3 标为输出协议不完整的调试记录，准确率隐藏，原始输出与 usage 保留供审查。v3 的实际模型结果已由修复后的四题重测提供，并作为独立有效报告保存。后续模型在已完整说明的合同下失败，不再因此修改合同或评分。

执行路径未发现答案泄露、代码执行或额外模型调用：gold、manifest 与 scorer 不进入作答 prompt 或文件工具；Agent 工具闭包只包含本题原文，Direct 为零工具。动态 read_artifact 限于当前题随机 session 与已披露 ID，无法访问其他题、gold 或完整缓存。全局 README 的答案示例只供来源核验。原文程序作为字符串读取，未进入 exec / eval；模型推理请求不走普通聊天的原生 web search 注入路径。

工具可观测口径保持：observedTools / settings.tools 是实际请求中出现的工具 schema 集合，toolCallCount 是接受执行的工具调用次数。当前 README 对 300,000 作答预算、完整响应检查、评分另计、未知分数与 usage 的说明符合代码。

## 验证范围

本审查采用本地原始 JSON、保存的官方复核、最终主文档及代码只读交叉核对；通过 Search 技能直接读取上述已引用的官方/作者来源，没有运行新搜索。最终 v3 纯函数核验为零网络请求、零模型请求，不执行上下文程序。没有重跑自动化测试或真实 benchmark；本轮执行与原生授权由主代理完成，本审查独立核对保存结果与最终交付文档。
