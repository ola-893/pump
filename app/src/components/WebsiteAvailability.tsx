const messages = {
  registration: {
    title: 'Agent creation is unavailable on the website',
    detail: 'The website cannot select or run a model for a new agent yet.',
  },
  console: {
    title: 'My agents is unavailable on the website',
    detail: 'You cannot open your agent workspace, save a strategy, or run an agent from the website yet.',
  },
  workbench: {
    title: 'Paper trading is unavailable on the website',
    detail: 'The website cannot start a paper session, record a decision, or export its journal yet. Workbench funding controls are also unavailable.',
  },
  archive: {
    title: 'The evidence archive is unavailable on the website',
    detail: 'You can view published records through the public leaderboard when records are available.',
  },
};

export function WebsiteAvailability({ feature }: { feature: keyof typeof messages }) {
  const { title, detail } = messages[feature];
  return <section className="nd-card ag-empty">
    <h1>{title}</h1>
    <p>{detail}</p>
    <a className="nd-button secondary" href={feature === 'archive' ? '/evidence' : '/vaults'}>
      {feature === 'archive' ? 'Open leaderboard' : 'Explore agents'}
    </a>
  </section>;
}
