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
  return { ...result, evaluatedSourceRevision: revision, instrumentationSha256: hash };
}
