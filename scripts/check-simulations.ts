// Logic checks for simulated conversations. `inputs` checks the authored corpus; `outputs <report.json>` checks a saved
// evaluation report. Neither makes a request or rates quality.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EVALUATION_SCRIPTS } from '../src/restaurant/evaluation';
import { ENDURANCE_SCRIPTS } from '../src/restaurant/evaluation-endurance';
import { CLOSING_SCRIPTS } from '../src/restaurant/evaluation-closing';
import { checkReportOutputs, checkScriptInputs, summarizeIssues, type SimulationReport } from './lib/simulation-checks';

const [command, file, out] = process.argv.slice(2);
try {
  if (command === 'inputs') {
    const all = [...EVALUATION_SCRIPTS, ...ENDURANCE_SCRIPTS, ...CLOSING_SCRIPTS], issues = all.flatMap(checkScriptInputs);
    console.log(JSON.stringify({ scripts: all.length, ...summarizeIssues(issues), issues }, null, 2));
    if (issues.some(issue => issue.severity === 'fail')) process.exitCode = 1;
  } else if (command === 'outputs' && file) {
    const report = JSON.parse(readFileSync(resolve(file), 'utf8')) as SimulationReport;
    const inputIssues = (report.selectedScripts ?? []).flatMap(checkScriptInputs), issues = checkReportOutputs(report);
    const result = { report: file, conversations: report.results.length, turns: report.results.reduce((sum, item) => sum + item.turns.length, 0), inputs: summarizeIssues(inputIssues), outputs: summarizeIssues(issues), inputIssues, issues };
    if (out) writeFileSync(resolve(out), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, inputIssues: undefined, issues: out ? `written to ${out}` : issues }, null, 2));
  } else { console.log('Usage: pnpm check:simulations inputs | outputs <report.json> [checks.json]'); process.exitCode = command ? 1 : 0; }
} catch (error) { console.error(error instanceof Error ? error.message : 'Check failed.'); process.exitCode = 1; }
