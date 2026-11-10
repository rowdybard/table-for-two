// One persistent spending ledger for a whole simulation campaign. Every process, worktree, agent, baseline and
// candidate run that makes a live request must reserve from this single file first, so the campaign ceiling holds
// no matter how many invocations there are. The per-run `--budget` flag is still checked separately.
//
// Rules, all fail-closed:
//  - the ledger file is created only by an explicit `init`; a run never creates, resets or replaces it;
//  - a reservation is written to disk (under an exclusive lock, with an atomic rename) before the request is sent;
//  - a settled request is charged what the provider reported, an unsettled or unknown one keeps its whole reservation;
//  - a model outside the manifest's allow-list, or a request that would pass the ceiling, is refused before dispatch.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface CampaignManifest { campaignId: string; totalLimitUSD: number; allowedModels: string[]; fallbackModelsAllowed?: boolean; automaticProviderRetriesAllowed?: boolean; voiceCallsAllowed?: boolean; automatedAiJudgeAllowed?: boolean }
export interface CampaignEntry { id: string; at: string; model: string; label: string; reservedUSD: number; status: 'reserved' | 'settled' | 'retained'; chargedUSD: number }
export interface CampaignLedgerFile { version: 1; campaignId: string; totalLimitUSD: number; allowedModels: string[]; createdAt: string; entries: CampaignEntry[] }
export class CampaignBudgetError extends Error { constructor(readonly code: 'model_not_allowed' | 'ceiling' | 'ledger_missing' | 'ledger_mismatch' | 'ledger_locked' | 'ledger_corrupt' | 'invalid_amount' | 'unknown_reservation', message: string) { super(message); this.name = 'CampaignBudgetError'; } }

const MICRO = 1e6;
/** Whole micro-dollars, rounded up, so repeated fractions can never undercount. */
const micros = (usd: number) => Math.ceil(usd * MICRO - 1e-9);
const valid = (usd: number) => Number.isFinite(usd) && usd >= 0;

export function readCampaignManifest(path: string): CampaignManifest {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as CampaignManifest;
  if (typeof manifest.campaignId !== 'string' || !manifest.campaignId || !valid(manifest.totalLimitUSD) || manifest.totalLimitUSD <= 0 || !Array.isArray(manifest.allowedModels) || !manifest.allowedModels.length || manifest.allowedModels.some(model => typeof model !== 'string')) throw new CampaignBudgetError('ledger_corrupt', 'The campaign manifest is missing its id, limit or allowed models.');
  return manifest;
}

function parse(raw: string): CampaignLedgerFile {
  let file: CampaignLedgerFile;
  try { file = JSON.parse(raw) as CampaignLedgerFile; } catch { throw new CampaignBudgetError('ledger_corrupt', 'The campaign ledger is not valid JSON; no request was sent. Do not replace it: recover it by hand.'); }
  if (file?.version !== 1 || typeof file.campaignId !== 'string' || !valid(file.totalLimitUSD) || !Array.isArray(file.allowedModels) || !Array.isArray(file.entries)
    || file.entries.some(entry => typeof entry?.id !== 'string' || !valid(entry.reservedUSD) || !valid(entry.chargedUSD) || !['reserved', 'settled', 'retained'].includes(entry.status))) throw new CampaignBudgetError('ledger_corrupt', 'The campaign ledger has an unexpected shape; no request was sent.');
  return file;
}
/** What the ledger counts against the ceiling: settled charges plus every reservation still open or retained. */
export function campaignTotals(file: CampaignLedgerFile) {
  let charged = 0, open = 0;
  for (const entry of file.entries) { if (entry.status === 'reserved') open += micros(entry.reservedUSD); else charged += micros(entry.chargedUSD); }
  const committed = charged + open, limit = Math.floor(file.totalLimitUSD * MICRO + 1e-9);
  return { chargedUSD: charged / MICRO, openReservationsUSD: open / MICRO, committedUSD: committed / MICRO, remainingUSD: Math.max(0, limit - committed) / MICRO, requests: file.entries.length,
    unsettled: file.entries.filter(entry => entry.status !== 'settled').length };
}

export interface CampaignLedgerOptions { path: string; manifest: CampaignManifest; lockWaitMs?: number; now?: () => Date }
export class CampaignLedger {
  private readonly lockPath: string;
  constructor(private readonly options: CampaignLedgerOptions) {
    if (!options.path) throw new CampaignBudgetError('ledger_missing', 'No campaign ledger path was given.');
    this.lockPath = `${options.path}.lock`;
  }
  get path() { return this.options.path; }

