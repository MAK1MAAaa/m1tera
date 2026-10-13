import { expect, test, type Page } from '@playwright/test';
import { addCustomProvider, addManualModel, login, mockRuntime, openSettings } from './fixtures';
import type { FixtureState } from './fixtures';

async function openBenchmarks(page: Page) {
  await page.getByRole('button', { name: '评测', exact: true }).click();
  return page.getByRole('dialog', { name: '模型与 Harness 评测', exact: true });
}

test('harness policy round trips through settings without accepting out of range budgets', async ({ page }) => {
  await mockRuntime(page); await page.goto('/');
  const settings = await openSettings(page);
  await settings.locator('input[name="toolResultTokenLimit"]').fill('8192');
  await settings.locator('input[name="maxModelTurns"]').fill('7');
  await settings.locator('input[name="runTimeoutSeconds"]').fill('90');
  await settings.locator('input[name="offloadToolResults"]').uncheck();
  await settings.getByRole('button', { name: '保存设置', exact: true }).click();
  expect(await page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: FixtureState }).__M1TERA_TEST_STATE__.settings.harness)).toEqual({ offloadToolResults: false, toolResultTokenLimit: 8192, maxModelTurns: 7, runTimeoutSeconds: 90 });
  const reopened = await openSettings(page);
  await expect(reopened.locator('input[name="offloadToolResults"]')).not.toBeChecked();
  await expect(reopened.locator('input[name="toolResultTokenLimit"]')).toHaveValue('8192');
  await expect(reopened.locator('input[name="maxModelTurns"]')).toHaveValue('7');
  await expect(reopened.locator('input[name="runTimeoutSeconds"]')).toHaveValue('90');
  await reopened.locator('input[name="offloadToolResults"]').check();
  await reopened.locator('input[name="toolResultTokenLimit"]').fill('511');
  const writes = await page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: FixtureState }).__M1TERA_TEST_STATE__.settingsWrites.length);
  await reopened.getByRole('button', { name: '保存设置', exact: true }).click();
  expect(await reopened.locator('input[name="toolResultTokenLimit"]').evaluate((element: HTMLInputElement) => element.validity.rangeUnderflow)).toBe(true);
  expect(await page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: FixtureState }).__M1TERA_TEST_STATE__.settingsWrites.length)).toBe(writes);
  await expect(reopened).toBeVisible();
});

test('resuming an interrupted task exposes unknown effects and asks again without resubmitting input', async ({ page }) => {
  await mockRuntime(page, false, 0, { connected: true, resumable: true }); await page.goto('/');
  const recovery = page.getByRole('status', { name: '可继续的任务', exact: true });
  await expect(recovery).toContainText('2 个工具结果未知，请先检查实际状态');
  await expect(recovery).toContainText('逐次审批，不自动重跑此前工具');
  await recovery.getByRole('button', { name: '继续任务', exact: true }).click();
  await expect(recovery).toHaveCount(0);
  await expect(page.getByRole('button', { name: '停止运行', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '审批模式', exact: true })).toContainText('逐次审批');
  const state = await page.evaluate(() => {
    const fixture = (window as Window & { __M1TERA_TEST_STATE__: FixtureState }).__M1TERA_TEST_STATE__;
    return { resumes: fixture.resumeRequests, starts: fixture.runStarts, session: fixture.sessions[0] };
  });
  expect(state.resumes).toEqual(['recovered-session']);
  expect(state.starts).toEqual([]);
  expect(state.session.messages).toHaveLength(1);
  expect(state.session.approvalMode).toBe('ask');
});

