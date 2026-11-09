import { randomBytes } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { gateConversationReview, prepareConversationReview, reviewSha256, type CoordinatorKey, type HumanReviewPacket } from './lib/conversation-review';

const usage = `Offline only; no providers, browser, server or automatic ratings.
Prepare: pnpm review:conversations prepare --baseline baseline.json --candidate candidate.json --packets .qa/review/human --key .qa/review-private/key.json [--seed-file private-seed.txt]
Gate: pnpm review:conversations gate --baseline baseline.json --candidate candidate.json --key .qa/review-private/key.json --reviews reviewer-1.json,reviewer-2.json
Keep the coordinator key outside the shared packet directory. Give each human only their packet and a separate cast reference sheet, never the ordering key. Outputs are created once and never overwritten.`;
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help') { console.log(usage); return; }
  if (!['prepare', 'gate'].includes(command)) throw new Error(usage);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!['--baseline', '--candidate', '--packets', '--key', '--reviews', '--seed-file'].includes(flag) || !value || value.startsWith('--') || values.has(flag)) throw new Error(`Invalid or duplicate option: ${flag}`);
    values.set(flag, value);
  }
  const required = (flag: string) => { const value = values.get(flag); if (!value) throw new Error(`Missing ${flag}.`); return resolve(value); };
  const baselineBytes = await readFile(required('--baseline')), candidateBytes = await readFile(required('--candidate'));
  const baseline = JSON.parse(baselineBytes.toString('utf8')), candidate = JSON.parse(candidateBytes.toString('utf8'));
  const hashes = { baseline: reviewSha256(baselineBytes), candidate: reviewSha256(candidateBytes) };
  const keyPath = required('--key');
  if (command === 'prepare') {
    const directory = required('--packets'), keyRelative = relative(directory, keyPath);
    if (keyRelative !== '..' && !keyRelative.startsWith('..' + sep) && !isAbsolute(keyRelative)) throw new Error('The coordinator key must be outside the human packet directory.');
    const secret = values.has('--seed-file') ? (await readFile(required('--seed-file'), 'utf8')).trim() : randomBytes(32).toString('hex');
    const prepared = prepareConversationReview(baseline, candidate, secret, hashes);
    const outputs = [{ path: keyPath, value: prepared.key }, { path: resolve(directory, 'cast-reference.json'), value: prepared.reference }, ...prepared.packets.map((packet, index) => ({ path: resolve(directory, `reviewer-${index + 1}.json`), value: packet }))];
    for (const output of outputs) { try { await access(output.path); throw new Error(`Refusing to overwrite an existing review artifact: ${output.path}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
    for (const output of outputs) { await mkdir(dirname(output.path), { recursive: true }); await writeFile(output.path, JSON.stringify(output.value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
    console.log(`Prepared ${prepared.packets.length} unrated human packets. Coordinator key: ${keyPath}. Do not share it with reviewers.`);
    return;
  }
  const files = values.get('--reviews')?.split(',');
  if (files?.length !== 2 || files.some(file => !file.trim())) throw new Error('Supply exactly two completed human packet files with --reviews.');
  const key = JSON.parse(await readFile(keyPath, 'utf8')) as CoordinatorKey;
  // Validate report parity/provenance again; formal review never accepts legacy or unknown captures.
  prepareConversationReview(baseline, candidate, 'offline-report-parity-validation-only', hashes);
  const packets = await Promise.all(files.map(async file => JSON.parse(await readFile(resolve(file), 'utf8')) as HumanReviewPacket));
  const result = gateConversationReview(key, packets, hashes);
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'pass') process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Offline review failed.'); process.exitCode = 1; });
