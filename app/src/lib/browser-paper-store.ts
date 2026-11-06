import { verifyHistory } from '../../../near-demo/ledger.js';
import type { Event, Session } from '../../../near-demo/types.js';
import type { WorkspacePaper } from '../../../near-demo/workspace-transfer.js';

export class BrowserPaperStore {
  private lease: string | null = null;
  readonly paper: WorkspacePaper;
  private readonly signal?: AbortSignal;
  constructor(paper: WorkspacePaper, signal?: AbortSignal) {
    this.paper = paper;
    this.signal = signal;
  }
  list() { return [this.paper.session]; }
  read(id: string) {
    if (id !== this.paper.session.id) throw new Error('Paper session not found.');
    return this.paper.session;
  }
  create(_session: Session) { throw new Error('Create browser paper sessions through the workspace.'); }
  history(id: string) { this.read(id); return this.paper.events; }
  recent(id: string) { return this.history(id).slice(-120); }
  lastQuotedValuation(id: string) {
    return this.history(id).slice().reverse().find(event => (event.kind === 'mark' || event.kind === 'dust') &&
      event.after.equity !== null && event.after.markAt !== null);
  }
  acquire(id: string) {
    this.read(id);
    if (this.lease) throw new Error('A paper decision is already running.');
    return this.lease = crypto.randomUUID();
  }
  renew(id: string, token: string) {
    this.read(id);
    if (this.lease !== token) throw new Error('The paper session lease changed.');
  }
  release(id: string, token: string) { this.renew(id, token); this.lease = null; }
  save(session: Session, token: string, event?: Event) {
    this.renew(session.id, token);
    if (event?.kind === 'fill') this.signal?.throwIfAborted();
    if (this.paper.session.revision !== session.revision || event &&
      (event.sequence !== session.sequence + 1 || event.previousHash !== session.head)) {
      throw new Error('Paper session checkpoint changed.');
    }
    const next = { ...session, revision: session.revision + 1 };
    if (event) {
      next.sequence = event.sequence;
      next.head = event.hash;
      next.portfolio = event.after;
      this.paper.events.push(event);
    }
    return this.paper.session = next;
  }
  export(id: string) {
    const session = this.read(id), events = this.history(id);
    return { version: 'PUMPCOIN-NEAR-PAPER-v1', session, events, replay: verifyHistory(session, events) };
  }
}
