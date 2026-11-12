// Local dev server: `npm run dev` (reads .env.local). Same app as production.
import { serve } from '@hono/node-server';
import app from './index';
import { envFromProcess } from './env';

const env = envFromProcess();
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: (request) => app.fetch(request, env), port }, () => {
  console.log(`skinfix backend on http://localhost:${port}  (mock=${env.MOCK === '1'}, store=${env.store.kind})`);
});
