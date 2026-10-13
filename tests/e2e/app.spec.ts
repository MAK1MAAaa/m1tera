import { test, expect, type Page } from '@playwright/test';
import type { ComposerDraft, Settings, Skill } from '../../shared/protocol';
import { addCustomProvider, addManualModel, login, mockRuntime, openSettings } from './fixtures';

test('browser preview never claims a running agent', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('浏览器预览 · Agent 仅在桌面应用中运行')).toBeVisible();
  await expect(page.getByRole('button', { name: '新建会话', exact: true })).toBeDisabled();
});

test('ChatGPT login, streamed messages and unknown baseline usage', async ({ page }) => {
  await mockRuntime(page); await page.goto('/');
  await expect(page.getByRole('button', { name: '新建会话', exact: true })).toBeEnabled();
  await login(page);
  await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('你好');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByText('已收到你的消息。', { exact: true })).toBeVisible();
  await expect(page.getByText('已收到你的消息。', { exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: /^上下文占用：/ }).click();
  await page.getByRole('button', { name: '测量首轮基线', exact: true }).click();
  const table = page.getByRole('table', { name: '首轮上下文基线结果' });
  await expect(table.getByRole('row')).toHaveCount(4);
  await expect(table.getByText('未知', { exact: true })).toHaveCount(3);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test('per-session tools and write approval dialog', async ({ page }) => {
  await mockRuntime(page); await page.goto('/'); await login(page);
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.getByRole('button', { name: '管理会话工具', exact: true }).click();
  await page.locator('input[name="workspace"]').fill('/tmp/test-workspace');
  await page.locator('input[name="write_file"]').check();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '管理会话工具', exact: true })).toContainText('1 个工具');
  await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('需要审批');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /批准/ })).toBeVisible();
  await page.getByRole('button', { name: '拒绝', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /批准/ })).toHaveCount(0);
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await expect(page.getByRole('button', { name: '管理会话工具', exact: true })).toHaveText('工具');
});

test('model selection and automatic approval belong to the composer and current session', async ({ page }) => {
  await mockRuntime(page); await page.goto('/'); await login(page);
  const settings = await openSettings(page);
  await settings.locator('input[name="enabledModel:chatgpt:gpt-6-sol"]').check();
  await settings.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await page.getByRole('textbox', { name: '筛选模型' }).fill('gpt-6-sol');
  await page.getByRole('option', { name: /GPT-6 Sol/ }).click();
  await expect(page.getByRole('button', { name: '选择模型', exact: true })).toContainText('GPT-6 Sol');
  await page.getByRole('button', { name: '审批模式', exact: true }).click();
  await page.getByRole('button', { name: /自动审批 自动批准/ }).click();
  await expect(page.getByRole('button', { name: '审批模式', exact: true })).toContainText('自动审批');
  await expect(page.getByRole('button', { name: '管理会话工具', exact: true })).toContainText('工具');
  await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('需要审批');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByText('已收到你的消息。', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: /批准/ })).toHaveCount(0);
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await expect(page.getByRole('button', { name: '审批模式', exact: true })).toContainText('逐次审批');
});

test('rename, pin and classification update the session sidebar', async ({ page }) => {
  await mockRuntime(page); await page.goto('/');
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.getByRole('button', { name: '会话操作 新会话', exact: true }).click();
  await page.getByRole('menuitem', { name: '重命名会话', exact: true }).click();
  const rename = page.getByRole('dialog', { name: '重命名会话', exact: true });
  await rename.getByRole('textbox', { name: '会话名称' }).fill('研究笔记');
  await rename.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '研究笔记', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '会话操作 研究笔记', exact: true }).click();
  await page.getByRole('menuitem', { name: '置顶', exact: true }).click();
  await expect(page.locator('.sidebar-section').filter({ has: page.locator('.sidebar-label', { hasText: '置顶' }) }).getByRole('button', { name: '研究笔记', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '会话操作 研究笔记', exact: true }).first().click();
  await page.getByRole('menuitem', { name: '分类', exact: true }).click();
  const category = page.getByRole('dialog', { name: '会话分类', exact: true });
  await category.getByRole('button', { name: '新建分类', exact: true }).click();
  await category.locator('input[name="categoryName"]').fill('调研');
  await category.getByRole('button', { name: '创建并归类', exact: true }).click();
  await expect(page.locator('.category-label').getByText('调研', { exact: true })).toBeVisible();
});

