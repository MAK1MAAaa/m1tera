# v0.5 独立视觉复核

结论：**功能与布局复核通过，完整设计规范验收尚有一项偏差：生产字体栈未接入 DM Sans。** 其余本轮检查未发现需要修复的溢出、滚动或评测误启动问题。v0.4 的三个布局/语义缺陷和状态文字字号问题已定点复核通过；字体问题已反馈实施代理。

复核日期：2026-10-13。对象为当前 `src/**` 的真实 React/CSS，由 Vite 渲染；依据 [m1tera-desktop 规范](../opendesign/design-systems/m1tera-desktop/SKILL.md)、[字体与颜色 tokens](../opendesign/design-systems/m1tera-desktop/tokens/colors_and_type.css) 和 OpenDesign 独立 verifier 流程。历史 `opendesign/mockups/desktop-v2/` 未用作本轮证据。

## 方法与边界

- 独立 headless Chrome / Playwright 浏览器上下文，复用 `tests/e2e/fixtures.ts` 的 `mockRuntime`，加载当前生产组件。四组组合为 1280×850、800×600，各浅色/深色；固定 reduced-motion，未修改生产 CSS 或添加页面装饰。
- 8 个独立临时用例通过，共捕获 64 张原始截图、64 份逐状态几何记录及四份交互记录。人工检视关键恢复、策略、评测、状态文字和旧缺陷截图；自动断言补充检查四组组合的窗口边界、内部滚动与 RPC 计数。自动通过不是对截图的替代。
- 测试接口为 `.test` 地址，目录、已连接状态、会话、API key、报告及作答均为内存 fixture；没有请求真实模型、启动真实评测或读取用户 appData / 凭据。截图中的数字均为模拟流程数据，不能作为模型能力成绩。
- 所有捕获状态的 document / body 宽高和 scrollWidth / scrollHeight 均不超过窗口；`window.scrollX/Y = 0`、`localStorage.length = 0`。设置、聊天、导航、模型 picker、评测正文、历史列表和长作答各自使用内部滚动。
- 初次 Vite 监听被沙箱拒绝，按正常 escalation 启动仅监听 `127.0.0.1:3000` 的临时服务；本轮结束该服务与 Chrome 进程均退出，临时 `.spec.ts` 删除，稳定测试文件未修改。
- 未操作原生 m1tera、授权、退出或重启；本轮是实际前端源码的浏览器视觉复核，不覆盖原生 WebKit、其他平台、独立无 Node 机器安装、签名公证，也不重新验收既有真实 BFCL / SimpleQA 成绩。

## 通过的检查

灰色面板、细边框、lucide 图标和固定 composer 保持既有层级。浅深主题都能区分主按钮、禁用项、错误原因和辅助状态文字；没有新增大面积强调色或装饰。

“运行与上下文”四项均可通过内部滚动访问，800×600 仍能同时看清 checkbox、工具结果预算、模型轮数、时限和“下次运行生效”。保存到内存 fixture 后重开保持 `false / 8192 / 7 / 90`；关闭精简时预算输入禁用，轮数和时限继续可编辑。固定页脚未被长目录推走。[小窗口浅色](screenshots/v5-independent/800x600-light-settings-harness-fixture.png) · [小窗口深色](screenshots/v5-independent/800x600-dark-settings-harness-fixture.png)

中断与暂停 banner 显示已运行 3 轮，明确披露 2 个工具结果未知、先检查实际状态、恢复改为逐次审批及不自动重跑工具。小窗口文字自然换成两行，按钮保持可见；点击继续仅记录一次 `run.resume`，没有 `run.start` 或重复 user message，composer 改为“逐次审批”。[中断](screenshots/v5-independent/800x600-light-recovery-interrupted-fixture.png) · [暂停](screenshots/v5-independent/1280x850-dark-recovery-paused-fixture.png)

评测选择、题数和开始按钮可辨认；进度 5 / 20、停止评测按钮保持可见，取消后显示“已停止”。报告明确“模拟验证 · 不计模型成绩”，fixture 准确率始终 `null`，界面准确率为“未知”；同时显示已判分 2 / 20、未知 18、正确 1 / 错误 1，不显示虚构的 100%。总 usage 为“未知”，已报告部分输入、本地估算分别呈现。[进度](screenshots/v5-independent/800x600-dark-benchmark-progress-fixture.png) · [取消报告](screenshots/v5-independent/800x600-dark-benchmark-cancelled-result-fixture.png) · [指标](screenshots/v5-independent/800x600-light-benchmark-fixture-metrics-fixture.png)

14 份 fixture 历史在 205px 的内部列表滚动；20 行逐题表在评测正文滚动区内访问，窗口和弹层本身不滚动、不横向撑宽；180 行长答案独立限制到 200px 高并可滚动到尾部。顶部关闭入口固定。SimpleQA 的同模型评分偏差提示保持可读。[历史](screenshots/v5-independent/800x600-dark-benchmark-history-fixture.png) · [逐题表](screenshots/v5-independent/800x600-dark-benchmark-table-fixture.png) · [长作答](screenshots/v5-independent/800x600-light-benchmark-long-detail-fixture.png)

四组组合都实际执行 dropdown Enter、题数输入 Enter 与 `form.requestSubmit()`，`benchmark.start` 计数保持 **0**、没有进度区；焦点移至“开始评测”后 Enter 才产生第 1 次启动。取消后显式按钮 Space 再产生第 2 次启动。没有键盘误请求；按钮保留键盘激活。见各组合的 `interaction-summary.json`。

## v0.4 缺陷定点回归