  /** Explicit, one-time creation. Never overwrites: an existing ledger, even an empty or broken one, is left alone. */
  static init(options: CampaignLedgerOptions): CampaignLedgerFile {
    mkdirSync(dirname(options.path), { recursive: true });
    const file: CampaignLedgerFile = { version: 1, campaignId: options.manifest.campaignId, totalLimitUSD: options.manifest.totalLimitUSD, allowedModels: [...options.manifest.allowedModels], createdAt: (options.now?.() ?? new Date()).toISOString(), entries: [] };
    let fd: number;
    try { fd = openSync(options.path, 'wx'); } catch { throw new CampaignBudgetError('ledger_mismatch', 'A campaign ledger already exists at that path; it was not reset.'); }
    try { writeSync(fd, JSON.stringify(file, null, 2)); } finally { closeSync(fd); }
    return file;
  }

  private load(): CampaignLedgerFile {
    if (!existsSync(this.options.path)) throw new CampaignBudgetError('ledger_missing', 'The campaign ledger does not exist; no request was sent. Create it once with the explicit init command, and never recreate a lost one at zero.');
    const file = parse(readFileSync(this.options.path, 'utf8')), manifest = this.options.manifest;
    if (file.campaignId !== manifest.campaignId || file.totalLimitUSD !== manifest.totalLimitUSD || file.allowedModels.join('\n') !== manifest.allowedModels.join('\n')) throw new CampaignBudgetError('ledger_mismatch', 'The campaign ledger belongs to a different campaign, limit or model list; no request was sent.');
    return file;
  }
  private save(file: CampaignLedgerFile) {
    const temporary = `${this.options.path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(file, null, 2), { flag: 'wx' });
    renameSync(temporary, this.options.path);
  }
  /** Exclusive cross-process section. A lock that cannot be taken in time refuses the request; it is never broken. */
  private locked<T>(work: () => T): T {
    const deadline = Date.now() + (this.options.lockWaitMs ?? 30_000);
    let fd: number | undefined;
    for (;;) {
      try { fd = openSync(this.lockPath, 'wx'); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (Date.now() >= deadline) throw new CampaignBudgetError('ledger_locked', 'The campaign ledger is locked by another process; no request was sent. If no run is active, remove the .lock file by hand.');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 + Math.floor(Math.random() * 30));
      }
    }
    try { writeSync(fd, `${process.pid}`); return work(); } finally { closeSync(fd); rmSync(this.lockPath, { force: true }); }
  }

  totals() { return campaignTotals(this.load()); }

  /** Records a reservation on disk before dispatch, or throws without touching the ledger. */
  reserve(model: string, reservationUSD: number, label: string): string {
    if (!valid(reservationUSD) || reservationUSD <= 0) throw new CampaignBudgetError('invalid_amount', 'A reservation must be a positive USD amount.');
    if (!this.options.manifest.allowedModels.includes(model)) throw new CampaignBudgetError('model_not_allowed', `${model} is not allowed in this campaign; no request was sent.`);
    return this.locked(() => {
      const file = this.load(), totals = campaignTotals(file);
      if (micros(totals.committedUSD) + micros(reservationUSD) > Math.floor(file.totalLimitUSD * MICRO + 1e-9)) throw new CampaignBudgetError('ceiling', `The campaign ceiling of $${file.totalLimitUSD} would be passed ($${totals.committedUSD.toFixed(6)} committed, $${reservationUSD.toFixed(6)} requested); no request was sent.`);
      const id = randomUUID();
      file.entries.push({ id, at: (this.options.now?.() ?? new Date()).toISOString(), model, label: label.slice(0, 200), reservedUSD: reservationUSD, status: 'reserved', chargedUSD: 0 });
      this.save(file);
      return id;
    });
  }
  /**
   * Reconciles one reservation. With complete reported usage the request is charged the reported cost (never less than
   * zero, and more than the reservation if the provider says so); otherwise the whole reservation stays charged.
   */
  settle(id: string, reportedUSD: number | null): CampaignEntry {
    if (reportedUSD !== null && !valid(reportedUSD)) throw new CampaignBudgetError('invalid_amount', 'A reported cost must be a non-negative USD amount.');
    return this.locked(() => {
      const file = this.load(), entry = file.entries.find(item => item.id === id);
      if (!entry) throw new CampaignBudgetError('unknown_reservation', 'That reservation is not in the campaign ledger.');
      if (entry.status !== 'reserved') return entry;
      if (reportedUSD === null) { entry.status = 'retained'; entry.chargedUSD = entry.reservedUSD; }
      else { entry.status = 'settled'; entry.chargedUSD = reportedUSD; }
      this.save(file);
      return entry;
    });
  }
}

/** The ledger location for this machine: an explicit environment path wins over the manifest's recorded one. */
export function campaignLedgerPath(env: NodeJS.ProcessEnv, manifest: { sharedLedgerPath?: string }): string {
  const path = env.HAIKU_CAMPAIGN_LEDGER?.trim() || manifest.sharedLedgerPath?.trim();
  if (!path) throw new CampaignBudgetError('ledger_missing', 'Set HAIKU_CAMPAIGN_LEDGER to the shared campaign ledger file; no request was sent.');
  return path;
}