test('workspace navigation creates a zero-tool session and moves it without changing capabilities', async ({ page }) => {
  await mockRuntime(page); await page.goto('/');
  await page.getByRole('button', { name: '添加工作区', exact: true }).click();
  await expect(page.locator('.workspace-select')).toContainText('test-workspace');
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await expect(page.getByRole('button', { name: '管理会话工具', exact: true })).toHaveText('工具');
  await page.getByRole('button', { name: '会话操作 新会话', exact: true }).click();
  await page.getByRole('menuitem', { name: '移动到工作区', exact: true }).click();
  const move = page.getByRole('dialog', { name: '移动到工作区', exact: true });
  await move.getByRole('combobox', { name: '工作区', exact: true }).selectOption('');
  await move.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.workspace-sessions').getByRole('button', { name: '新会话', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '管理会话工具', exact: true })).toHaveText('工具');
});

test('long chat and sidebar scroll internally while the window stays fixed at supported sizes', async ({ page }) => {
  await mockRuntime(page, true); await page.goto('/');
  await expect(page.getByRole('heading', { name: '会话 0', exact: true })).toBeVisible();
  for (const viewport of [{ width: 1280, height: 850 }, { width: 800, height: 600 }]) {
    await page.setViewportSize(viewport);
    await page.locator('.chat-scroll').evaluate((element) => { element.scrollTop = 200; });
    await page.locator('.sidebar-scroll').evaluate((element) => { element.scrollTop = 200; });
    const layout = await page.evaluate(() => {
      const chat = document.querySelector('.chat-scroll')!;
      const sidebar = document.querySelector('.sidebar-scroll')!;
      const composer = document.querySelector('.composer')!.getBoundingClientRect();
      window.scrollTo(0, 500);
      return { windowY: window.scrollY, documentHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight, chatScrollable: chat.scrollHeight > chat.clientHeight, sidebarScrollable: sidebar.scrollHeight > sidebar.clientHeight, composerBottom: composer.bottom };
    });
    expect(layout.windowY).toBe(0);
    expect(layout.documentHeight).toBeLessThanOrEqual(layout.viewportHeight + 1);
    expect(layout.chatScrollable).toBe(true);
    expect(layout.sidebarScrollable).toBe(true);
    expect(layout.composerBottom).toBeLessThanOrEqual(layout.viewportHeight);
    await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^上下文占用：/ }).click();
    await expect(page.getByRole('button', { name: '关闭上下文', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '关闭上下文', exact: true }).click();
  }
});

test('settings keeps keyboard focus inside the dialog and restores it when closed', async ({ page }) => {
  await mockRuntime(page); await page.goto('/');
  const settingsButton = page.getByRole('button', { name: '设置', exact: true });
  await settingsButton.click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  for (let index = 0; index < 14; index++) {
    await page.keyboard.press(index % 2 ? 'Tab' : 'Shift+Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(settingsButton).toBeFocused();
  const contextButton = page.getByRole('button', { name: /^上下文占用：/ });
  await contextButton.click();
  const contextDialog = page.getByRole('dialog', { name: '上下文详情', exact: true });
  await expect.poll(() => contextDialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await contextDialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(contextDialog).toBeHidden();
  await expect(contextButton).toBeFocused();
});

test('dark theme model picker stays inside the minimum window', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 800, height: 600 });
  await mockRuntime(page); await page.goto('/');
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await expect(page.getByRole('option', { name: /GPT-6.1 Sol/ })).toBeVisible();
  const bounds = await page.locator('.model-popover').boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(800);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(600);
  await page.screenshot({ path: testInfo.outputPath('desktop-dark-model-picker-fixture.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox', { name: '可用模型' })).toHaveCount(0);
});

async function starts(page: Page) {
  return page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: { runStarts: (ComposerDraft & { sessionId: string })[] } }).__M1TERA_TEST_STATE__.runStarts);
}

