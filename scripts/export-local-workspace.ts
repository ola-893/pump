import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import type { AgentRecord } from '../near-demo/agents.js';
import type { StrategyRun } from '../near-demo/public-types.js';
import type { WorkspacePaper, WorkspaceTransfer } from '../near-demo/workspace-transfer.js';

const [, , source, destination] = process.argv;
if (!source || !destination) throw new Error('Usage: node --import tsx scripts/export-local-workspace.ts <paper.sqlite> <new backup.json>');
const database = new DatabaseSync(source, { readOnly: true });
try {
  database.exec('BEGIN');
  const agents = database.prepare('SELECT body FROM near_agents ORDER BY rowid').all();
  const strategies = database.prepare('SELECT body FROM near_strategy_runs ORDER BY rowid').all()
    .map(row => JSON.parse(String(row.body)) as StrategyRun);
  const session = database.prepare('SELECT body FROM sessions WHERE id = ?');
  const events = database.prepare('SELECT body FROM events WHERE session = ? ORDER BY sequence');
  function paper(id: string): WorkspacePaper {
    const row = session.get(id);
    if (!row) throw new Error('An agent or strategy references a missing paper session.');
    return {
      session: JSON.parse(String(row.body)),
      events: events.all(id).map(event => JSON.parse(String(event.body))),
    };
  }
  const backup: WorkspaceTransfer = {
    version: 'PUMP-LOCAL-WORKSPACE-v1',
    agents: agents.map(row => {
      const { id, manifest, commitment, sessionId } = JSON.parse(String(row.body)) as AgentRecord;
      return { id, manifest, commitment, paper: paper(sessionId),
        runs: strategies.filter(run => run.agentId === id).map(run => ({ ...run, paper: paper(run.sessionId) })) };
    }),
  };
  database.exec('COMMIT');
  writeFileSync(destination, JSON.stringify(backup), { flag: 'wx', mode: 0o600 });
  console.log(`Exported ${backup.agents.length} agents and ${strategies.length} strategy versions.`);
} finally {
  database.close();
}
