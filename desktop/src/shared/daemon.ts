export const DEFAULT_DAEMON_PORT = 4173;
export function daemonHttpBase(port = DEFAULT_DAEMON_PORT): string { return `http://127.0.0.1:${port}`; }
export function daemonWsBase(port = DEFAULT_DAEMON_PORT): string { return `ws://127.0.0.1:${port}/ws`; }