| 检查 | 本轮实际结果 |
| --- | --- |
| 多接口警告裁切模型 picker | 4 条长警告和 5 个启用模型下，标题、刷新和搜索始终可见。800×600 外框 y=47.5、height=480、bottom=527.5；警告在内部区滚动到尾部后，标题和搜索仍固定。[浅色](screenshots/v5-independent/800x600-light-picker-multi-warning-fixture.png) · [深色尾部](screenshots/v5-independent/800x600-dark-picker-warning-tail-fixture.png) |
| 刷新失败仍显示“目录已验证” | 成功拉取后再失败，`remote-model` 降为“未验证”；名称、32,768 tokens、勾选、待保存模型字段和明确不可用禁用项保留。四组均无“目录已验证”残留。[浅色](screenshots/v5-independent/800x600-light-refresh-failure-unverified-fixture.png) · [深色](screenshots/v5-independent/800x600-dark-refresh-failure-unverified-fixture.png) |
| 合法 100 字符接口名横向溢出 | `W`×100 在当前模型摘要与删除标题完整换行。设置滚动区 scrollWidth/clientWidth=618/618；删除弹层为388/388，标题为338/338，没有横向裁切。[摘要](screenshots/v5-independent/800x600-light-long-provider-summary-fixture.png) · [确认](screenshots/v5-independent/800x600-dark-long-provider-delete-fixture.png) |
| 验证状态字号过小过淡 | 状态文字实测11px，浅色 `#777777`、深色 `#a4a4a4`；已从旧10px / faint调整为与辅助内容一致的字号和颜色。截图中“未验证”清楚，与错误原因区别明确。 |

## 窗口与滚动证据

以下矩形为 x / y / width / height，单位 CSS px。两种主题几何一致，原始逐状态记录保留在截图同目录。

| 状态 / 区域 | 1280×850 | 800×600 |
| --- | --- | --- |
| document clientWidth / clientHeight / scrollHeight | 1280 / 850 / 850 | 800 / 600 / 600 |
| Settings 外框 | 330 / 35 / 620 / 780 | 90 / 24 / 620 / 552 |
| Settings 滚动区 clientHeight / scrollHeight | 638 / 1578 | 410 / 1578 |
| Settings 页脚 y / height / bottom | 746 / 68 / 814 | 507 / 68 / 575 |
| 恢复 banner | 378 / 72 / 760 / 69.69 | 232 / 72 / 546 / 88.38 |
| Benchmarks 外框 | 250 / 45 / 780 / 760 | 24 / 24 / 752 / 552 |
| Benchmarks 正文 clientHeight / scrollHeight（指标态） | 687 / 1736 | 479 / 1736 |
| 历史列表 clientHeight / scrollHeight | 205 / 892 | 205 / 892 |
| 长答案 pre clientHeight / scrollHeight | 200 / 3364 | 200 / 3364 |
| 多警告 picker | 492 / 296.5 / 320 / 480 | 332 / 47.5 / 320 / 480 |
| 多警告 picker 内部 clientHeight / scrollHeight | 387 / 763 | 387 / 727 |
| 长聊天 clientHeight / scrollHeight / 尾部scrollTop | 647 / 5845 / 5198 | 397 / 5845 / 5448 |
| 长导航 clientHeight / scrollHeight / 尾部scrollTop | 696 / 1804 / 1108 | 446 / 1804 / 1358 |
| composer bottom | 827 | 577 |

原始 [几何汇总](screenshots/v5-independent/geometry-summary.json) 包含四组组合、所有64个捕获状态的窗口、root、区域边界、overflow、字体和颜色；[800浅色交互记录](screenshots/v5-independent/800x600-light-interaction-summary.json) 与其他三组一致。

## 尚未符合规范：DM Sans 未接入

规范与 tokens 指定 DM Sans + 中文系统字族，本轮生产 `src/index.css:2` 仍是系统字体栈。实际 `.app-shell`、Settings、恢复 banner、评测、picker 的 computed fontFamily 全部为：

```text
-apple-system, "system-ui", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif
```

`src/**` 与 `index.html` 没有 DM Sans 字体声明或本地 font-face；token 文件没有被生产样式采用。这是可复现的设计规范偏差，不能称为已验证“复用 DM Sans”。其余布局与11px可读性不因此判为失败。若按规范接入离线字体，需要重新定点确认文本布局并更新安装包；本轮没有替实施代理改生产代码。[computed style证据](screenshots/v5-independent/800x600-light-settings-harness-geometry.json) · [截图](screenshots/v5-independent/800x600-light-settings-harness-fixture.png)

## 源码指纹

| 文件 | SHA256 |
| --- | --- |
| src/index.css | `4b9df711049c43a9dc7203da2f9301abb1ab06d3c116c5bc927bbb0811b9bbdf` |
| src/App.css | `182f60f501e1cd1568dfb37db3435974550ebac278268771ae1d4d3f4771a722` |
| src/App.tsx | `39f11c4d4a1eadc520cb33dd08179402ddaa297b49da78c278dbf7fced7c0836` |
| src/components/SettingsDialog.tsx | `2f1a7fc0f1aa2b43272aa2bbeb20fdb58d2ebc0113fe4c212e82e287509f7038` |
| src/components/BenchmarksDialog.tsx | `5fac534f842e9aa7a88a6418f5b74d7a2ca6b9258a345eedc5f6f8f75e1884d0` |
| src/components/ModelSettings.tsx | `d8c69bd5aed97b942cdc8cf4ee689f12045bf4274aa5521170faf6559ab1a597` |
| src/components/ModelPicker.tsx | `d762f8b54a65688e0dadbed30720d1a3a418903da8bbf40276e226eba1b39b65` |
