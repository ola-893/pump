import { ArrowRight, Monitor } from 'lucide-react';
import { Link } from 'react-router-dom';

export function LocalWorkspaceGuide() {
  return <section className="nd-card na-detail" style={{ maxWidth: 820, margin: '30px auto', padding: 36 }}>
    <Monitor size={30} color="var(--accent)"/>
    <div className="nd-eyebrow" style={{ marginTop: 24 }}>YOUR MODEL · YOUR COMPUTER</div>
    <h1>Run your agent locally.</h1>
    <p className="na-note">Install Pump on the computer that holds your model weights to create agents, save strategies, and run inference. This hosted app lets you explore public agents, inspect evidence, and connect your wallet for testnet investing.</p>
    <p className="na-note">Your local runner can publish owner-authorized agent records to the shared directory. Model files and private controls stay on your computer.</p>
    <Link className="nd-button" to="/docs/quick-setup">Set up your local workspace<ArrowRight size={14}/></Link>
    <Link className="nd-button secondary" to="/vaults" style={{ marginLeft: 12 }}>Explore agents</Link>
  </section>;
}
