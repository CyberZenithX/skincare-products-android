# Skin Fix

Android app (Expo, sideloaded APK) that reads a selfie plus 5 quick answers, shows a **Skin Map** of the face, and recommends 1–2 affordable product types for the main concern, each with up to 3 **real** noon.com listings under the user's budget.

The rule above everything else is **accurate results**. When speed, looks or extra features conflict with accuracy, accuracy wins.

```
/app            Expo app (TypeScript, Expo Router, dev build — not Expo Go)
/worker         Cloudflare Worker (Hono, TypeScript): /analyze /clarify /products /verify /probe /health
/worker/mocks   saved sample responses served when MOCK=1
/shared         zod schemas + types + safety rules + Skin Map geometry (used by app and Worker)
/fixtures       test inputs (noon pages, ML Kit contours, consented selfies)
```

## noon fetch test (Phase 1): result

**Blocked from datacenter IPs. Treat the phone WebView (Layer 2) as the expected main path, and the Worker fetch (Layer 1) as a bonus.**

What was tested on 2026-11-12, from a cloud container (not yet from Cloudflare's own edge):

| Client | Result |
|---|---|
| `curl` with a browser User-Agent and `Accept-Language: en-AE` (HTTP/2 and HTTP/1.1) | TLS completes, then noon drops the connection (`INTERNAL_ERROR` / empty reply) |
| Real headless Chromium (Playwright) | HTTP 502, 174-byte body |
| The Worker itself under `wrangler dev` (workerd runtime), `GET /probe` | HTTP 503, 0 bytes, so `verdict: "blocked"`, and `/products` correctly returns `{"status":"blocked"}` |
| Other sites from the same container | load normally |

Because a real browser is blocked too, this is an IP-reputation block, not a User-Agent or TLS-fingerprint issue. Cloudflare Worker egress is also datacenter IP space, so expect the same. **Still to do (needs the Cloudflare account):** deploy and run `GET /probe` from the real edge, then update this table. If it says `works`, Layer 1 becomes the main path again with no code changes.

```bash
curl -H "x-invite-code: $CODE" -H "x-device-id: probe-0001" "https://<worker>.workers.dev/probe?q=niacinamide%20serum"
```

**Parser status:** `parseNoonSearch` reads `__NEXT_DATA__`, Next.js app-router flight chunks, a bare JSON string, and (strictly) visible HTML tiles. It finds catalogue items anywhere in the JSON rather than at one hard-coded path. It is tested against **synthetic** fixtures shaped like noon's catalogue items (`fixtures/noon/SYNTHETIC-*`), because noon couldn't be reached from here. **Before Phase 3 sign-off:** save a real search page from a phone or home connection into `fixtures/noon/` (e.g. `real-niacinamide-serum.html`) and add a test for it.

## Environment

Worker secrets (`npx wrangler secret put …`): `GEMINI_API_KEY`, `INVITE_CODE`.
Worker vars (`worker/wrangler.toml`): `GEMINI_MODEL` (default `gemini-3.8-flash`, the newest Flash in `@google/genai` 3.2), `GEMINI_TEMPERATURE` (0.2), `SCANS_PER_DAY` (20), `MOCK` (`1` = serve `/worker/mocks`).
KV: one namespace bound as `KV` (`npx wrangler kv namespace create KV`, then paste the id into `wrangler.toml`).
App: `EXPO_PUBLIC_API_URL` (the Worker URL).

Local Worker dev: copy `worker/.dev.vars.example` to `worker/.dev.vars`.

## Commands

```bash
cd worker && npm i && npx wrangler dev          # Worker locally (MOCK from .dev.vars)
cd worker && npm test                            # parser, filter, products pipeline, routes
cd shared && npm i && npm test                   # safety rules, Skin Map zone builder
cd app && npx expo run:android                   # dev build on a connected phone
cd app && eas build -p android --profile preview # APK
cd app && eas update --channel preview           # JS-only fix to installed apps
```

## How accuracy is protected (design decisions)

- **Same judgment in English and Arabic.** The analysis prompt and inputs are byte-identical for both languages (answers are sent as option ids, and the language isn't in the prompt). Arabic text comes from a separate translation call over the free-text fields only. Enums, scores, queries, categories and ingredients are never translated in place: Arabic display names go in `product_display`.
- **User answers override the photo, enforced in code.** Q1/Q2 answered by the user set skin type and sensitivity, and Q3 sets the main focus. `enforceProfile` in `/shared` applies this after Gemini, so a model slip can't change it.
- **Safety rules are enforced twice** (prompt, then `/shared/src/safety.ts`). That covers avoided ingredients ("fragrance-free" and fatty alcohols are not false hits), pregnancy or "not sure" (no retinoids, no peels, no AHA >10% or BHA >2%), prescription medicine (gentle basics only, no actives) and red flags (no actives for a flagged main focus). Patch tests are forced for actives.
- **Gemini output is validated** with zod plus semantic checks. On failure it retries once with the problem fed back, then returns a clean error.
- **Listings are never written by Gemini.** Gemini sees text-only candidates and returns ids. Ids not in the list are rejected, and the card is built from the stored listing. Gemini may return fewer than 3 if fewer truly fit: a wrong product is worse than a short list.
- **The cache key** includes avoid terms, product type, ingredients and language as well as query and budget, so one user's filter can't leak into another user's results.
- **Left/right** is always the person's own side. The still is un-mirrored, Gemini is told the person's left is on the image right, and the zone builder decides sides by geometry, not by ML Kit's contour names.

## Privacy

There is no request logging middleware. Errors log a message only, never a body. Photos are forwarded to Gemini and dropped. Invite code plus device id are required on every endpoint except `/health`, with a per-device daily scan limit in KV.
