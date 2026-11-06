import { hostedApp, useLocalRunner, connectRunner, disconnectRunner, cancelRunnerConnection } from '../lib/local-runner';
export function LocalRunnerConnection() {
  const runner = useLocalRunner();
  if (!hostedApp) return null;
  return <section className="nd-card na-detail" aria-label="Local runner connection" style={{ marginBottom: 24 }}>
    <div className="nd-card-top"><div><h2>{runner.connected ? 'Local runner connected' : 'Connect your local runner'}</h2>
      <p>{runner.connected ? 'Your agents and models run on this computer. Wallet approvals remain separate.' : 'Keep your models on your computer and use them from this app. Start the runner from your Pump checkout:'}</p>
      {!runner.connected && <code>npm run runner</code>}</div>
      {runner.connected ? <button className="nd-button secondary" onClick={() => void disconnectRunner()}>Disconnect runner</button> : <button className="nd-button" disabled={runner.connecting} onClick={connectRunner}>{runner.connecting ? 'Approve in the runner window…' : 'Connect local runner'}</button>}
    </div>{runner.connecting && <button className="nd-text-button" onClick={cancelRunnerConnection}>Cancel connection</button>}
    {runner.error && <p role="alert" className="nd-inline-error">{runner.error}</p>}
  </section>;
}
