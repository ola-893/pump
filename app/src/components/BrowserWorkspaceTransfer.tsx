import { useRef, useState } from 'react';
import { exportBrowserWorkspace, importBrowserWorkspace } from '../lib/browser-workspace';

export function BrowserWorkspaceTransfer({ refresh }: { refresh: () => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function transfer(task: () => Promise<void>) {
    setBusy(true);
    setNotice('');
    setError('');
    try { await task(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not transfer this workspace.'); }
    finally { setBusy(false); }
  }

  async function importFile(file: File) {
    if (file.size > 256 * 1024 ** 2) throw new Error('This backup is larger than the 256 MB import limit.');
    const result = await importBrowserWorkspace(JSON.parse(await file.text()));
    await refresh();
    setNotice(`Imported ${result.imported} agents. Kept ${result.skipped} already saved in this browser.`);
  }

  async function exportFile() {
    const backup = await exportBrowserWorkspace();
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pump-workspace.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <details className="nd-card na-detail">
    <summary className="na-account-summary">Workspace backup and migration</summary>
    <p className="na-note">Transfer agents, strategies, and journals with a local Pump backup file. Keep it private.</p>
    <div className="nd-buttons">
      <button className="nd-button secondary" disabled={busy} onClick={() => input.current?.click()}>Import workspace</button>
      <button className="nd-button secondary" disabled={busy} onClick={() => void transfer(exportFile)}>Export workspace</button>
    </div>
    <input ref={input} type="file" hidden accept=".json,application/json" onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) void transfer(() => importFile(file));
    }}/>
    {busy && <p role="status">Checking workspace records…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="nd-alert">{error}</p>}
  </details>;
}
