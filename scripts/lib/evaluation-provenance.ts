import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface EvaluationProvenance {
  /** Compatibility field: the actual checkout containing the capture harness. */
  sourceRevision: string;
  sourceTreeDirty: boolean | null;
  evaluatedSourceRevision: string;
  harnessRevision: string;
  instrumentationSha256: string | null;
}

/** Reads public SCM metadata only. A baseline manifest never silently overrides a mismatched extraction. */
export function evaluationProvenance(directory = process.cwd()): EvaluationProvenance {
  const git = (args: string[]) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const result: EvaluationProvenance = { sourceRevision: 'unknown', sourceTreeDirty: null, evaluatedSourceRevision: 'unknown', harnessRevision: 'unknown', instrumentationSha256: null };
  try {
    const revision = git(['rev-parse', 'HEAD']).trim();
    if (/^[a-f0-9]{40,64}$/i.test(revision)) result.sourceRevision = result.evaluatedSourceRevision = result.harnessRevision = revision.toLowerCase();
    result.sourceTreeDirty = git(['status', '--porcelain', '--untracked-files=normal']).trim().length > 0;
  } catch { return result; }
  const manifestPath = join(directory, 'docs', 'conversation-baseline-bench.json');
  if (!existsSync(manifestPath)) return result;
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!manifest || typeof manifest !== 'object') throw new Error('Invalid baseline instrumentation manifest.');
  const value = manifest as Record<string, unknown>;
  if (typeof value.evaluatedSourceRevision !== 'string' || !/^[a-f0-9]{40,64}$/i.test(value.evaluatedSourceRevision)
    || typeof value.instrumentationSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(value.instrumentationSha256)
    || !Array.isArray(value.instrumentedProductionPaths) || !value.instrumentedProductionPaths.length
    || value.instrumentedProductionPaths.some(path => typeof path !== 'string' || !/^server\/[a-z0-9/-]+\.ts$/i.test(path))) throw new Error('Invalid baseline instrumentation manifest.');
  const revision = value.evaluatedSourceRevision.toLowerCase();
  git(['merge-base', '--is-ancestor', revision, 'HEAD']);
  const allowed = new Set([...value.instrumentedProductionPaths as string[], 'src/restaurant/evaluation.ts', 'src/restaurant/evaluation-fixtures.ts', 'src/restaurant/evaluation-runtime.ts']);
  const changed = [...git(['diff', '--name-only', revision, '--', 'src', 'server']).split('\n'), ...git(['ls-files', '--others', '--exclude-standard', '--', 'src', 'server']).split('\n')].filter(Boolean);
  if (changed.some(path => !allowed.has(path))) throw new Error('Baseline contains source changes outside the reviewed instrumentation; no requests were sent.');
  const diff = git(['diff', '--no-ext-diff', '--binary', '--full-index', revision, '--', ...value.instrumentedProductionPaths]);
  const hash = createHash('sha256').update(diff).digest('hex');
  if (hash !== value.instrumentationSha256.toLowerCase()) throw new Error('Baseline instrumentation differs from its reviewed manifest; no requests were sent.');
  if (value.bridgeCompatibility !== undefined) {
    const compat = value.bridgeCompatibility as Record<string, unknown> | null;
    const delta = compat?.fieldDelta as Record<string, { from?: string; to?: string; schema?: string; name?: string; strict?: boolean }> | undefined;
    if (!compat || compat.originalAdapterPath !== 'server/restaurant/horde.ts' || compat.shimPath !== 'scripts/lib/baseline-horde-compat.ts'
      || typeof compat.originalAdapterSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(compat.originalAdapterSha256)
      || typeof compat.shimSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(compat.shimSha256)
      || !delta || Object.keys(delta).length !== 2 || delta['horde.context_fit']?.from !== 'reject' || delta['horde.context_fit']?.to !== 'grow'
      || delta.response_format?.from !== 'json_object' || delta.response_format?.to !== 'json_schema'
      || delta.response_format?.name !== 'date_turn' || delta.response_format?.schema !== 'request.outputSchema ?? TURN_SCHEMA' || delta.response_format?.strict !== true) throw new Error('Invalid baseline bridge compatibility manifest; no requests were sent.');
    const digest = (text: string) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
    const adapter = digest(readFileSync(join(directory, compat.originalAdapterPath), 'utf8'));
    const frozen = digest(git(['show', `${revision}:${compat.originalAdapterPath}`]));
    const shim = digest(readFileSync(join(directory, compat.shimPath), 'utf8'));
    if (adapter !== frozen || adapter !== compat.originalAdapterSha256.toLowerCase() || shim !== compat.shimSha256.toLowerCase()) throw new Error('Baseline bridge compatibility differs from its reviewed manifest; no requests were sent.');
  }
  if (value.directCompatibility !== undefined) {
    const compat = value.directCompatibility as Record<string, unknown> | null;
    if (!compat || compat.adapterPath !== 'scripts/lib/baseline-dolphin-llm.ts' || compat.modelPath !== 'scripts/lib/baseline-direct-model.ts'
      || typeof compat.adapterSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(compat.adapterSha256)
      || typeof compat.modelSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(compat.modelSha256)
      || typeof compat.candidateAdapterSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(compat.candidateAdapterSha256)) throw new Error('Invalid baseline direct-provider compatibility manifest; no requests were sent.');
    const digest = (text: string) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
    const adapter = readFileSync(join(directory, compat.adapterPath), 'utf8').replace(/\r\n/g, '\n');
    const restored = adapter.replace("from '../../server/restaurant/providers'", "from './providers'").replace("from '../../server/restaurant/openrouter'", "from './openrouter'").replace("from './baseline-direct-model'", "from '../../src/restaurant/types'");
    if (digest(adapter) !== compat.adapterSha256.toLowerCase() || digest(readFileSync(join(directory, compat.modelPath), 'utf8')) !== compat.modelSha256.toLowerCase() || digest(restored) !== compat.candidateAdapterSha256.toLowerCase()) throw new Error('Baseline direct-provider compatibility differs from its reviewed manifest; no requests were sent.');
  }
  return { ...result, evaluatedSourceRevision: revision, instrumentationSha256: hash };
}
