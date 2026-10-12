import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environment = { ...process.env };
const localCargo = path.join(root, '.toolchains/cargo');
const executable = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
if (existsSync(path.join(localCargo, 'bin', executable))) {
  environment.CARGO_HOME = localCargo;
  environment.RUSTUP_HOME = path.join(root, '.toolchains/rustup');
  environment.PATH = `${path.join(localCargo, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`;
}
const child = spawn(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), ...process.argv.slice(2)], {
  cwd: root, env: environment, stdio: 'inherit',
});
child.on('error', () => { console.error('无法启动 Tauri CLI，请先运行 npm ci。'); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