test('context ring precedes send and explains estimated usage plus the current model limit', async ({ page }) => {
  await mockRuntime(page); await page.goto('/'); await login(page);
  const input = page.getByRole('textbox', { name: '发送消息', exact: true });
  await input.fill('这是一条上下文测量草稿');
  const ring = page.getByRole('button', { name: /^上下文占用：/ });
  await expect(ring).toHaveAccessibleName(/预计 \d+ \/ 272,000 tokens/);
  const ringBounds = await ring.boundingBox();
  const sendBounds = await page.getByRole('button', { name: '发送消息', exact: true }).boundingBox();
  expect(ringBounds!.x + ringBounds!.width).toBeLessThanOrEqual(sendBounds!.x);
  await ring.hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('预计输入');
  await expect(tooltip).toContainText('272,000');
  await expect(tooltip).toContainText('本地估算');
  await expect(page.getByText('零工具 · 不自动加载项目指令或记忆', { exact: true })).toHaveCount(0);
});

test('unknown compatible context maximum stays unknown until explicitly configured', async ({ page }) => {
  await mockRuntime(page); await page.goto('/');
  const settings = await openSettings(page);
  await addCustomProvider(page, '私有接口');
  await (await addManualModel(page, '私有接口', 'private-model')).check();
  await settings.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await page.getByRole('option', { name: /私有接口 · private-model/ }).click();
  const ring = page.getByRole('button', { name: /^上下文占用：/ });
  await expect(ring).toHaveAccessibleName(/\/ 未知 tokens/);
  await ring.hover();
  await expect(page.getByRole('tooltip')).toContainText('尚无法计算占用比例');
  await openSettings(page);
  await page.getByRole('button', { name: /私有接口 Chat Completions/ }).click();
  await page.getByRole('button', { name: '编辑模型 private-model', exact: true }).click();
  await page.locator('input[name="contextWindow"]').fill('16384');
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(ring).toHaveAccessibleName(/\/ 16,384 tokens/);
});

test('disabling the current model disables Send without restoring it through picker refresh', async ({ page }) => {
  await mockRuntime(page); await page.goto('/'); await login(page);
  const input = page.getByRole('textbox', { name: '发送消息', exact: true });
  await input.fill('禁用后的草稿');
  const settings = await openSettings(page);
  await expect(settings.locator('input[name="model"]')).not.toBeEditable();
  await settings.locator('input[name="enabledModel:chatgpt:gpt-6.1-sol"]').uncheck();
  await settings.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await expect(input).toHaveValue('禁用后的草稿');
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await expect(page.getByRole('option')).toHaveCount(0);
  await page.getByRole('button', { name: '刷新模型列表', exact: true }).click();
  await expect(page.getByRole('option')).toHaveCount(0);
  await expect(page.getByText('请在设置中勾选启用模型', { exact: true })).toBeVisible();
  const saved = await page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: { settings: Settings } }).__M1TERA_TEST_STATE__.settings);
  expect(saved.model).toBe('gpt-6.1-sol');
  expect(saved.chatgptModels?.find((model) => model.id === 'gpt-6.1-sol')?.enabled).toBe(false);
});

