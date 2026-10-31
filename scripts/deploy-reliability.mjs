import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const project = process.env.SUPABASE_PROJECT_REF || readFileSync('supabase/config.toml','utf8').match(/^project_id\s*=\s*"([a-z]+)"/m)?.[1];
if (!project || !/^[a-z]{20}$/.test(project)) throw new Error('Set SUPABASE_PROJECT_REF to the intended project');
// Apply only the new additive migration. Do not replay the historical migrations.
const steps = [
  ['supabase','db','query','--project-ref',project,'--file','supabase/migrations/20261050_view_once.sql'],
  ['supabase','functions','deploy','cleanup-media','--project-ref',project],
  ['supabase','functions','deploy','view-once','--project-ref',project],
];
for (const args of steps) {
  const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { stdio:'inherit', shell:process.platform === 'win32' });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
console.log('Server reliability update deployed. Verify the two-user checklist in docs/RELIABILITY_ROLLOUT.md.');
