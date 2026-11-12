# Skin Fix

Android app (Expo, sideloaded APK) that reads a selfie plus 5 quick answers, shows a **Skin Map** of the face, and recommends 1–2 affordable product types for the main concern, each with up to 3 **real** noon.com listings under the user's budget.

The rule above everything else is **accurate results**. When speed, looks or extra features conflict with accuracy, accuracy wins.

```
/app            Expo app (TypeScript, Expo Router, dev build — not Expo Go)
/backend        Vercel Node.js function (Hono, TypeScript): /analyze /clarify /products /verify /probe /diag /health
/backend/mocks  saved sample responses served when MOCK=1
/shared         zod schemas + types + safety rules + Skin Map geometry + camera guide (used by app and backend)
vercel.json     tells Vercel how to install and build /backend (Build Output API)
/fixtures       test inputs (noon pages, ML Kit contours, consented selfies)
```

## noon fetch test (Phase 1): result

**Blocked from datacenter IPs. Treat the phone WebView (Layer 2) as the expected main path, and the backend's own fetch (Layer 1) as a bonus.**

What was tested on 2026-11-12, from a cloud container (not yet from a deployed Vercel function):

| Client | Result |
|---|---|
| `curl` with a browser User-Agent and `Accept-Language: en-AE` (HTTP/2 and HTTP/1.1) | TLS completes, then noon drops the connection (`INTERNAL_ERROR` / empty reply) |
| Real headless Chromium (Playwright) | HTTP 502, 174-byte body |
| The backend's own fetch, `GET /probe` (Workers runtime, then Node 22 after the Vercel move) | HTTP 503 with 0 bytes; under Node, HTTP 200 with a 2.6 KB page and no products. Both give `verdict: "blocked"`, and `/products` returns `{"status":"blocked"}` |
| The deployed Vercel function, `GET /probe?q=niacinamide serum` | No answer within the 8 s fetch timeout (`verdict: "blocked"`, `error: "TimeoutError"`) |
| Other sites from the same container | load normally |

Because a real browser is blocked too, this is an IP-reputation block, not a User-Agent or TLS-fingerprint issue. The Vercel result fits that: noon doesn't answer datacenter (AWS) traffic at all. Layer 1 (server fetch) will rarely work on Vercel, so the phone WebView (Layer 2) is the main path. If a later probe says `works`, Layer 1 can carry more of the load with no code changes.

```bash
curl -H "x-invite-code: $CODE" -H "x-device-id: probe-0001" "https://<your-project>.vercel.app/probe?q=niacinamide%20serum"
```

**Parser status:** `parseNoonSearch` reads `__NEXT_DATA__`, Next.js app-router flight chunks, a bare JSON string, and (strictly) visible HTML tiles. It finds catalogue items anywhere in the JSON rather than at one hard-coded path. It is tested against **synthetic** fixtures shaped like noon's catalogue items (`fixtures/noon/SYNTHETIC-*`), because noon couldn't be reached from here. **Before Phase 3 sign-off:** save a real search page from a phone or home connection into `fixtures/noon/` (e.g. `real-niacinamide-serum.html`) and add a test for it.

## Status by phase

✅ = done and verified here · 🟡 = built, needs a check only possible with a phone / key / account · ⬜ = not started

| Phase | State | What's verified | What's left (needs Abubakar) |
|---|---|---|---|
| 1 Setup + noon test | 🟡 | Repo layout, `/shared`, mocks. The backend builds for Vercel, and the built function is tested through a Node `(req, res)` launcher. noon test done (blocked, see above). App bundles for Android (`expo export`), and `expo-doctor` passes 20/20 | Dev build on a real phone (`npx expo run:android`). `/probe` from the deployed Vercel function |
| 2 `/analyze` | 🟡 | zod plus semantic validation with one retry, clean errors, invite rejection, per-device limit, MOCK variants, safety enforcement (unit-tested), language-free analysis plus translation. `scripts/check-analyze.mjs` runs end to end against mocks | `GEMINI_API_KEY`, then run `check-analyze.mjs` on 3+ consented selfies of different skin tones plus a dark and a blurry one, and have a person check the results |
| 3 `/products` | 🟡 | Parser (4 formats), filter, top-up, cache, block → `blocked`, raw page → same result as the server fetch, Gemini picks only known ids. All unit-tested on **synthetic** pages | Save a real noon search page into `fixtures/noon/` and add a test. Then a real "niacinamide serum @ 50 AED" run where every URL opens |
| 4 Camera + live guide | 🟡 | Oval checks unit-tested (`shared/src/guide.ts`): centred, distance, yaw/pitch/roll, multiple faces. Auto-capture after 1 s green, manual shutter, gallery, brightness check, un-mirroring | Try on a phone. Confirm `photo.isMirrored` and EXIF orientation behave on the front camera |
| 5 Questions + helper | 🟡 | One per screen, auto-advance, back keeps answers, multi-select exclusivity, budget slider (RTL-aware), helper sheet with clue dots, tissue test and timer, skip → forced answer. Backend caps at 3 clues (tested with all "Not sure") | Phone run in both languages. **Native Arabic review of every question and option** |
| 6 Analyzing + Skin Map + results | 🟡 | Zone builder unit-tested (sides by geometry, tilt-aligned). Skia map with line-drawing reveal, zone fade-in with haptics, Map/Photo toggle, tap-zone sheet, legend, unusable-photo and red-flag screens | Visual check on a phone |
| 7 Product cards | 🟡 | Skeletons, 3 cards, "Open on noon", "See more on noon", Layer 2 WebView fallback wired to the same parser | Confirm on a phone that the hidden WebView loads noon and returns the JSON |
| 8 Polish | 🟡 | Share card (no photo), local history with reopen and compare, dark/light palettes, retry on every network error, answers kept on retry | Dark-mode and haptics pass on a phone |
| 9 APK release | ⬜ | `eas.json` preview profile → APK, `expo-updates` on the `preview` channel | Expo account, `eas init`, app icon and splash art, Arabic review, build and install on a second phone, test an `eas update` |