test('official model checkboxes control picker options and refresh preserves a disabled model', async ({ page }) => {
  await mockRuntime(page); await page.goto('/'); await login(page);
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await expect(page.getByRole('option', { name: /GPT-6 Sol/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  let settings = await openSettings(page);
  const checkbox = settings.locator('input[name="enabledModel:chatgpt:gpt-6-sol"]');
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await settings.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await expect(page.getByRole('option', { name: /GPT-6 Sol/ })).toBeVisible();
  await page.keyboard.press('Escape');
  settings = await openSettings(page);
  await settings.locator('input[name="enabledModel:chatgpt:gpt-6-sol"]').uncheck();
  await settings.locator('.official-provider').getByRole('button', { name: '拉取模型列表', exact: true }).click();
  await expect(settings.locator('input[name="enabledModel:chatgpt:gpt-6-sol"]')).not.toBeChecked();
  await settings.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await page.getByRole('button', { name: '刷新模型列表', exact: true }).click();
  await expect(page.getByRole('option', { name: /GPT-6 Sol/ })).toHaveCount(0);
  await expect(page.getByRole('option', { name: /GPT-6.1 Sol/ })).toBeVisible();
});

test('a custom base URL key and manual model are selectable while official login remains visible', async ({ page }) => {
  await mockRuntime(page); await page.goto('/');
  const settings = await openSettings(page);
  await addCustomProvider(page, '团队接口', 'https://mock-base-url.test/v1', 'custom-fixture-memory-key');
  const model = await addManualModel(page, '团队接口', 'shared-model', '团队模型', 65536);
  await expect(model).not.toBeChecked();
  await model.check();
  await expect(settings.getByRole('button', { name: 'Continue with ChatGPT', exact: true })).toBeVisible();
  await settings.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await page.getByRole('option', { name: /团队模型 团队接口 · shared-model/ }).click();
  await expect(page.getByRole('button', { name: '选择模型', exact: true })).toContainText('团队模型');
  await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('使用团队模型');
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
  const state = await page.evaluate(() => {
    const state = (window as Window & { __M1TERA_TEST_STATE__: { settings: Settings; providerKeys: Record<string, string> } }).__M1TERA_TEST_STATE__;
    return { settings: state.settings, keys: state.providerKeys };
  });
  expect(state.settings).toMatchObject({ connection: 'compatible', apiFormat: 'chat-completions', baseUrl: 'https://mock-base-url.test/v1', model: 'shared-model', contextWindow: 65536 });
  expect(state.keys[state.settings.providerId!]).toBe('custom-fixture-memory-key');
  expect(JSON.stringify(state.settings)).not.toContain('custom-fixture-memory-key');
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  const reopened = await openSettings(page);
  await expect(reopened.getByRole('button', { name: 'Continue with ChatGPT', exact: true })).toBeVisible();
  await reopened.getByRole('button', { name: /团队接口 Chat Completions/ }).click();
  await expect(reopened.locator('input[name="apiKey"]')).toHaveValue('');
  await expect(reopened.getByText('本次运行已配置，留空则保留', { exact: true })).toBeVisible();
});

test('discovered deprecated and removed models cannot be checked for either official or custom providers', async ({ page }) => {
  await mockRuntime(page); await page.goto('/'); await login(page);
  const settings = await openSettings(page);
  await settings.locator('.official-provider').getByRole('button', { name: '拉取模型列表', exact: true }).click();
  for (const id of ['deprecated-model', 'removed-model']) {
    const checkbox = settings.locator(`input[name="enabledModel:chatgpt:${id}"]`);
    await expect(checkbox).toBeDisabled();
    await expect(checkbox).not.toBeChecked();
  }
  await addCustomProvider(page, '目录接口');
  const provider = settings.getByRole('region', { name: '目录接口', exact: true });
  await provider.getByRole('button', { name: '拉取模型列表', exact: true }).click();
  for (const id of ['deprecated-model', 'removed-model']) {
    await expect(provider.locator(`input[name^="enabledModel:"][name$=":${id}"]`)).toBeDisabled();
  }
  const remote = provider.locator('input[name^="enabledModel:"][name$=":remote-model"]');
  await expect(remote).not.toBeChecked();
  await remote.check();
  await settings.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await expect(page.getByRole('option', { name: /已弃用模型|已移除模型/ })).toHaveCount(0);
  await expect(page.getByRole('option', { name: /共享模型 目录接口 · remote-model/ })).toBeVisible();
  const request = await page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: { discoveryRequests: Record<string, unknown>[] } }).__M1TERA_TEST_STATE__.discoveryRequests.at(-1));
  expect(request).toMatchObject({ baseUrl: 'https://mock-base-url.test/v1', apiKey: 'fixture-memory-key' });
});

