# v0.4 独立视觉复核

结论：**尚未通过完整视觉验收**。常规布局与四组尺寸/主题检查通过，但确认了三个需要修复的问题：多接口警告裁切模型 picker、目录刷新失败后仍显示旧验证状态、合法长接口名造成横向溢出。另有验证状态文字偏小偏淡的可读性偏差。

复核时间：2026-10-12。对象为当前工作区的真实 `src/**` React/CSS，通过 Vite 渲染；`opendesign/mockups/desktop-v2/` 未作为 v0.4 依据。遵循 [项目设计规范](../opendesign/design-systems/m1tera-desktop/SKILL.md) 与其颜色/字体 tokens。

## 方法与边界

- 使用 headless Chrome、独立 Playwright 浏览器上下文和 `tests/e2e/app.spec.ts` 的 `mockRuntime`；测试接口均为 `.test` 模拟地址，目录、登录状态、会话和 API key 全为 fixture，未联系真实服务。
- 四组组合为 1280×850、800×600，各浅色/深色。32 张常规截图与 3 张边界截图均在图内标注“隔离 fixture · 无真实账号或接口”。截图为浏览器像素，不能作为原生窗口、真实 OAuth 或账号模型权限验收。
- 常规 fixture 包含 45 条会话、160 段聊天、44 项已连接官方目录、两个自定义接口、相同模型 ID/名称和不同容量。检查模型启停、不可用状态、手动模型编辑、目录失败与重选提示。
- 四个常规截图/几何用例通过；两个补充边界用例失败。常规用例通过仅表示布局断言通过，失败后状态标签的语义问题由独立查看截图确认，未被“通过”覆盖。
- `window.scrollX/Y` 均为 0，常规用例的 document 宽高等于 viewport，`localStorage.length` 均为 0。保存仅调用页面内的内存 fixture；未读写用户 appData、真实内容、密钥或凭据。临时 repo `.spec.ts` 已删除，现有稳定测试未改动。
- Mac 锁屏，本轮未操作或视觉复核原生 app，也未取消此前原生未保存设置草稿。未请求解锁或绕过锁屏。下列结论只适用于浏览器渲染的实际前端源码。

## 已通过的布局与辨识

明暗主题维持中性面板、细边框和克制状态色。官方登录面板始终保留；选择自定义接口后仍有 `Continue with ChatGPT`，见 [自定义接口当前模型截图](screenshots/desktop-v4-800x600-light-long-provider-summary-fixture.png)。已弃用和已移除项显示原因、checkbox 禁用，picker 不列这些项或未勾选项。

自定义名称、URL、API 格式、密码遮盖与手工 ID/名称/容量字段没有彼此重叠。完整手工编辑区在 800×600 中通过内部滚动可见，`保存模型` 与固定的 `保存设置` 分别清楚可操作。跨接口同名模型以接口名和 ID 辨识，选中标记仅属于对应接口；关闭当前项后保留显式重选提示并禁用发送，没有自动 fallback。

| 实测几何（CSS px） | 1280×850 浅/深色 | 800×600 浅/深色 |
| --- | ---: | ---: |
| Settings 外框 x/y/w/h | 330 / 35 / 620 / 780 | 90 / 24 / 620 / 552 |
| 页脚 y/h/bottom | 746 / 68 / 814 | 507 / 68 / 575 |
| 设置滚动区 clientHeight | 638 | 410 |
| 长模型目录外框高度 / clientHeight | 244 / 243 | 244 / 243 |
| 44 项目录 scrollHeight / 到末尾 scrollTop | 3451 / 3208 | 3451 / 3208 |
| 常规 picker y/height/bottom | 412.06 / 363.44 / 775.50 | 162.56 / 363.44 / 526.00 |
| 重选 picker y/bottom | 442.06 / 775.50 | 192.56 / 526.00 |
| Composer bottom | 827 | 577 |

列表滚动到最后一项时，页脚位置和尺寸保持完全一致；聊天和导航各自可滚动。未将正常的滚动区域边缘裁切视作控件重叠。

## 需要修复的发现

### V4-01：多个接口目录警告使 picker 顶部裁切

800×600、5 个启用项、4 个接口分别返回运行时格式的目录失败警告。打开 picker 后，外框 `y = -104.6875`、`height = 632.1875`；标题 `y = -93.6875`，搜索框 `bottom = -22.6875`，标题、搜索和刷新入口被聊天面板裁切。document 仍为 600px 且 window 未滚动，因此用户无法通过外层滚动找回入口。

位置：`src/components/ModelPicker.tsx:27`、`:43` 汇总并逐条放置目录警告；`src/App.css:121` 未限制弹层总高度，`:125` 只限制选项区。建议约束整个弹层高度，并让警告与列表在明确的内部区域滚动，保持标题和搜索可见。[截图](screenshots/desktop-v4-800x600-light-picker-multi-warning-fixture.png)

### V4-02：同一设置草稿刷新失败后仍显示“目录已验证”

在自定义接口先成功拉取目录，勾选 `remote-model`，随后使目录请求返回 `fetched: false`。警告已经显示“模拟目录获取失败，现有配置已保留”，但该模型仍显示“目录已验证”，名称和 32,768 tokens 容量保留。明暗主题和两种尺寸均复现。手动模型仍标“未验证”，明确不可用项仍显示禁用原因。

位置：`src/components/ModelSettings.tsx:148` 附近仅在成功时更新局部 catalog 并刷新 inventory；失败只设置 warning，原局部 `available` 状态继续被 `rowsForProvider` 使用。运行时已具备缓存降级，不应使设置面板维持相反的状态标签。应保留名称、容量、草稿和已知不可用结论，把先前可用项降为未验证。[浅色截图](screenshots/desktop-v4-800x600-light-discovery-failure-fixture.png) · [深色截图](screenshots/desktop-v4-800x600-dark-discovery-failure-fixture.png)

