import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react';
import { Link, NavLink, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, Copy, Search } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { hostedApp } from '../lib/local-runner';
import overview from '../../../docs/README.md?raw';
import setup from '../../../docs/QUICK-SETUP.md?raw';
import agents from '../../../docs/RUNNING-AGENTS.md?raw';
import investing from '../../../docs/INVESTING.md?raw';
import verification from '../../../docs/VERIFICATION.md?raw';
import troubleshooting from '../../../docs/TROUBLESHOOTING.md?raw';
import './PumpDocs.css';

const repository = 'https://github.com/ola-893/pump';
const websiteOverview = `# Pump documentation

Pump uses simulated trading records and NEAR testnet vaults.

## What you can do on the website

- [Explore agents](/vaults) to find published strategies and available testnet vaults.
- Open the [Leaderboard](/evidence) to inspect and compare published trading records when available.
- Read [Invest on testnet](INVESTING.md) to see what a vault needs before it can accept deposits.

## Creator features

Agent creation, strategy management, and paper trading are currently unavailable through the website alone. See [Run an agent](RUNNING-AGENTS.md) for current availability.`;
const websiteSetup = `# Quick setup

You can browse Pump directly on the website.

## Explore public records

1. Open [Explore agents](/vaults) to see any published agents and their strategy versions.
2. Open the [Leaderboard](/evidence) to compare records once they are available.

## Feature availability

Creating or running an agent and exporting its paper trading journal are currently unavailable through the website. Testnet investing requires a published strategy with an available vault and a NEAR testnet wallet.`;
const websiteAgents = `# Run an agent

## Current availability

The website does not currently offer model selection, strategy management, or paper trading for creators. The [public directory](/vaults) and [leaderboard](/evidence) display published records when available.`;
const websiteVerification = `# Verify results

## Inspect a public record

Open the [Leaderboard](/evidence) and select a published strategy when one is available. Check its strategy version, trade count, valuation timestamp, and any warnings before interpreting returns. These are paper trading results. A testnet vault balance is a separate record.

## Evidence availability

The website cannot run an agent or produce a new paper trading journal. Public records are available after an operator publishes them.`;
const websiteTroubleshooting = `# Troubleshooting

## Agent tools are unavailable

Creating an agent, managing a strategy, and starting a paper session are currently unavailable through the website.

## No agents or records appear

Clear any active filters. If the [directory](/vaults) or [leaderboard](/evidence) is still empty, there are no published entries to display. Investing requires an available vault attached to a published strategy.

## Wallet connection

Pump uses NEAR testnet. If the wallet picker is open, press Escape to return to the page. See [Invest on testnet](INVESTING.md) for wallet and vault requirements.`;
const documents = [
  { slug: '', title: 'Overview', file: 'README.md', content: hostedApp ? websiteOverview : overview, category: 'START HERE' },
  { slug: 'quick-setup', title: 'Quick setup', file: 'QUICK-SETUP.md', content: hostedApp ? websiteSetup : setup, category: 'START HERE' },
  { slug: 'agents', title: 'Run an agent', file: 'RUNNING-AGENTS.md', content: hostedApp ? websiteAgents : agents, category: 'USING PUMP' },
  { slug: 'investing', title: 'Invest on testnet', file: 'INVESTING.md', content: investing, category: 'USING PUMP' },
  { slug: 'verification', title: 'Verify results', file: 'VERIFICATION.md', content: hostedApp ? websiteVerification : verification, category: 'RESOURCES' },
  { slug: 'troubleshooting', title: 'Troubleshooting', file: 'TROUBLESHOOTING.md', content: hostedApp ? websiteTroubleshooting : troubleshooting, category: 'RESOURCES' },
];
const pathFor = (slug: string) => slug ? `/docs/${slug}` : '/docs';
const headingId = (text: string) => text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');

function CodeBlock({ children, ...props }: ComponentPropsWithoutRef<'pre'>) {
  const ref = useRef<HTMLPreElement>(null);
  const [status, setStatus] = useState('Copy');
  useEffect(() => {
    if (status === 'Copy') return;
    const timer = window.setTimeout(() => setStatus('Copy'), 2500);
    return () => window.clearTimeout(timer);
  }, [status]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(ref.current?.textContent ?? '');
      setStatus('Copied');
    } catch { setStatus('Select to copy'); }
  }
  return <div className="pd-code"><div><span>TERMINAL</span><button type="button" onClick={() => void copy()} aria-label="Copy command">{status === 'Copied' ? <Check size={13}/> : <Copy size={13}/>}<span role="status">{status}</span></button></div><pre {...props} ref={ref}>{children}</pre></div>;
}

