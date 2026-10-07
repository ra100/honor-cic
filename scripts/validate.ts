import { parsePack } from '../src/core/schema';
import { solve } from '../src/core/solver/solve';
import { TECH } from '../src/core/tech';
import { formatIssues, hasErrors, validateReplay, validateStatic } from '../src/core/validate';
import { rawPacks } from '../src/registry';

const verbose = process.argv.includes('--verbose');
let failed = false;
for (const [id, raw] of Object.entries(rawPacks())) {
  const parsed = parsePack(raw);
  if (!parsed.ok) {
    console.log(`FAIL ${id}: pack does not parse\n${parsed.errors.join('\n')}`);
    failed = true;
    continue;
  }
  const issues = validateStatic(parsed.pack, TECH);
  let ms = 0;
  if (!hasErrors(issues)) {
    const t0 = performance.now();
    const replay = solve(parsed.pack, TECH);
    ms = performance.now() - t0;
    issues.push(...validateReplay(parsed.pack, TECH, replay));
  }
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warns = issues.filter((i) => i.severity === 'warn').length;
  console.log(`${errors ? 'FAIL' : 'ok  '} ${id}: ${errors} errors, ${warns} warnings, solved in ${ms.toFixed(0)} ms`);
  const shown = issues.filter((i) => verbose || i.severity !== 'info');
  if (shown.length) console.log(formatIssues(shown));
  if (errors) failed = true;
}
process.exit(failed ? 1 : 0);
