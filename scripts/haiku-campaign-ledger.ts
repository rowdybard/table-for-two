// The shared ledgers for the simulation campaigns: `init` creates one once, `status` prints it. Neither sends a request.
import { resolve } from 'node:path';
import { CAMPAIGNS, CampaignLedger, campaignLedgerPath, isCampaignName, readCampaignManifest } from './lib/campaign-ledger';

const command = process.argv[2], name = process.argv[3] ?? 'haiku';
try {
  if (!isCampaignName(name)) throw new Error('Campaign must be haiku or dolphin.');
  const selected = CAMPAIGNS[name], manifest = readCampaignManifest(resolve(selected.manifest));
  const path = campaignLedgerPath(process.env, manifest as { sharedLedgerPath?: string }, selected.ledgerEnv);
  if (command === 'init') { CampaignLedger.init({ path, manifest }); console.log(`Created the campaign ledger at ${path} with $0 spent of $${manifest.totalLimitUSD}.`); }
  else if (command === 'status') console.log(JSON.stringify({ path, campaignId: manifest.campaignId, limitUSD: manifest.totalLimitUSD, ...new CampaignLedger({ path, manifest }).totals() }, null, 2));
  else { console.log('Usage: pnpm campaign:ledger init|status [haiku|dolphin] (set HAIKU_CAMPAIGN_LEDGER or DOLPHIN_CAMPAIGN_LEDGER to the shared file). init never overwrites an existing ledger.'); process.exitCode = command ? 1 : 0; }
} catch (error) { console.error(error instanceof Error ? error.message : 'Ledger command failed.'); process.exitCode = 1; }