test('a failed model fetch preserves provider fields a pending manual draft and already configured manual items', async ({ page }) => {
  await mockRuntime(page); await page.goto('/');
  const settings = await openSettings(page);
  await addCustomProvider(page, '草稿接口', 'https://draft-mock.test/v1', 'draft-fixture-key');
  await (await addManualModel(page, '草稿接口', 'manual-existing', '手工模型')).check();
  const provider = settings.getByRole('region', { name: '草稿接口', exact: true });
  await provider.getByRole('button', { name: '手动添加模型', exact: true }).click();
  await provider.locator('input[name="modelId"]').fill('manual-pending');
  await provider.locator('input[name="modelName"]').fill('尚未添加的模型');
  await provider.locator('input[name="contextWindow"]').fill('16384');
  await page.evaluate(() => { (window as Window & { __M1TERA_TEST_STATE__: { failDiscoveries: boolean } }).__M1TERA_TEST_STATE__.failDiscoveries = true; });
  await provider.getByRole('button', { name: '拉取模型列表', exact: true }).click();
  await expect(provider.getByRole('status')).toContainText('现有配置已保留');
  await expect(provider.locator('input[name="providerName"]')).toHaveValue('草稿接口');
  await expect(provider.locator('input[name="baseUrl"]')).toHaveValue('https://draft-mock.test/v1');
  await expect(provider.locator('input[name="apiKey"]')).toHaveValue('draft-fixture-key');
  await expect(provider.locator('input[name="modelId"]')).toHaveValue('manual-pending');
  await expect(provider.locator('input[name="modelName"]')).toHaveValue('尚未添加的模型');
  await expect(provider.locator('input[name="contextWindow"]')).toHaveValue('16384');
  await expect(provider.locator('input[name^="enabledModel:"][name$=":manual-existing"]')).toBeChecked();
  await provider.getByRole('button', { name: '添加模型', exact: true }).click();
  await expect(provider.locator('input[name^="enabledModel:"][name$=":manual-pending"]')).not.toBeChecked();
  await settings.getByRole('button', { name: '保存设置', exact: true }).click();
  const saved = await page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: { settings: Settings } }).__M1TERA_TEST_STATE__.settings);
  expect(saved.customProviders?.[0].models).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'manual-existing', name: '手工模型', enabled: true, source: 'manual' }),
    expect.objectContaining({ id: 'manual-pending', name: '尚未添加的模型', contextWindow: 16384, enabled: false, source: 'manual' }),
  ]));
});

test('identically named model IDs stay distinct across two custom providers', async ({ page }) => {
  await mockRuntime(page); await page.goto('/');
  const settings = await openSettings(page);
  for (const name of ['接口甲', '接口乙']) {
    await addCustomProvider(page, name, `https://${name === '接口甲' ? 'alpha' : 'beta'}-mock.test/v1`);
    await (await addManualModel(page, name, 'shared-model', '共享模型')).check();
  }
  await settings.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  const first = page.getByRole('option', { name: /共享模型 接口甲 · shared-model/ });
  const second = page.getByRole('option', { name: /共享模型 接口乙 · shared-model/ });
  await expect(first).toBeVisible(); await expect(second).toBeVisible();
  await first.click();
  await expect(page.getByRole('button', { name: '选择模型', exact: true })).toContainText('接口甲 · 共享模型');
  const firstId = await page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: { settings: Settings } }).__M1TERA_TEST_STATE__.settings.providerId);
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await second.click();
  await expect(page.getByRole('button', { name: '选择模型', exact: true })).toContainText('接口乙 · 共享模型');
  const secondId = await page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: { settings: Settings } }).__M1TERA_TEST_STATE__.settings.providerId);
  expect(secondId).not.toBe(firstId);
});

