// Vercel Node.js function entry. The build script bundles this file (plus
// /shared, zod, Hono, @google/genai) into one self-contained index.mjs.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import app from './index';
import { envFromProcess } from './env';

const env = envFromProcess();
const listener = getRequestListener((request) => app.fetch(request, env));

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return listener(req, res);
}
