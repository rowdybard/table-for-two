import { spawn } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = dirname(fileURLToPath(import.meta.url));
const temporaryRoot = await realpath(tmpdir());
const validationRoot = await mkdtemp(join(temporaryRoot, 'table-for-two-cf-'));

async function copyOrdinaryTree(source, destination) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error('The deployment output contains an actual symbolic link.');
  if (info.isFile()) { await copyFile(source, destination); return; }
  if (!info.isDirectory()) throw new Error('The deployment output contains a non-file entry.');
  await mkdir(destination, { recursive: true });
  for (const name of await readdir(source)) await copyOrdinaryTree(join(source, name), join(destination, name));
}

try {
  // Windows directory entries can report OneDrive cloud reparse points as
  // symlinks even when lstat identifies ordinary files. Validate identical bytes
  // outside the sync directory, retaining the official CLI's portability checks.
  await copyOrdinaryTree(join(project, '.cloudflare/output/v0'), join(validationRoot, '.cloudflare/output/v0'));
  const child = spawn(process.execPath, [join(project, 'node_modules/cf/bin/cf'), 'deploy', '--prebuilt', '--mode', 'production', '--dry-run'],
    { cwd: validationRoot, stdio: 'inherit', windowsHide: true });
  process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
} finally {
  const resolved = await realpath(validationRoot);
  if (dirname(resolved) !== temporaryRoot || !basename(resolved).startsWith('table-for-two-cf-')) throw new Error('Unexpected temporary validation path.');
  await rm(resolved, { recursive: true, force: true });
}
