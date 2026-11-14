import { createApp } from './app.mjs';

try {
  const port = Number(process.env.PORT || 4180);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
  const server = createApp({ supabaseUrl: process.env.SUPABASE_URL, publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY });
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`Read-only foundation API listening on ${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
} catch (error) {
  console.error(`Cannot start API: ${error.message}`);
  process.exitCode = 1;
}
