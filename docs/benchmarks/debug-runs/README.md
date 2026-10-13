# 适配调试记录

本目录保留程序追踪适配调试的原始真实请求报告，不进入 README 能力实测表或策略比较，也不修改原始分数。

| 原始报告 | 调试问题 |
| --- | --- |
| `longharness-tracing-agent-missing-contract-v6.json` | 首次两题漏传 `answer` / `evidence` 要求 |
| `longharness-tracing-agent-missing-answer-type-v6.json` | v2 说明未明确 `answer` 对象类型；一题未知，一题字符串答案及错误证据 |
| `longharness-tracing-direct-missing-answer-type-v6.json` | v2 两题都把 `answer` 编码为字符串，证据匹配；公开 schema 披露仍不完整 |

原适配器仅传递 context 中的 Final Query。该段只要求最终程序输出，但固定上游任务说明另要求 `answer` 与八个支持 cell ID 的 `evidence`。缺少这一公开要求导致模型无法从答题 prompt 得知完整评分协议。修复仅为程序追踪补齐任务级要求，未改 gold、解析器或 exact 评分规则，也未改变其他三类任务的模型 prompt。

v2 补齐字段后，仍用“最终输出”描述 `answer`。查询末尾为 `print(json.dumps(out))`，模型据此返回 JSON 编码字符串；固定上游全局 Evaluation Protocol 则要求 `answer` 为对象。最终协议进一步明确保留结构化对象，不能将其再次编码为字符串；解析器和官方 exact 规则保持不变，不通过后处理补答案或证据。

来源：[固定任务说明](https://github.com/StringNLPLAB/longharness/blob/6e3da81caa79a0fa53c150aa458b7e4e0c074e87/tasks/program-execution-tracing/README.md)、[固定公开 Evaluation Protocol](https://github.com/StringNLPLAB/longharness/blob/6e3da81caa79a0fa53c150aa458b7e4e0c074e87/README.md#evaluation-protocol)。新报告记录适配协议版本及每题基础任务指令 SHA256；旧原始报告保持原样，桌面应用将此类旧程序追踪报告标为协议不完整的调试记录。

上述六题为调试消耗，未计入最终十九题能力样本。已报告输入小计为 391,490 tokens，其中 v2 Agent 一题请求异常，因此调试输入与请求总量未知。
