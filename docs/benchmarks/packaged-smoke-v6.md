# v0.6.0 最终包 benchmark smoke

2026-10-13 tracing v3 对象输出契约修复后重跑通过：**8 组 smoke、499 条断言、22 次 fixture provider 请求**。生成 **13 份新 fixture 报告**，另注入 **2 份明确标记为合成数据的旧 tracing 兼容记录**（缺失协议、v2）；全部 **15 份记录**从新 RuntimeService 实例恢复，覆盖全部 **7 个评测目录项**。本记录覆盖此前 13:02 和 13:49 的旧包检查结果。

执行时间：2026-10-13T06:01:00.551Z 至 2026-10-13T06:01:01.712Z（北京时间 14:01）。最终包中的 tracing protocol 为 `longharness-task-contract-v3`。

## 执行边界

- 使用最终构建完成的 `src-tauri/target/release/bundle/macos/m1tera.app`，平台为 macOS / arm64。
- 执行器为包内 `Contents/MacOS/node`，版本 **v24.21.0**；环境经过 `env -i` 清空，`PATH=/usr/bin:/bin`。实际导入的是包内 `Contents/Resources/resources/runtime/service.js` 及其依赖。没有调用宿主 Node 或 Python。
- 为每个场景指定独立 `/tmp` appData；没有读取真实应用数据、OAuth 或 API key，没有启动、停止或操作用户原生 m1tera。
- 注入包内 Pi `createAssistantMessageEventStream()` 产生的 fixture 响应。兼容接口密钥为脚本现场生成的临时字符串，网络 `fetch` 被替换为拒绝函数；调用次数为 **0**。
- Letta 和 LongHarness 的公开研究缓存只复制到临时 appData 的 `benchmark-cache`。包内真实 loader 对固定版本、SHA256 和数据结构进行校验；没有将原题或语料写入仓库。
- 所有 `benchmark.start` 生成的新报告均为 `mode: "fixture"`，`accuracy` 和 `accuracyGivenAttempted` 始终为 `null`；Letta 的 `meanReward` 始终为 `null`。单题状态和 reward 用于检查控制流，不能解释为模型成绩。
- 旧报告兼容场景单独注入 2 份 synthetic 历史 `live` 格式记录，其名称和模型字段明确说明并非模型结果，原始 `accuracy: 1` 只用于证明摘要遮蔽、原报告保留的区别。没有为这些记录发起 provider 请求。

## 检查结果

| 组 | 检查 | fixture 请求数 | 结果 |
| --- | --- | ---: | --- |
| 1 | 最终包版本、包内 Node 路径、4 个运行时直接依赖版本、37 个编译后相对 import 目标、3 个生产 license 文件 | 0 | 通过 |
| 2 | 5 个新增套件在未登录 ChatGPT 时返回 `LOGIN_REQUIRED`，未配置兼容接口密钥时返回 `API_KEY_REQUIRED`；3 个无效参数被拒绝；未创建语料缓存或报告 | 0 | 通过 |
| 3 | Letta 的全部 10 个语料文件和 13 个固定来源 hash；list → read → 最终答案 → 独立 grader；读取内容与校验后的原文一致 | 4 | 通过 |
| 4 | LongHarness 在 Chat Completions / Responses 两种 payload schema 形状下分别 search → read_artifact → 最终答案；动态 reader 进入后续上下文和报告工具清单 | 6 | 通过 |
| 5 | tracing Agent / Direct 均明确 answer 为 JSON 对象并保留 out 字段类型，禁止编码字符串或 quoted stdout；完整八 cell 要求、v3 protocol、两个 README hash 和 prompt SHA 正确；4 个 Direct 均获得完整原文、无工具、1 次请求 | 5 | 通过 |
| 6 | 加入 BFCL / SimpleQA fixture 后覆盖全部 7 个目录项；10 份新报告及 2 份旧兼容记录恢复；缺失协议和 v2 tracing 摘要均标记 protocolInvalid=true、accuracy=null，原 metrics 和磁盘 bytes 不变；报告无临时密钥 | 3 | 通过 |
| 7 | 完成响应的 300,000 token 答案预算及 2 轮模型上限；分别记录 `token-budget` / `turn-limit`，均为失败且正确数为 0 | 3 | 通过 |
| 8 | 运行中拒绝新 benchmark；取消将进行中的题保留为未知，未开始题也保留在 unknown 分母；取消后无 running 状态；最终 15 份记录全部恢复且逐份一致 | 1 | 通过 |
| 合计 | 8 组、499 条断言 | **22** | **全部通过** |

### 计量与报告语义