**Swaps from the plan (closest supported option, as allowed):**
- `@react-native-ml-kit/face-detection` → still-image contours from `react-native-vision-camera-face-detector` (same Google ML Kit). The former was last released in Sept 2025 on the legacy bridge; the latter supports VisionCamera 5 / RN 0.88 and is the plugin the live guide already needs. It's isolated in `app/src/lib/face.ts`.
- Expo SDK 58 / RN 0.88 / VisionCamera 5 / Skia 2.14 / Reanimated 4.7 (all current). `app/.npmrc` sets `legacy-peer-deps` because of a web-only `react-dom` peer.

**Known limitation:** a photo picked from the gallery may have been saved mirrored by the phone's camera app, and the app can't tell. Zones and Gemini still agree with each other (same image), but "left/right cheek" labels could be swapped for such photos. Camera captures are always un-mirrored.

## Environment

**Vercel environment variables** (Project → Settings → Environment Variables):

| Name | Value | Notes |
|---|---|---|
| `GEMINI_API_KEY` | your Gemini key (paid tier) | mark **Sensitive** |
| `INVITE_CODE` | the code friends and family type in | mark **Sensitive** |
| `GEMINI_MODEL` | `gemini-3.8-flash` | optional (this is the default); change models in one place |
| `GEMINI_TEMPERATURE` | `0.2` | optional |
| `GEMINI_THINKING` | `low` | optional: `minimal`, `low`, `medium`, `high` or `default`. How long the model thinks before answering; `/diag` compares them |
| `SCANS_PER_DAY` | `20` | optional |
| `MOCK` | `0` (or `1` for the saved samples) | optional |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | added automatically | when you connect **Upstash for Redis** from the Vercel Marketplace (listing cache, rate limits, layer counters). `UPSTASH_REDIS_REST_URL`/`_TOKEN` also work |

Without Redis the backend falls back to an in-memory store (fine locally, not in production: limits reset per instance). `/health` reports `"store": "redis"` or `"memory"`.

**App:** `EXPO_PUBLIC_API_URL` = the Vercel URL (e.g. `https://skinfix.vercel.app`). Put it in `app/.env`, and in EAS environment variables for builds.

**Local backend dev:** copy `backend/.env.example` to `backend/.env.local`, then `npm run dev`.

**Vercel limits that matter here:** request bodies max 4.5 MB (the WebView pages are capped at 4M chars total, and the photo is ~200–300 KB). Function time is set to 60 s in the build output (`maxDuration`).

## Commands

```bash
cd backend && npm i && npm run dev              # backend on :8787 (reads backend/.env.local)
cd backend && npm test                           # parser, filter, products pipeline, routes, store
cd backend && npm run build                      # same build Vercel runs → .vercel/output
cd backend && npm run check-analyze -- <selfie>  # Phase 2 consistency checks (needs GEMINI_API_KEY)
cd shared && npm i && npm test                   # safety rules, Skin Map zones, camera guide
cd app && npx expo run:android                   # dev build on a connected phone
cd app && eas build -p android --profile preview # APK
cd app && eas update --channel preview           # JS-only fix to installed apps
```

## How accuracy is protected (design decisions)

- **Same judgment in English and Arabic.** The analysis prompt and inputs are byte-identical for both languages (answers are sent as option ids, and the language isn't in the prompt). Arabic text comes from a separate translation call over the free-text fields only. Enums, scores, queries, categories and ingredients are never translated in place: Arabic display names go in `product_display`.
- **User answers override the photo, enforced in code.** Q1/Q2 answered by the user set skin type and sensitivity, and Q3 sets the main focus. `enforceProfile` in `/shared` applies this after Gemini, so a model slip can't change it.
- **Safety rules are enforced twice** (prompt, then `/shared/src/safety.ts`). That covers avoided ingredients ("fragrance-free" and fatty alcohols are not false hits), pregnancy or "not sure" (no retinoids, no peels, no AHA >10% or BHA >2%), prescription medicine (gentle basics only, no actives) and red flags (no actives for a flagged main focus). Patch tests are forced for actives.
- **Evidence before scores.** Gemini first writes what it can see (lighting, the person's base tone, and the plain facts per zone), then scores only from that, using fixed definitions for every level of every finding (`backend/src/prompts.ts`). The observations never reach users. `check-analyze` prints them (`/analyze?debug=1`) so you can see why each score was given.
- **Gemini output is validated** with zod plus semantic checks. On failure it retries once with the problem fed back, then returns a clean error.
- **Listings are never written by Gemini.** Gemini sees text-only candidates and returns ids. Ids not in the list are rejected, and the card is built from the stored listing. Gemini may return fewer than 3 if fewer truly fit: a wrong product is worse than a short list.
- **The cache key** includes avoid terms, product type, ingredients and language as well as query and budget, so one user's filter can't leak into another user's results.
- **Left/right** is always the person's own side. The still is un-mirrored, Gemini is told the person's left is on the image right, and the zone builder decides sides by geometry, not by ML Kit's contour names.

## Privacy

There is no request logging middleware. Errors log a message only, never a body. Photos are forwarded to Gemini and dropped. Invite code plus device id are required on every endpoint except `/health`, with a per-device daily scan limit in Redis (atomic counter). Vercel's runtime logs only hold what the code prints: no bodies.