function DocLink({ href = '', children, ...props }: ComponentPropsWithoutRef<'a'>) {
  if (href.startsWith('#')) return <a {...props} href={href}>{children}</a>;
  if (href.startsWith('/') && !href.startsWith('//')) return <Link to={href}>{children}</Link>;
  // A full navigation in this tab preserves the tab-scoped runner connection.
  if (href.startsWith(window.location.origin + '/')) return <a {...props} href={href}>{children}</a>;
  if (/^https?:\/\//.test(href)) return <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  const resolved = new URL(href, 'https://pump.invalid/docs/');
  const doc = documents.find(item => resolved.pathname === `/docs/${item.file}`);
  if (doc) return <Link to={pathFor(doc.slug) + resolved.hash}>{children}</Link>;
  const source = resolved.pathname.replace(/^\//, '');
  return <a {...props} href={`${repository}/${source.endsWith('/') ? 'tree' : 'blob'}/hackathon/near-2026/${source}${resolved.hash}`} target="_blank" rel="noopener noreferrer">{children}</a>;
}

export default function PumpDocs() {
  const { slug = '' } = useParams();
  const { pathname, hash } = useLocation();
  const [query, setQuery] = useState('');
  const index = documents.findIndex(item => item.slug === slug);
  const doc = documents[index];
  const normalized = query.trim().toLowerCase();
  const matches = documents.filter(item => `${item.title} ${item.content}`.toLowerCase().includes(normalized));
  const sections = doc?.content.split('\n').filter(line => line.startsWith('## ')).map(line => line.slice(3)) ?? [];
  useEffect(() => {
    document.title = `${doc?.title ?? 'Page not found'} · Pump docs`;
    const frame = requestAnimationFrame(() => {
      if (hash) {
        try { document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView(); } catch { /* Invalid URL fragments leave the page readable. */ }
      } else { window.scrollTo(0, 0); }
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash, doc]);

  return <div className="pd-layout">
    <aside className="pd-sidebar" aria-label="Documentation navigation">
      <Link className="pd-brand" to="/docs"><BookOpen size={18}/><span>pump <span>/ docs</span></span></Link>
      <label className="pd-search"><Search size={15}/><input aria-label="Search documentation" placeholder="Find a guide…" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <nav aria-label="Guides">{['START HERE', 'USING PUMP', 'RESOURCES'].map(category => {
        const items = matches.filter(item => item.category === category);
        return items.length ? <div className="pd-nav-group" key={category}><span>{category}</span>{items.map(item => <NavLink key={item.slug} to={pathFor(item.slug)} end onClick={() => setQuery('')}>{item.title}<ArrowRight size={13}/></NavLink>)}</div> : null;
      })}</nav>
      {matches.length === 0 && <p className="pd-no-results" role="status">No guides match “{query}”. Try “wallet”, “model”, or “setup”.</p>}
      <a className="pd-repo" href={`${repository}/tree/hackathon/near-2026/docs`} target="_blank" rel="noopener noreferrer">Read on GitHub<ArrowUpRight size={14}/></a>
      <div className="pd-sidebar-note"><span className="pd-dot"/>NEAR testnet<span>Local models. Inspectable decisions.</span></div>
    </aside>
    {doc ? <>
      <div className="pd-content">
        <div className="pd-breadcrumb"><Link to="/docs">Documentation</Link><span>/</span><span>{doc.title}</span></div>
        <article className="pd-article"><Markdown remarkPlugins={[remarkGfm]} components={{ a: DocLink, pre: CodeBlock, h2: ({ children, ...props }) => <h2 {...props} id={headingId(String(children))}>{children}</h2>, table: ({ children, ...props }) => <div className="pd-table"><table {...props}>{children}</table></div> }}>{doc.content}</Markdown></article>
        <div className="pd-source"><span>{hostedApp ? 'Developer documentation' : 'One guide. In the app and in the repo.'}</span><a href={`${repository}/blob/hackathon/near-2026/docs/${doc.file}`} target="_blank" rel="noopener noreferrer">View on GitHub<ArrowUpRight size={13}/></a></div>
        <nav className="pd-pagination" aria-label="Adjacent guides">
          {index > 0 ? <Link to={pathFor(documents[index - 1].slug)}><ArrowLeft size={16}/><span><small>PREVIOUS</small>{documents[index - 1].title}</span></Link> : <span/>}
          {index < documents.length - 1 && <Link to={pathFor(documents[index + 1].slug)}><span><small>NEXT GUIDE</small>{documents[index + 1].title}</span><ArrowRight size={16}/></Link>}
        </nav>
      </div>
      <aside className="pd-toc" aria-label="On this page"><span>ON THIS PAGE</span><nav>{sections.map(section => <a key={section} href={`#${headingId(section)}`}>{section}</a>)}</nav><div><BookOpen size={17}/><p>New to Pump?</p><Link to="/docs/quick-setup">Start with quick setup<ArrowRight size={12}/></Link></div></aside>
    </> : <section className="pd-content pd-not-found"><span className="nd-eyebrow">DOCUMENTATION</span><h1>Guide not found.</h1><p>Choose a guide from the sidebar or start with quick setup.</p><Link className="nd-button" to="/docs/quick-setup">Quick setup<ArrowRight size={14}/></Link></section>}
  </div>;
}
