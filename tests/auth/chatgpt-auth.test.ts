import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import type { OAuthAuth, Provider } from '@earendil-works/pi-ai';
import { ChatGPTAuth } from '../../runtime/chatgpt-auth.js';
import type { RuntimeEvent } from '../../shared/protocol.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const directory = async () => { const dir = await mkdtemp(path.join(os.tmpdir(), 'm1tera-auth-')); directories.push(dir); return dir; };
function provider(login: OAuthAuth['login']): Provider {
  return { ...openaiProvider(), auth: { oauth: {
    name: 'test', login,
    async refresh(credential) { return credential; },
    async toAuth(credential) { return { apiKey: credential.access }; },
  } } };
}

describe('ChatGPT account connection', () => {
  it('keeps credentials in memory and reuses a non-secret installation ID', async () => {
    const dir = await directory();
    const events: RuntimeEvent[] = [];
    const fake = provider(async () => ({ type: 'oauth', access: 'fixture-access-secret', refresh: 'fixture-refresh-secret', expires: Date.now() + 3_600_000 }));
    const auth = new ChatGPTAuth(dir, (event) => events.push(event), fake);
    await auth.initialize();
    expect(auth.startLogin()).toEqual({ started: true });
    expect(auth.startLogin()).toEqual({ started: false });
    await vi.waitFor(() => expect(auth.status()).toEqual({ connected: true, loginPending: false }));
    expect(await auth.getAuth()).toEqual({ apiKey: 'fixture-access-secret' });
    const before = await readFile(path.join(dir, 'chatgpt-host.json'), 'utf8');
    const second = new ChatGPTAuth(dir, () => {}, fake);
    await second.initialize();
    expect(await readFile(path.join(dir, 'chatgpt-host.json'), 'utf8')).toBe(before);
    expect(second.status().connected).toBe(false);
    expect(await readdir(dir)).toEqual(['chatgpt-host.json']);
    expect(before + JSON.stringify(events)).not.toContain('fixture-access-secret');
    expect(before + JSON.stringify(events)).not.toContain('fixture-refresh-secret');
    await auth.logout();
    expect(auth.status().connected).toBe(false);
  });

  it('cancels a pending callback without leaving the login busy', async () => {
    const events: RuntimeEvent[] = [];
    const auth = new ChatGPTAuth(await directory(), (event) => events.push(event), provider(async (interaction) => {
      await interaction.prompt({ type: 'manual_code', message: 'callback', signal: interaction.signal });
      throw new Error('should not finish');
    }));
    await auth.initialize();
    auth.startLogin();
    await vi.waitFor(() => expect(events.some((event) => event.type === 'auth.prompt')).toBe(true));
    expect(auth.cancel()).toEqual({ cancelled: true });
    await vi.waitFor(() => expect(auth.status().loginPending).toBe(false));
    expect(auth.status().connected).toBe(false);
    const prompt = events.find((event) => event.type === 'auth.prompt');
    if (prompt?.type === 'auth.prompt') expect(auth.respond(prompt.id, 'unused')).toEqual({ resolved: false });
  });

  it('does not expose OAuth token endpoint error bodies', async () => {
    const events: RuntimeEvent[] = [];
    const auth = new ChatGPTAuth(await directory(), (event) => events.push(event), provider(async () => {
      throw new Error('token_endpoint echoed fixture-refresh-private');
    }));
    await auth.initialize();
    auth.startLogin();
    await vi.waitFor(() => expect(auth.status().loginPending).toBe(false));
    expect(JSON.stringify(events)).not.toContain('fixture-refresh-private');
    await expect(auth.getAuth()).rejects.toThrow('Continue with ChatGPT');
  });
});