- Letta：4 次请求、2 次实际工具执行。grader 未提供 usage，已知输入小计为 **39**，完整输入/输出合计为 `null`，`inputUsageUnknown: true`；最终答案不含中间 planning。
- LongHarness agent：两种 schema 各 3 次请求、2 次实际工具执行。首次工具清单只有 3 个 corpus 工具；大搜索结果外置后披露 `read_artifact`，取回了原始外置结果页；最终答案只取最后一条 assistant 文本。
- Chat Completions 形状场景的最后一轮缺 usage：单题完整 usage 为 `null`，已知输入小计 **26** 被保留。Responses 形状场景的 usage 完整，输入合计 **39**。
- 2 轮上限场景：报告请求数为 **2**，实际工具执行数为 **2**。预算记录为 `tokenBudgetScope: "answer"`、`budgetAccounting: "completed-response"`。
- 取消场景：总题数 **2**、已完成处理 **1**、未知 **2**、graded **0**；无法可靠结算的取消请求不报告 requestCount。
- 新 tracing：Agent 和 Direct 都获得 `"answer"` / `"evidence"` 两个键的输出契约，明确 answer 为 JSON 对象、保留 query 变量 out 的字段和值类型，并禁止 JSON 编码字符串或引用打印 stdout；要求八个互异整数 cell ID，支持八步 query。Agent prompt 不内嵌完整语料，Direct prompt 包含完整原文。`adapterProtocol` 为 `longharness-task-contract-v3`；所有 LongHarness 新报告记录与 loader 一致的 `promptSha256`。
- tracing 0 号任务说明 prompt SHA256 为 `0854d04e108e45459eca66fedb34b5ed5cf5967dc643d600027d43b0d8df5758`，其范围是追加 Agent 说明或 Direct 全文之前的任务说明。固定任务 README SHA256 为 `5e132a34f8793ce627acf02d0193d782de6d2c25af17489ab25b4fbf7c98991f`，全局 README SHA256 为 `f5e0145805d15bcd6ecabdf1b0e957f6200ca8bf7fd73f5fe7da682e2192aefd`。两者复制到临时缓存后由 loader 校验并写入 source；全局 README 正文仅供审计，未进入 Agent / Direct prompt。
- 旧 tracing：缺失 protocol 和记录 v2 的两份合成历史报告恢复后，summary 均为 `protocolInvalid: true`、`accuracy: null`。原报告的 `metrics.accuracy: 1`、全部 metrics、报告对象及磁盘 JSON bytes 均保持原值；新 v3 tracing 摘要未被标为无效。

## 最终包标识

运行时包版本：`0.6.0`。`distribution.json` 记录依赖包数 **87**，锁文件 SHA256 为 `2e685eca4c7bbd3de8b690224061e4e2acc0c5f501acead30c84c117e9cac71d`。

| 包内文件 | 字节数 | SHA256 |
| --- | ---: | --- |
| `runtime/service.js` | 75575 | `44bfb4f59d163b1c552dbabf058b1e0077d31234e2959ef08a095d629b9e8028` |
| `runtime/filesystem-benchmarks.js` | 10170 | `ff5d945fbdaf8742ca1b178d7e1cd1399cce5e4b258c2e9811e4e7c9eedf7736` |
| `runtime/benchmark-corpus.js` | 4152 | `122fc3002c8bbfe1696e3b41a9133885b464b39b4dd7590cc9bf2d25710d5aea` |
| `runtime/storage.js` | 7314 | `febe27c3b5109c1b2dc59278a3e1f8fa08facd32ae7da12fad9143ee56612add` |
| `benchmarks/letta-context.js` | 13047 | `19848b3e09eab0e7a4604ca987f1765d9df89cac60ced8d05b0a9cf1e2e17199` |
| `benchmarks/longharness.js` | 18642 | `317f231794253a6ac9f963b3f4662b0fe1755fedbcc558d08375a08dd7e11be0` |
| `shared/benchmark-catalog.js` | 1545 | `36df141f578d289d165e5b5d79a210c46ae6353585a08bf7eb69b2a9e687ef1f` |

检查到的生产 license 为 `letta-context-LICENSE.txt`、`node-LICENSE.txt`、`pi-LICENSE.txt`，Letta 文件包含 Apache License 正文。

## 局限与清理

本次验证使用 streamFn 注入，payload 的两种 schema 形状由 fixture 构造，未经过真实 provider 请求格式化或 SSE 传输。实际工具执行、Pi agent loop、动态工具披露、文件 loader、RuntimeService 计量及报告持久化来自最终包。公开语料从已有缓存加载，未验证本次在线下载；license 检查仅覆盖这 3 个打包文件的存在和 Letta 正文标识。

本次未运行真实模型评测，也未验收独立无 Node 机器、其他平台安装、原生 UI 或真实账号行为。所有脚本创建的临时 appData、复制语料、临时脚本和 RuntimeService 均已清理；共享公开研究缓存保留。
