// The shared ledger for the Haiku simulation campaign: `init` creates it once, `status` prints it. Neither sends a request.
import { resolve } from 'node:path';
import { CampaignLedger, campaignLedgerPath, readCampaignManifest } from './lib/campaign-ledger';

const command = process.argv[2];
try {
  const manifest = readCampaignManifest(resolve('docs/HAIKU_SIMULATION_CAMPAIGN.json'));
  const path = campaignLedgerPath(process.env, manifest as { sharedLedgerPath?: string });
  if (command === 'init') { CampaignLedger.init({ path, manifest }); console.log(`Created the campaign ledger at ${path} with $0 spent of $${manifest.totalLimitUSD}.`); }
  else if (command === 'status') console.log(JSON.stringify({ path, campaignId: manifest.campaignId, limitUSD: manifest.totalLimitUSD, ...new CampaignLedger({ path, manifest }).totals() }, null, 2));
  else { console.log('Usage: pnpm campaign:ledger init|status (set HAIKU_CAMPAIGN_LEDGER to the shared file). init never overwrites an existing ledger.'); process.exitCode = command ? 1 : 0; }
} catch (error) { console.error(error instanceof Error ? error.message : 'Ledger command failed.'); process.exitCode = 1; }