### V4-03：合法长接口名造成摘要与删除标题横向溢出

使用 100 个无空格 `W` 作为接口名，添加并启用手动模型，保存到内存 fixture 后选中该接口，再打开 Settings 和移除确认。这个名称长度符合 `runtime/model-config.ts:80` 的 100 字符上限；报告与截图采用本次合法输入复测结果。

800×600 中 `settings-scroll.scrollWidth/clientWidth = 1095/618`，当前发送模型摘要横向裁切；确认弹窗为 `1700/388`，标题出现“移”单独一行和接口名裁切。位置：`src/components/ModelSettings.tsx:192`、`:262`，以及 `src/App.css:163`、`:173`。列表自身已能换行，摘要和确认标题应采用同等长词处理。[摘要截图](screenshots/desktop-v4-800x600-light-long-provider-summary-fixture.png) · [删除截图](screenshots/desktop-v4-800x600-light-long-provider-delete-fixture.png)

### V4-04：验证状态文字偏小、偏淡

`src/App.css:166` 的“未验证／目录已验证”使用 10px 和 `--faint`，低于项目辅助文字 11–12px 规范。按实际 CSS 颜色计算，浅色 `#999999` 对白底约 2.85:1，深色 `#777777` 对 `#202020` 约 3.64:1；截图中比模型 ID 与禁用原因更难辨认。建议使用辅助文字字号与较清楚的中性文字色。此项是可读性偏差，不影响 checkbox 能否操作。[浅色](screenshots/desktop-v4-1280x850-light-official-long-tail-fixture.png) · [深色](screenshots/desktop-v4-1280x850-dark-official-long-tail-fixture.png)

## 截图矩阵

| 状态 | 1280 浅 | 1280 深 | 800 浅 | 800 深 |
| --- | --- | --- | --- | --- |
| 官方登录与 checkbox | [图](screenshots/desktop-v4-1280x850-light-official-login-fixture.png) | [图](screenshots/desktop-v4-1280x850-dark-official-login-fixture.png) | [图](screenshots/desktop-v4-800x600-light-official-login-fixture.png) | [图](screenshots/desktop-v4-800x600-dark-official-login-fixture.png) |
| 明确不可用模型 | [图](screenshots/desktop-v4-1280x850-light-official-disabled-fixture.png) | [图](screenshots/desktop-v4-1280x850-dark-official-disabled-fixture.png) | [图](screenshots/desktop-v4-800x600-light-official-disabled-fixture.png) | [图](screenshots/desktop-v4-800x600-dark-official-disabled-fixture.png) |
| 长目录末尾 | [图](screenshots/desktop-v4-1280x850-light-official-long-tail-fixture.png) | [图](screenshots/desktop-v4-1280x850-dark-official-long-tail-fixture.png) | [图](screenshots/desktop-v4-800x600-light-official-long-tail-fixture.png) | [图](screenshots/desktop-v4-800x600-dark-official-long-tail-fixture.png) |
| 接口字段 | [图](screenshots/desktop-v4-1280x850-light-custom-fields-fixture.png) | [图](screenshots/desktop-v4-1280x850-dark-custom-fields-fixture.png) | [图](screenshots/desktop-v4-800x600-light-custom-fields-fixture.png) | [图](screenshots/desktop-v4-800x600-dark-custom-fields-fixture.png) |
| 完整手工编辑 | [图](screenshots/desktop-v4-1280x850-light-manual-edit-fixture.png) | [图](screenshots/desktop-v4-1280x850-dark-manual-edit-fixture.png) | [图](screenshots/desktop-v4-800x600-light-manual-edit-fixture.png) | [图](screenshots/desktop-v4-800x600-dark-manual-edit-fixture.png) |
| 目录失败 | [图](screenshots/desktop-v4-1280x850-light-discovery-failure-fixture.png) | [图](screenshots/desktop-v4-1280x850-dark-discovery-failure-fixture.png) | [图](screenshots/desktop-v4-800x600-light-discovery-failure-fixture.png) | [图](screenshots/desktop-v4-800x600-dark-discovery-failure-fixture.png) |
| 跨接口 picker | [图](screenshots/desktop-v4-1280x850-light-picker-providers-fixture.png) | [图](screenshots/desktop-v4-1280x850-dark-picker-providers-fixture.png) | [图](screenshots/desktop-v4-800x600-light-picker-providers-fixture.png) | [图](screenshots/desktop-v4-800x600-dark-picker-providers-fixture.png) |
| 当前模型待重选 | [图](screenshots/desktop-v4-1280x850-light-picker-reselect-fixture.png) | [图](screenshots/desktop-v4-1280x850-dark-picker-reselect-fixture.png) | [图](screenshots/desktop-v4-800x600-light-picker-reselect-fixture.png) | [图](screenshots/desktop-v4-800x600-dark-picker-reselect-fixture.png) |

复核源码指纹（SHA256）：`App.css` 为 `8f045672a2fa2a469769ae8cda2d3bf77e289098eabd7a31cc6d820095ba019a`；`ModelSettings.tsx` 为 `6f79512ab7a6fc7314a0ef9c065c14ee618c009e051a70e9b2e299f073d7e4e6`；`ModelPicker.tsx` 为 `00f5c07610135403f61d3686cd38aaf56ab91a6c02fcba2e7fb6ba7d7e44b9e0`。修复后应定点复核上述发现，并更新发布产物；本报告不声称已经完成修复或原生重验。
