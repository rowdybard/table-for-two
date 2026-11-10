import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluationProvenance } from '../scripts/lib/evaluation-provenance';

test('baseline provenance separates evaluated code from its clean harness and rejects changed extraction', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'date-eval-provenance-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const commit = () => { git('add', '.'); git('-c', 'user.name=Evaluation fixture', '-c', 'user.email=evaluation@example.invalid', 'commit', '-qm', 'Offline fixture'); return git('rev-parse', 'HEAD'); };
  try {
    git('init', '--initial-branch=main'); await mkdir(join(directory, 'server')); await mkdir(join(directory, 'docs'));
    await mkdir(join(directory, 'server', 'restaurant'));
    await writeFile(join(directory, 'server', 'restaurant', 'horde.ts'), 'export const frozenAdapter = true;\n');
    await writeFile(join(directory, 'server', 'base.ts'), 'export const baseline = true;\n');
    const evaluatedSourceRevision = commit();
    assert.deepEqual(evaluationProvenance(directory), { sourceRevision: evaluatedSourceRevision, evaluatedSourceRevision, harnessRevision: evaluatedSourceRevision, sourceTreeDirty: false, instrumentationSha256: null });
    await writeFile(join(directory, 'server', 'base.ts'), 'export const baseline = true;\nexport const instrumented = baseline;\n');
    const diff = execFileSync('git', ['diff', '--no-ext-diff', '--binary', '--full-index', evaluatedSourceRevision, '--', 'server/base.ts'], { cwd: directory, encoding: 'utf8' });
    const instrumentationSha256 = createHash('sha256').update(diff).digest('hex');
    const manifest = { evaluatedSourceRevision, instrumentationSha256, instrumentedProductionPaths: ['server/base.ts'] };
    await writeFile(join(directory, 'docs', 'conversation-baseline-bench.json'), JSON.stringify(manifest));
    const harnessRevision = commit();
    assert.deepEqual(evaluationProvenance(directory), { sourceRevision: harnessRevision, evaluatedSourceRevision, harnessRevision, sourceTreeDirty: false, instrumentationSha256 });
    await mkdir(join(directory, 'scripts', 'lib'), { recursive: true });
    const shim = 'export const shim = true;\n', original = 'export const frozenAdapter = true;\n';
    await writeFile(join(directory, 'scripts', 'lib', 'baseline-horde-compat.ts'), shim);
    const digest = (text: string) => createHash('sha256').update(text).digest('hex');
    const bridgeCompatibility = { originalAdapterPath: 'server/restaurant/horde.ts', originalAdapterSha256: digest(original), shimPath: 'scripts/lib/baseline-horde-compat.ts', shimSha256: digest(shim), fieldDelta: { 'horde.context_fit': { from: 'reject', to: 'grow' }, response_format: { from: 'json_object', to: 'json_schema', name: 'date_turn', schema: 'request.outputSchema ?? TURN_SCHEMA', strict: true } } };
    await writeFile(join(directory, 'docs', 'conversation-baseline-bench.json'), JSON.stringify({ ...manifest, bridgeCompatibility }));
    assert.equal(evaluationProvenance(directory).evaluatedSourceRevision, evaluatedSourceRevision);
    await writeFile(join(directory, 'scripts', 'lib', 'baseline-horde-compat.ts'), 'changed\n');
    assert.throws(() => evaluationProvenance(directory), /bridge compatibility differs/);
    await writeFile(join(directory, 'scripts', 'lib', 'baseline-horde-compat.ts'), shim);
    const direct = "import {} from '../../server/restaurant/providers';\nimport {} from '../../server/restaurant/openrouter';\nimport {} from './baseline-direct-model';\n";
    const directOriginal = direct.replace("from '../../server/restaurant/providers'", "from './providers'").replace("from '../../server/restaurant/openrouter'", "from './openrouter'").replace("from './baseline-direct-model'", "from '../../src/restaurant/types'");
    const model = 'export const model = true;\n';
    await writeFile(join(directory, 'scripts', 'lib', 'baseline-dolphin-llm.ts'), direct);
    await writeFile(join(directory, 'scripts', 'lib', 'baseline-direct-model.ts'), model);
    const directCompatibility = { adapterPath: 'scripts/lib/baseline-dolphin-llm.ts', adapterSha256: digest(direct), candidateAdapterSha256: digest(directOriginal), modelPath: 'scripts/lib/baseline-direct-model.ts', modelSha256: digest(model) };
    await writeFile(join(directory, 'docs', 'conversation-baseline-bench.json'), JSON.stringify({ ...manifest, bridgeCompatibility, directCompatibility }));
    assert.equal(evaluationProvenance(directory).evaluatedSourceRevision, evaluatedSourceRevision);
    await writeFile(join(directory, 'scripts', 'lib', 'baseline-direct-model.ts'), 'changed\n');
    assert.throws(() => evaluationProvenance(directory), /direct-provider compatibility differs/);
    await writeFile(join(directory, 'scripts', 'lib', 'baseline-direct-model.ts'), model);
    await writeFile(join(directory, 'server', 'behavior.ts'), 'export const unrelatedBehaviorChange = true;\n');
    assert.throws(() => evaluationProvenance(directory), /outside the reviewed instrumentation/);
    await rm(join(directory, 'server', 'behavior.ts'));
    await writeFile(join(directory, 'server', 'base.ts'), 'export const baseline = false;\n');
    assert.throws(() => evaluationProvenance(directory), /differs from its reviewed manifest/);
    await writeFile(join(directory, 'docs', 'conversation-baseline-bench.json'), JSON.stringify({ ...manifest, instrumentedProductionPaths: ['../outside.ts'] }));
    assert.throws(() => evaluationProvenance(directory), /Invalid baseline instrumentation manifest/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a capture outside SCM records unknown provenance without inventing a baseline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'date-eval-no-git-'));
  try { assert.deepEqual(evaluationProvenance(directory), { sourceRevision: 'unknown', evaluatedSourceRevision: 'unknown', harnessRevision: 'unknown', sourceTreeDirty: null, instrumentationSha256: null }); }
  finally { await rm(directory, { recursive: true, force: true }); }
});