test('model lists scroll inside Settings while its footer stays fixed at the 800 by 600 minimum', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await mockRuntime(page, false, 40); await page.goto('/');
  const settings = await openSettings(page);
  const footer = settings.locator('.dialog-footer');
  const before = await footer.boundingBox();
  const layout = await settings.evaluate((element) => {
    const list = element.querySelector('.official-provider .configured-model-list')!;
    const scroll = element.querySelector('.settings-scroll')!;
    list.scrollTop = list.scrollHeight;
    scroll.scrollTop = scroll.scrollHeight;
    return { listScrollable: list.scrollHeight > list.clientHeight, settingsScrollable: scroll.scrollHeight > scroll.clientHeight,
      listOverflow: getComputedStyle(list).overflowY, windowScroll: window.scrollY, documentHeight: document.documentElement.scrollHeight };
  });
  expect(layout.listScrollable).toBe(true); expect(layout.settingsScrollable).toBe(true);
  expect(layout.listOverflow).toBe('auto'); expect(layout.windowScroll).toBe(0); expect(layout.documentHeight).toBeLessThanOrEqual(600);
  const after = await footer.boundingBox();
  expect(after!.y).toBeCloseTo(before!.y, 1);
  expect(after!.y + after!.height).toBeLessThanOrEqual(600);
  await expect(settings.getByRole('button', { name: '保存设置', exact: true })).toBeInViewport();
});

test('slash pickers send structured plan and search commands for one turn and keep ordinary text intact', async ({ page }) => {
  await mockRuntime(page); await page.goto('/'); await login(page);
  const input = page.getByRole('textbox', { name: '发送消息', exact: true });
  await input.fill('/');
  await expect(page.getByRole('region', { name: '快捷命令' })).toBeVisible();
  await input.press('Enter');
  await expect(page.locator('.draft-command')).toHaveText('做计划');
  await input.fill('设计一个读书计划');
  await input.press('Enter');
  await expect.poll(() => starts(page)).toHaveLength(1);
  expect((await starts(page))[0]).toMatchObject({ text: '设计一个读书计划', command: 'plan' });
  await expect(page.locator('.draft-command')).toHaveCount(0);
  await input.fill('/websearch');
  await expect(page.getByRole('option', { name: /联网搜索/ })).toBeVisible();
  await input.press('Enter');
  await expect(page.locator('.draft-command')).toHaveText('联网搜索');
  await input.fill('查找 Tauri 官方文档');
  await input.press('Enter');
  await expect.poll(() => starts(page)).toHaveLength(2);
  expect((await starts(page))[1]).toMatchObject({ text: '查找 Tauri 官方文档', command: 'websearch' });
  await expect(page.locator('.draft-command')).toHaveCount(0);
  await page.getByRole('link', { name: /Tauri 官方文档/ }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: { externalUrls: string[] } }).__M1TERA_TEST_STATE__.externalUrls)).toEqual(['https://v2.tauri.app/']);
  for (const text of ['/unknown 继续聊天', '邮件联系 hello@example.com，说明 /websearch 路径']) {
    await input.fill(text);
    await expect(page.locator('.composer-suggestions')).toHaveCount(0);
    await input.press('Enter');
  }
  await expect.poll(() => starts(page)).toHaveLength(4);
  expect((await starts(page)).slice(2)).toEqual(expect.arrayContaining([expect.objectContaining({ text: '/unknown 继续聊天' }), expect.objectContaining({ text: '邮件联系 hello@example.com，说明 /websearch 路径' })]));
  expect((await starts(page)).slice(2).every((start) => start.command === undefined)).toBe(true);
});

