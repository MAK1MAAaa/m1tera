# Harness 迭代调研：2026-10-13

结论：借鉴 Deep Agents 的结果外置、分页与渐进加载，以及 Pi durable 的提交边界和保守恢复；继续使用已锁定的 Pi core / ai 1.1.0。此轮不引入 LangChain 依赖链，也不替换为实验性的 durable scheduler。

三个 Exa 调研分支共检索 81 条结果（含重复；Deep Agents 25、Pi durable 25、benchmark 31）。下面的实现判断依据官方仓库、源码和评测资料；搜索结果数不表示独立来源数量。

## 查到的机制与采用范围

| 官方机制 | 本轮采用 | 边界 |
| --- | --- | --- |
| 大工具结果写入 backend，模型获得预览和读取引用 | 会话隔离的 artifact、短预览、按需 `read_artifact`，完整原文保留 | 失败保留原结果；错误、分页读取和 Skill 指令不再次外置 |
| 文件读取分页，避免反复向模型发送全文 | `read_file` 默认 4096、最大 16384 Unicode 字符，允许最多 8 MiB 文本文件 | 显式附件仍为完整读取、128 KiB 上限；权限仍检查真实路径 |
| 保存历史与模型输入投影分离 | 已完成的历史大调用参数用 artifact 引用投影；保留调用/结果配对和本轮参数 | 不丢弃原始参数或暗中总结用户需求；不宣称已实现自动 LLM 摘要 |
| 提交、工具 intent/result 和审批先 commit，再确认和显示 | 会话 JSON 同时保存 transcript 与 checkpoint；接受输入前保存，工具执行前保存 intent，完成结果保存后再发事件 | 文件同步并原子 rename；未提供跨进程锁或任意外部副作用 exactly-once |
| 中断恢复依赖安全重放声明与已保存结果 | 启动时标记中断、使旧审批过期；显式继续使用已保存结果，写入/命令重新审批 | 当前应用不自动重放工具；结果提交失败仍标未知，不推断外部操作没有发生 |
| 按需规划、Skills 与工具 schema | 保留 `/plan`、显式 `$` / `use_skill`；artifact 出现后才披露读取 schema | 新纯聊天仍为 0 工具；没有默认加载完整工具或技能市场 |
| 长任务需要停止边界 | 可配置模型轮数和运行时间，达到边界暂停并允许检查后继续 | 这些是运行预算，不是虚构的模型上下文容量，也不是自动摘要 |

Deep Agents 固定研究提交为 [`a96a3b63b206feef23af9237a1a64a93d1f52aef`](https://github.com/langchain-ai/deepagents/tree/a96a3b63b206feef23af9237a1a64a93d1f52aef)。当前大结果阈值虽以 tokens 命名，源码用字符数约 `4 × threshold` 的启发式；m1tera 使用自己的本地估算。其 [filesystem](https://github.com/langchain-ai/deepagents/blob/a96a3b63b206feef23af9237a1a64a93d1f52aef/libs/deepagents/deepagents/middleware/filesystem.py) 排除分页读取工具的通用 eviction；[summarization](https://github.com/langchain-ai/deepagents/blob/a96a3b63b206feef23af9237a1a64a93d1f52aef/libs/deepagents/deepagents/middleware/summarization.py) 处理长历史和旧大参数。

0.7 文档中的规划已经变为选用功能，默认 authored base prompt 可以为空；middleware 仍会增加说明和 schema，因此空 base 不能直接证明首轮开销小。见 [官方概览](https://docs.langchain.com/oss/python/deepagents/overview)、[上下文工程](https://docs.langchain.com/oss/python/deepagents/context-engineering) 和 [Skills](https://docs.langchain.com/oss/python/deepagents/skills)。它的耐久性来自下层 LangGraph 的 [checkpoint / durability](https://docs.langchain.com/oss/python/langgraph/checkpointers)，而非工具结果外置本身。

Pi durable 是官方同仓的 [`@earendil-works/pi-durable`](https://github.com/earendil-works/pi/tree/d5479491849127ed7ff1f49f7c5cd5507792154a/packages/durable)，研究提交为 `d5479491849127ed7ff1f49f7c5cd5507792154a`；npm 当时 latest 为 1.2.0。其 README 明标 Experimental，1.2.0 仍有破坏性接口变更。工具只有在保存时与恢复时都为 `replay: safe` 才可重跑；这个标记是宿主对幂等的承诺。m1tera 保留更保守的“不自动重放”策略。见 [工具实现](https://github.com/earendil-works/pi/blob/d5479491849127ed7ff1f49f7c5cd5507792154a/packages/durable/src/harness/tool.ts)、[上下文实现](https://github.com/earendil-works/pi/blob/d5479491849127ed7ff1f49f7c5cd5507792154a/packages/durable/src/harness/context.ts) 和 [AgentHarness 设计](https://github.com/earendil-works/pi/blob/d5479491849127ed7ff1f49f7c5cd5507792154a/packages/agent/docs/durable-harness.md)。

## 评测选择

| 评测 | 本轮范围与计分 | 能说明什么 |
| --- | --- | --- |
| [BFCL v4](https://github.com/ShishirPatil/gorilla/tree/6ea57973c7a6097fd7c5915698c54c17c5b1b6c8/berkeley-function-call-leaderboard) | 固定 10 道 simple_python + 10 道 multiple 原题；本地 AST 规则移植，与官方 Python 评分器离线对照 | 当前模型在该单轮子集上的工具选择/参数准确性；不能证明真实函数执行或多轮规划 |
| [SimpleQA](https://github.com/openai/simple-evals/blob/652c89d0ca9df547706735883097e9537d40dc47/simpleqa_eval.py) | 官方 seed=0 抽样 20 原题；无浏览；独立请求使用原 A/B/C 评分提示词 | 单轮事实作答；同模型 grader 有偏差，不能直接对标官方默认评分模型 |
| 本地 harness 管线评测 | 确定性 provider fixture；比较原始与外置输入，检查取回原文及中断/保存失败 | 上下文投影与恢复实现；不产生模型能力分数 |

BFCL 固定官方仓库提交 `6ea57973c7a6097fd7c5915698c54c17c5b1b6c8`，SimpleQA 固定代码提交 `652c89d0ca9df547706735883097e9537d40dc47`；源数据文件另以 SHA256 固定，因为公开数据下载地址本身可以改变。题目、答案、采样和许可见 [benchmarks/sources.json](../benchmarks/sources.json)。答案只交给评分器，不注入作答请求；每题空历史，使用同一个 harness factory 和当前模型连接。

GAIA 官方数据有访问门槛，未从非官方镜像绕过；Terminal-Bench 需要当前未运行的容器环境；旧 τ-bench 官方已转向后继版本。此轮先交付可重复运行的两套公开子集，不能宣称完成全量榜单或通用 Agent 评测。

真实评测必须获得模型响应才能填成绩；没有凭据时预检输出 blocked、分数 null。任何 fixture 的准确率均为 null；部分请求或 grader 失败为 unknown，并同时显示已判分 / 总题数。实际 usage 缺失也保持未知，本地估算单独展示。