test('fixture benchmark reports show graded coverage and unknown cases without a model score', async ({ page }) => {
  await mockRuntime(page, false, 0, { connected: true }); await page.goto('/');
  const dialog = await openBenchmarks(page);
  await dialog.locator('input[name="benchmarkLimit"]').fill('3');
  await dialog.getByRole('button', { name: '开始评测', exact: true }).click();
  await page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: FixtureState }).__M1TERA_TEST_STATE__.finishBenchmark());
  const result = dialog.getByRole('region', { name: '评测结果', exact: true });
  await expect(result).toContainText('模拟验证 · 不计模型成绩');
  await expect(result.locator('.benchmark-metrics > div').nth(0)).toContainText('未知');
  await expect(result.locator('.benchmark-metrics > div').nth(1)).toContainText('2 / 3');
  await expect(result.locator('.benchmark-metrics > div').nth(2)).toContainText('未知1');
  await expect(result.locator('.benchmark-case-table tbody')).toContainText('fixture-2未知');
  await expect(dialog).not.toContainText('100.0%');
  await result.getByText('逐题详情', { exact: true }).click();
  await result.locator('.benchmark-case-detail').filter({ hasText: 'fixture-2' }).locator('summary').click();
  await expect(result.getByText('模拟评分请求失败', { exact: true })).toBeVisible();
  await result.getByText('来源与评分规则', { exact: true }).click();
  await expect(result).toContainText('本地 TypeScript 移植');
  await expect(result).toContainText('不对标官方完整榜单');
  const fixture = await page.evaluate(() => {
    const state = (window as Window & { __M1TERA_TEST_STATE__: FixtureState }).__M1TERA_TEST_STATE__;
    return { starts: state.benchmarkStarts, report: Object.values(state.benchmarkReports)[0] };
  });
  expect(fixture.starts).toEqual([{ suite: 'bfcl-v4', limit: 3 }]);
  expect(fixture.report.mode).toBe('fixture');
  expect(fixture.report.metrics.accuracy).toBeNull();
});

test('benchmark controls require a connection and SimpleQA progress remains cancellable', async ({ page }) => {
  await mockRuntime(page); await page.goto('/');
  let dialog = await openBenchmarks(page);
  await expect(dialog.getByRole('button', { name: '开始评测', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '关闭评测', exact: true }).click();
  await login(page);
  dialog = await openBenchmarks(page);
  await dialog.locator('select[name="benchmarkSuite"]').selectOption('simpleqa');
  await dialog.locator('input[name="benchmarkLimit"]').fill('3');
  await expect(dialog).toContainText('作答与另次评分请求使用同一模型');
  await dialog.getByRole('button', { name: '开始评测', exact: true }).click();
  await page.evaluate(() => {
    const state = (window as Window & { __M1TERA_TEST_STATE__: FixtureState }).__M1TERA_TEST_STATE__;
    state.benchmarkRunning!.completed = 1;
    state.emit({ type: 'benchmark.progress', ...state.benchmarkRunning! });
  });
  const progress = dialog.getByRole('status', { name: '评测进度', exact: true });
  await expect(progress).toContainText('1 / 3');
  await expect(dialog.getByRole('button', { name: '开始评测', exact: true })).toBeDisabled();
  await progress.getByRole('button', { name: '停止评测', exact: true }).click();
  await expect(progress).toHaveCount(0);
  const result = dialog.getByRole('region', { name: '评测结果', exact: true });
  await expect(result).toContainText('已停止');
  await expect(result).toContainText('同模型评分可能存在偏差');
  await expect(result.locator('.benchmark-metrics > div').nth(1)).toContainText('1 / 3');
  await expect(result.locator('.benchmark-metrics > div').nth(2)).toContainText('未知2');
  expect(await page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: FixtureState }).__M1TERA_TEST_STATE__.benchmarkCancels)).toBe(1);
});

test('multiple provider warnings keep picker heading and search inside the minimum window', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await mockRuntime(page, false, 0, { connected: true }); await page.goto('/');
  await page.evaluate(() => {
    const state = (window as Window & { __M1TERA_TEST_STATE__: FixtureState }).__M1TERA_TEST_STATE__;
    for (let index = 0; index < 4; index++) {
      const id = `warning-provider-${index}`;
      state.settings.customProviders!.push({ id, name: `接口 ${index}`, baseUrl: `https://fixture-${index}.test/v1`, apiFormat: 'responses', models: [{ id: `custom-${index}`, enabled: true, source: 'manual' }] });
      state.providerWarnings[id] = `接口 ${index} 模拟目录获取失败。${'保留已知名称和容量，状态改为未验证。'.repeat(5)}`;
    }
    state.emit({ type: 'auth.status', status: { connected: true, loginPending: false } });
  });
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  const picker = page.getByRole('region', { name: '模型选择', exact: true });
  await expect(picker.locator('.model-warning')).toHaveCount(4);
  await expect(picker.locator('.popover-heading')).toBeInViewport();
  await expect(picker.getByRole('textbox', { name: '筛选模型', exact: true })).toBeInViewport();
  const bounds = await picker.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(600);
  const geometry = await picker.evaluate((element) => {
    const body = element.querySelector('.model-popover-scroll')!;
    return { scrollable: body.scrollHeight > body.clientHeight, overflow: getComputedStyle(body).overflowY, windowY: window.scrollY, documentHeight: document.documentElement.scrollHeight };
  });
  expect(geometry).toMatchObject({ scrollable: true, overflow: 'auto', windowY: 0 });
  expect(geometry.documentHeight).toBeLessThanOrEqual(600);
});