test('at and dollar pickers attach explicit workspace files and skills to the outgoing request', async ({ page }) => {
  await mockRuntime(page); await page.goto('/'); await login(page);
  await page.getByRole('button', { name: '添加工作区', exact: true }).click();
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  const input = page.getByRole('textbox', { name: '发送消息', exact: true });
  await input.fill('@hello');
  await expect(page.getByRole('option', { name: /hello\.txt/ })).toBeVisible();
  await input.press('Enter');
  await expect(page.getByRole('button', { name: '移除文件 hello.txt', exact: true })).toBeVisible();
  await input.fill('$写作');
  await expect(page.getByRole('option', { name: /writing/ })).toBeVisible();
  await input.press('Enter');
  await expect(page.getByRole('button', { name: '移除 Skill writing', exact: true })).toBeVisible();
  await input.fill('整理这个文件的内容');
  await expect.poll(() => page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: { previewRequests: Partial<ComposerDraft>[] } }).__M1TERA_TEST_STATE__.previewRequests.at(-1))).toMatchObject({ text: '整理这个文件的内容', attachments: ['hello.txt'], skillIds: ['writing'] });
  await input.press('Enter');
  await expect.poll(() => starts(page)).toHaveLength(1);
  expect((await starts(page))[0]).toMatchObject({ text: '整理这个文件的内容', attachments: ['hello.txt'], skillIds: ['writing'] });
  await expect(page.locator('.draft-chips')).toHaveCount(0);
});

test('Skills management creates edits disables imports deletes and scopes automatic selection to the session', async ({ page }) => {
  await mockRuntime(page); await page.goto('/');
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.getByRole('button', { name: '管理 Skills', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Skills', exact: true });
  await dialog.getByRole('checkbox', { name: '自动匹配 Skills', exact: true }).check();
  await expect(dialog.getByRole('checkbox', { name: '自动匹配 Skills', exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await dialog.locator('input[name="skillName"]').fill('review');
  await dialog.locator('textarea[name="skillDescription"]').fill('审查代码变更');
  await dialog.locator('input[name="skillTriggers"]').fill('review, 代码审查');
  await dialog.locator('textarea[name="skillInstructions"]').fill('检查行为变化和回归风险。');
  await dialog.getByRole('button', { name: '保存 Skill', exact: true }).click();
  await dialog.getByRole('button', { name: /review 审查代码变更/ }).click();
  await dialog.locator('textarea[name="skillInstructions"]').fill('优先检查边界与权限，再审查行为变化。');
  await dialog.getByRole('button', { name: '保存 Skill', exact: true }).click();
  await dialog.getByRole('checkbox', { name: '启用 Skill review', exact: true }).uncheck();
  await expect(dialog.getByRole('checkbox', { name: '启用 Skill review', exact: true })).not.toBeChecked();
  await dialog.getByRole('button', { name: '导入', exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: '启用 Skill imported-skill', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: { importedPaths: string[] } }).__M1TERA_TEST_STATE__.importedPaths)).toEqual(['/tmp/test-skills/SKILL.md']);
  await dialog.getByRole('button', { name: '删除 Skill imported-skill', exact: true }).click();
  const confirmation = page.getByRole('alertdialog', { name: '删除“imported-skill”？', exact: true });
  await confirmation.getByRole('button', { name: '删除 Skill', exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: '启用 Skill imported-skill', exact: true })).toHaveCount(0);
  const library = await page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: { skills: Skill[] } }).__M1TERA_TEST_STATE__.skills);
  expect(library.find((skill) => skill.name === 'review')).toMatchObject({ enabled: false, instructions: '优先检查边界与权限，再审查行为变化。', triggers: ['review', '代码审查'] });
  await dialog.getByRole('button', { name: '关闭 Skills', exact: true }).click();
  await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('$review');
  await expect(page.getByText('没有匹配的结果', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.getByRole('button', { name: '管理 Skills', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '自动匹配 Skills', exact: true })).not.toBeChecked();
});

