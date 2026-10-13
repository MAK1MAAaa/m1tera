# 0.6.0 验证记录

日期：2026-10-13，macOS arm64。此次围绕近期 Harness 发布使用的评测集，新增 Letta Context-Bench 与 LongHarness 四类任务，并在 README 展示版本和来源明确的公开产品成绩。

## 已完成的检查

| 检查 | 结果 |
| --- | --- |
| 运行时 | 21 文件、406 项通过；包含全部既有行为及 151 项新增数据、评分、检索、多轮、用量、边界及任务协议回归 |
| 界面 | 36 项 E2E 通过；包含七套评测的动态默认值、Agent/Direct、部分奖励、显式启动及旧协议调试记录 |
| Rust | 11 项通过；fmt 和 clippy `--locked --all-targets -- -D warnings` 通过，协议与桥接一致 |
| TypeScript / ESLint | 全项目类型检查与最终 ESLint 通过 |
| 来源 | `verify:upstream` 通过；Pi core/ai 保持 1.1.0，没有替换底座 |
| 产物 | 0.6.0 app/DMG 构建通过；48 个编译文件与包内资源逐文件 SHA256 一致；版本、lockfile 摘要和 Letta 许可证匹配 |
| 包内 smoke | 8 组通过、499 条断言；22 次 fixture 请求，13 份新 fixture 报告与 2 份旧协议兼容记录恢复，覆盖七套评测 |

固定自动化检查共 **453 项**（406 + 36 + 11）。数据、官方 scorer 和包内 smoke 的独立核验单独计数，不生成模型能力分数。包内检查使用 `env -i PATH=/usr/bin:/bin` 与 Node 24.21.0，未授权启动不下载，fixture 准确率/奖励均为 null；详见 [包内验证](benchmarks/packaged-smoke-v6.md)。

## 新增数据与评分

Letta 使用固定 Deep Agents 提交中保存的原始 `filesystem_cloud`：100 题，每题完整十文档，13 个文件 SHA256 已固定；不是 Letta Filesystem v2 或代码库同名 ContextBench。模型只能看到原题与十文档，`ground_truth`、`required_files`、`verification_query` 不进入答题请求。另次同模型使用原始 rubric 评分，严格解析有限 JSON reward 0/0.5/1；0.5 不算全正确。36 项加载/评分测试及真实来源字节缓存核验通过。

LongHarness 固定 HF revision `95c54a1646cc486f6702308a1e820cb361960fd4`，四类各 50 题；选择固定前缀，检查 manifest、checksum、context 字节和 gold SHA。数据没有明确再分发许可，题目和官方 Python scorer 仅外置下载，不进入仓库或安装包。63 项模块检查、四类各两例的真实下载校验通过；独立 TS 规则与 SHA 锁定官方 Python `score_one` 的 60 个合成正反例一致。只读阅读原文，不执行数据中的代码。程序追踪额外校验任务与全局 README 并补齐公开对象 answer/evidence 要求；其他三类各两题的基础 prompt 字节未变。协议与真实下载核验没有调用模型，见 [协议记录](benchmarks/longharness-protocol-v3-check.json) 与 [固定来源下载](benchmarks/longharness-protocol-v2-download-check.json)。

答题 Agent 使用当前聊天的同一 `createHarnessAgent`、结果外置与动态 artifact 读取；只有本题虚拟文件可读，工具是目录、Unicode 分页和字面量搜索。Direct 将同一原文完整放进一次零工具请求，不包含“使用工具读取”的矛盾指令。每题上下文隔离，最终评分只读取最后 assistant 答复，早先分析不拼入最终答案。

## 用量、预算与失败语义

每份新报告记录 profile、实际模型推理档位、轮数、时限、基础工具与实际请求中的工具名称、冻结的 Harness 配置、请求数和工具执行尝试数。大型搜索结果自然外置后，下一请求的 `read_artifact` 也写入报告；两种 API schema 形状均通过回归。

作答默认最多 24 轮 / 300 秒；Direct 单请求最多 120 秒，用户设置可改变这些默认值，Agent 上限为 24 轮 / 600 秒，Direct 上限为 1 轮 / 120 秒。作答累计 input+output 预算 300,000 tokens 在已完成响应后检查，因此一个请求可能越界；usage 缺失时无法证明预算遵从。Letta 评分请求另计，累计报告包含评分，不能拿报告总量证明作答预算。

超时、轮数或预算边界的作答不能记为成功；评分请求即使已经返回合法 A 或 reward=1，只要触达运行边界仍为未知。12 项回归覆盖 BFCL、SimpleQA 和 Letta。缺失 usage 不填零；两轮中先有已知输入 13、再缺 usage 时，累计总量为未知，但已知部分仍为 13。异常请求使无法核实的请求/工具总数保持未知。

## 真实连接与新增评测

用户在本轮为 0.6.0 完成独立官方 ChatGPT 授权，原生应用确认已连接，`gpt-6.1-sol` 的实时目录容量为 500,000 tokens；未搬运、保存或读取既有 Codex 凭据。原会话和工作区恢复。已完成 Letta 三题，以及 LongHarness 条件搜索、备忘录、等价程序各两题 Agent/Direct 对照：Letta 3/3、mean reward 1.0；条件搜索 Direct 2/2，Agent 一题预算失败、一题未知；备忘录两轨 0/2；等价程序两轨各 0/1 已判分、未知 1。实际输入、请求数与失败原因见 [v0.6 实测](benchmarks/evaluation-v6.md)。

程序追踪六题调试先后暴露字段要求与对象类型的披露遗漏，原始报告单独保留，不算能力成绩。最终 v3 已同时明示对象结果与八个整数证据，解析器和 strict scorer 保持不变；其他三类 prompt 字节未变。用户已为最终包完成独立授权，程序追踪 Agent/Direct 四题已重测：Agent 0/1 已判分、未知 1，已判分题结果正确但证据错误；Direct 2/2、未知 0。新增评测最终共 19 个样本、15 个已判分、4 个未知。固定官方 Python 对 8 份可评分 LongHarness 预测复核，与本地判定逐题一致；另 8 题为边界或未知而不复核。

v0.5 的 BFCL 18/20 与 SimpleQA 16/20 保留为历史实测，未因为新增集合重新编造或重跑这些分数。

## 外部比较与交付范围

README 的 Terminal-Bench 4.0 是官方榜单 2026-10-13 快照，五家产品、七个配置，均为同版 66×5 trials。公开模型/推理档位不同，产品版本和逐行实际环境未公开；m1tera 尚未运行完整 TB 4.0，明确标为未评测。LongHarness 同 GPT-5.6-sol 的论文实验独立展示，不能将 m1tera 的新模型、小样本、low 推理、只读工具和低预算插入同条件排行榜。参考 [数据与运行协议](../benchmarks/README.md)、[公开来源记录](benchmarks/product-comparison-sources-2026-10-13.md)、[发布评测调研](benchmarks/harness-launches-2026-10-13.md)。

其他平台、独立无 Node 机器安装、公开签名和公证未验收。原生操作验证连接与评测流程，浏览器 E2E 验证固定窗口和组件行为；没有据此声称所有原生窗口视觉通过。v0.5 独立视觉的 DM Sans 未接入偏差保持记录，本轮没有更改字体。产物与 SHA256 见 [当前清单](release-artifacts.json)，[0.5.0 清单](release-artifacts-0.5.0.json) 保留为历史结果。