test('a failed local refresh retains metadata and drafts while revoking directory verification', async ({ page }) => {
  await mockRuntime(page); await page.goto('/');
  const settings = await openSettings(page);
  await addCustomProvider(page, '目录缓存接口');
  const provider = settings.getByRole('region', { name: '目录缓存接口', exact: true });
  await provider.getByRole('button', { name: '拉取模型列表', exact: true }).click();
  const remote = provider.locator('.configured-model').filter({ hasText: 'remote-model' });
  await expect(remote).toContainText('目录已验证');
  await remote.getByRole('checkbox').check();
  await provider.getByRole('button', { name: '手动添加模型', exact: true }).click();
  await provider.locator('input[name="modelId"]').fill('pending-model');
  await provider.locator('input[name="modelName"]').fill('待保存的模型');
  await page.evaluate(() => { (window as Window & { __M1TERA_TEST_STATE__: FixtureState }).__M1TERA_TEST_STATE__.failDiscoveries = true; });
  await provider.getByRole('button', { name: '拉取模型列表', exact: true }).click();
  await expect(remote).toContainText('未验证');
  await expect(remote).not.toContainText('目录已验证');
  await expect(remote).toContainText('共享模型');
  await expect(remote).toContainText('32,768 tokens');
  await expect(remote.getByRole('checkbox')).toBeChecked();
  await expect(provider.locator('input[name="modelId"]')).toHaveValue('pending-model');
  await expect(provider.locator('input[name="modelName"]')).toHaveValue('待保存的模型');
  await expect(provider.locator('input[name$=":deprecated-model"]')).toBeDisabled();
});

test('legal long provider names wrap in settings summaries and delete confirmations', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await mockRuntime(page); await page.goto('/');
  const name = 'W'.repeat(100);
  let settings = await openSettings(page);
  await addCustomProvider(page, name);
  await (await addManualModel(page, name, 'long-provider-model', '长名接口的模型')).check();
  await settings.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await page.getByRole('option', { name: /长名接口的模型/ }).click();
  settings = await openSettings(page);
  await expect(settings.locator('.current-model-summary')).toContainText(name);
  const horizontalOverflow = await settings.locator('.settings-scroll').evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
  await settings.getByRole('button', { name: `移除接口 ${name}`, exact: true }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation.getByRole('heading')).toContainText(name);
  expect(await confirmation.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => window.scrollX)).toBe(0);
});

test('an interrupted task requires reconnecting before the resume RPC can be sent', async ({ page }) => {
  await mockRuntime(page, false, 0, { resumable: true }); await page.goto('/');
  const resume = page.getByRole('button', { name: '继续任务', exact: true });
  await expect(resume).toBeDisabled();
  expect(await page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: FixtureState }).__M1TERA_TEST_STATE__.resumeRequests)).toEqual([]);
  await login(page);
  await expect(resume).toBeEnabled();
});

test('Enter outside the explicit benchmark start button cannot admit a model request', async ({ page }) => {
  await mockRuntime(page, false, 0, { connected: true }); await page.goto('/');
  const dialog = await openBenchmarks(page);
  const suite = dialog.locator('select[name="benchmarkSuite"]');
  const limit = dialog.locator('input[name="benchmarkLimit"]');
  await suite.selectOption('simpleqa');
  await suite.press('Enter');
  await limit.fill('2');
  await limit.press('Enter');
  // Exercise implicit form submission too: only activation of the named start button admits work.
  await dialog.locator('form.benchmark-controls').evaluate((form: HTMLFormElement) => form.requestSubmit());
  expect(await page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: FixtureState }).__M1TERA_TEST_STATE__.benchmarkStarts)).toEqual([]);
  await expect(dialog.getByRole('status', { name: '评测进度', exact: true })).toHaveCount(0);
  const start = dialog.getByRole('button', { name: '开始评测', exact: true });
  await start.focus();
  await start.press('Enter');
  await expect(dialog.getByRole('status', { name: '评测进度', exact: true })).toContainText('SimpleQA');
  expect(await page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: FixtureState }).__M1TERA_TEST_STATE__.benchmarkStarts)).toEqual([{ suite: 'simpleqa', limit: 2 }]);
});