test('a failed first send keeps the new-session draft command and skill chips available for retry', async ({ page }) => {
  await mockRuntime(page); await page.goto('/'); await login(page);
  const input = page.getByRole('textbox', { name: '发送消息', exact: true });
  await input.fill('/plan'); await input.press('Enter');
  await input.fill('$writing');
  await expect(page.getByRole('option', { name: /writing/ })).toBeVisible();
  await input.press('Enter');
  await input.fill('首次发送失败'); await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText('模拟首次发送失败');
  await expect(input).toHaveValue('首次发送失败');
  await expect(page.locator('.draft-command')).toHaveText('做计划');
  await expect(page.getByRole('button', { name: '移除 Skill writing', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
  expect((await starts(page))[0]).toMatchObject({ text: '首次发送失败', command: 'plan', skillIds: ['writing'] });
  await input.fill('重试这个计划'); await input.press('Enter');
  await expect.poll(() => starts(page)).toHaveLength(2);
  expect((await starts(page))[1]).toMatchObject({ text: '重试这个计划', command: 'plan', skillIds: ['writing'] });
  await expect(page.locator('.draft-chips')).toHaveCount(0);
});

test('an unsent draft in another session cannot replace a running search payload or its 128k limit', async ({ page }) => {
  await mockRuntime(page, true); await page.goto('/'); await login(page);
  await page.getByRole('button', { name: /^会话 1(?: 运行中)?$/ }).click();
  const input = page.getByRole('textbox', { name: '发送消息', exact: true });
  await input.fill('/websearch'); await input.press('Enter');
  await input.fill('后台搜索长任务'); await input.press('Enter');
  const ring = page.getByRole('button', { name: /^上下文占用：/ });
  await expect(ring).toHaveAccessibleName('上下文占用：预计 700 / 128,000 tokens');
  await expect(page.locator('.running-tool').filter({ hasText: '联网搜索' })).toBeVisible();
  const searchPreviews = await page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: { previewRequests: { sessionId?: string }[] } }).__M1TERA_TEST_STATE__.previewRequests.filter((request) => request.sessionId === 'fixture-1').length);
  await page.getByRole('button', { name: '会话 0', exact: true }).click();
  await input.fill('a'.repeat(8000));
  await expect(ring).toHaveAccessibleName('上下文占用：预计 2,040 / 272,000 tokens');
  await page.getByRole('button', { name: /^会话 1(?: 运行中)?$/ }).click();
  await expect(page.getByRole('heading', { name: '会话 1', exact: true })).toBeVisible();
  await expect(ring).toHaveAccessibleName('上下文占用：预计 700 / 128,000 tokens');
  await ring.hover();
  await expect(page.getByRole('tooltip')).toContainText('128,000');
  // Re-entering a running session must not request a fresh pure-chat preview.
  expect(await page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: { previewRequests: { sessionId?: string }[] } }).__M1TERA_TEST_STATE__.previewRequests.filter((request) => request.sessionId === 'fixture-1').length)).toBe(searchPreviews);
});

test('a cancelled hosted search settles the pending tool card without a lingering spinner', async ({ page }) => {
  await mockRuntime(page); await page.goto('/'); await login(page);
  const input = page.getByRole('textbox', { name: '发送消息', exact: true });
  await input.fill('/websearch'); await input.press('Enter');
  await input.fill('后台搜索长任务'); await input.press('Enter');
  const search = page.locator('.tool-card').filter({ hasText: '联网搜索' });
  await expect(search).toContainText('执行中');
  await expect(search.locator('.spin')).toHaveCount(1);
  // The fixture emits run.finished without tool.finished, as a provider-side cancellation can.
  await page.getByRole('button', { name: '停止运行', exact: true }).click();
  await expect(search).toContainText('已停止');
  await expect(search).toHaveClass(/tool-error/);
  await expect(search.locator('.spin')).toHaveCount(0);
  await expect(page.locator('.running-tool')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '停止运行', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeVisible();
});
