import type { IncomingMessage } from 'node:http';

export function allowedRequest(req: Pick<IncomingMessage, 'headers' | 'socket'>): boolean {
  const address = req.socket.remoteAddress;
  if (!address || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return false;
  const host = req.headers.host;
  if (!host || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host)) return false;
  return !req.headers.origin || req.headers.origin === `http://${host}`;
}
