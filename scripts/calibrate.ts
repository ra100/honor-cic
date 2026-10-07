import { solve } from '../src/core/solver/solve';
import { TECH } from '../src/core/tech';
import { validateReplay } from '../src/core/validate';
import { getPack } from '../src/registry';

const id = process.argv.filter((a) => !a.startsWith('-')).at(-1) ?? 'manticore';
const pack = getPack(id);
if (!pack) {
  console.error(`No valid pack "${id}"`);
  process.exit(1);
}
const replay = solve(pack, TECH, (phase, f) => process.stderr.write(`${phase} ${(f * 100).toFixed(0)}%\n`));
const canon = validateReplay(pack, TECH, replay).filter((i) => i.check === 'canon' || i.check === 'escape' || i.check === 'flight');
console.log(`Scenario ${id}, hash ${replay.hash}`);
console.log('Canon constraints outside tolerance, and calibration notes:');
for (const i of canon) console.log(`  ${i.severity.padEnd(5)} ${i.message}`);
console.log('Interception by fire plan:');
for (const [plan, st] of Object.entries(replay.stats.intercept)) {
  console.log(`  ${plan.padEnd(22)} ${((100 * st.intercepted) / Math.max(1, st.arriving)).toFixed(1)}% of ${st.arriving.toLocaleString('en-US')}`);
}
console.log('Final status by side:', JSON.stringify(replay.stats.finalStatus));
