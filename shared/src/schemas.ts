import { z } from 'zod';
import {
  AVOID,
  CONDITIONS,
  HELPER_QUESTIONS,
  MAIN_BOTHER,
  REACTIVITY,
  SKIN_FEEL,
  BUDGET,
} from './questions';

export { z };

// ---------------------------------------------------------------- basics

export const Language = z.enum(['en', 'ar']);
export type Language = z.infer<typeof Language>;

export const Confidence = z.enum(['low', 'medium', 'high']);
export type Confidence = z.infer<typeof Confidence>;

export const SkinType = z.enum(['oily', 'dry', 'combination', 'normal']);
export type SkinType = z.infer<typeof SkinType>;

export const Sensitivity = z.enum(['low', 'medium', 'high']);
export type Sensitivity = z.infer<typeof Sensitivity>;

export const MainConcern = z.enum([
  'breakouts',
  'dark_spots',
  'oiliness',
  'dryness',
  'redness',
  'dullness',
  'texture',
]);
export type MainConcern = z.infer<typeof MainConcern>;

export const ZONE_IDS = ['forehead', 'nose', 'left_cheek', 'right_cheek', 'chin'] as const;
export const ZoneId = z.enum(ZONE_IDS);
export type ZoneId = z.infer<typeof ZoneId>;

export const FINDINGS = ['oil', 'redness', 'breakouts', 'dark_spots', 'dryness', 'texture'] as const;
export const Finding = z.enum(FINDINGS);
export type Finding = z.infer<typeof Finding>;

export const PhotoIssue = z.enum([
  'none',
  'too_dark',
  'blurry',
  'makeup_or_filter',
  'face_not_clear',
  'other',
]);
export type PhotoIssue = z.infer<typeof PhotoIssue>;

export const RedFlagType = z.enum([
  'possible_cystic_acne',
  'unusual_mole',
  'rash_or_infection',
  'severe_irritation',
  'other',
]);
export type RedFlagType = z.infer<typeof RedFlagType>;

// ---------------------------------------------------------------- answers

export const AnswerSource = z.enum(['user', 'helper', 'unsure']);
export type AnswerSource = z.infer<typeof AnswerSource>;

/** Answer to a question the helper can work out (Q1, Q2). */
const helperAnswer = <T extends readonly [string, ...string[]]>(options: T) =>
  z
    .object({
      value: z.enum(options).nullable(), // null only when source is "unsure"
      source: AnswerSource,
      confidence: Confidence,
      also_possible: z.enum(options).nullable(),
    })
    .refine((a) => (a.source === 'unsure') === (a.value === null), {
      message: 'value must be null exactly when source is "unsure"',
    });

export const Answers = z.object({
  skin_feel: helperAnswer(SKIN_FEEL),
  reactivity: helperAnswer(REACTIVITY),
  /** null = "Not sure, you tell me": the photo picks the focus. */
  main_bother: z.enum(MAIN_BOTHER).nullable(),
  avoid: z.array(z.enum(AVOID)).min(1),
  avoid_other: z.string().trim().max(80).default(''),
  conditions: z.array(z.enum(CONDITIONS)).min(1),
  budget_aed: z.number().int().min(BUDGET.min).max(BUDGET.max).multipleOf(BUDGET.step),
});
export type Answers = z.infer<typeof Answers>;

// ---------------------------------------------------------------- /analyze

/** ~1024px JPEG, base64 without the data: prefix. 3 MB of base64 is plenty. */
export const ImageBase64 = z
  .string()
  .min(1000)
  .max(3_000_000)
  .regex(/^[A-Za-z0-9+/]+=*$/, 'image must be plain base64');

export const AnalyzeRequest = z.object({
  image_base64: ImageBase64,
  answers: Answers,
  language: Language,
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequest>;

const score = z.number().int().min(0).max(3);

export const ZoneScores = z.object({
  oil: score,
  redness: score,
  breakouts: score,
  dark_spots: score,
  dryness: score,
  texture: score,
  note: z.string().max(240),
});
export type ZoneScores = z.infer<typeof ZoneScores>;

export const ProductRec = z.object({
  category: z.string().min(2).max(80),
  why: z.string().max(300),
  key_ingredients: z.array(z.string().min(2).max(60)).min(1).max(5),
  avoid_ingredients: z.array(z.string().min(2).max(60)).max(8),
  how_to_use: z.string().max(240),
  patch_test: z.boolean(),
  noon_query: z.string().min(3).max(60),
  backup_query: z.string().min(3).max(60),
});
export type ProductRec = z.infer<typeof ProductRec>;

export const RedFlag = z.object({ type: RedFlagType, note: z.string().max(300) });
export type RedFlag = z.infer<typeof RedFlag>;

/** Exactly what Gemini must return. Also the core of what the app receives. */
export const SkinProfile = z.object({
  photo_quality: z.object({
    usable: z.boolean(),
    issue: PhotoIssue,
    tip: z.string().max(200),
  }),
  skin_type: SkinType,
  sensitivity: Sensitivity,
  confidence: Confidence,
  also_possible: z.array(SkinType).max(2),
  how_to_confirm: z.string().max(200),
  main_concern: MainConcern,
  summary: z.string().max(400),
  zones: z.object({
    forehead: ZoneScores,
    nose: ZoneScores,
    left_cheek: ZoneScores,
    right_cheek: ZoneScores,
    chin: ZoneScores,
  }),
  red_flags: z.array(RedFlag).max(5),
  products: z.array(ProductRec).max(2),
});
export type SkinProfile = z.infer<typeof SkinProfile>;

export const SafetyAdjustment = z.object({
  product_index: z.number().int(),
  action: z.enum(['dropped', 'avoid_added']),
  reason: z.string(),
});
export type SafetyAdjustment = z.infer<typeof SafetyAdjustment>;

export const AnalyzeResponse = z.object({
  ok: z.literal(true),
  profile: SkinProfile,
  /** Language the free-text fields are actually in (falls back to en if translation failed). */
  text_language: Language,
  /** What the backend changed to enforce answers and safety rules. */
  adjustments: z.array(SafetyAdjustment),
  /** Ingredients that every product lookup must keep out of titles. */
  avoid_terms: z.array(z.string()),
  /**
   * Display text for each product (same order as profile.products), in text_language.
   * The English originals in profile.products stay the source of truth for safety and search.
   */
  product_display: z.array(
    z.object({
      category: z.string(),
      key_ingredients: z.array(z.string()),
      avoid_ingredients: z.array(z.string()),
    }),
  ),
});
export type AnalyzeResponse = z.infer<typeof AnalyzeResponse>;

// ---------------------------------------------------------------- /clarify

export const ClarifyTurn = z.object({
  kind: z.enum(['clue', 'test']).default('clue'),
  asked: z.string().max(300),
  /** The option text the user tapped, "Not sure", or the test result / "skipped". */
  answered: z.string().max(200),
});
export type ClarifyTurn = z.infer<typeof ClarifyTurn>;

export const ClarifyRequest = z.object({
  question_id: z.enum(HELPER_QUESTIONS),
  image_base64: ImageBase64,
  turns: z.array(ClarifyTurn).max(6),
  language: Language,
  /** Set when the user skips a suggested test: answer right away. */
  force_answer: z.boolean().default(false),
});
export type ClarifyRequest = z.infer<typeof ClarifyRequest>;

export const ClarifyTest = z.object({
  name: z.string().max(60),
  steps: z.array(z.string().max(200)).min(1).max(6),
  wait_minutes: z.number().int().min(0).max(180),
});

export const ClarifyAnswer = z.object({
  value: z.string(), // narrowed to the question's option ids on the backend
  confidence: Confidence,
  also_possible: z.string().nullable(),
  why: z.string().max(240),
  what_would_change_it: z.string().max(240),
});

export const ClarifyResponse = z.object({
  status: z.enum(['asking', 'suggest_test', 'answered']),
  clue_number: z.number().int().min(1).max(4),
  message: z.string().max(240),
  options: z.array(z.string().max(80)).max(4),
  test: ClarifyTest.nullable(),
  answer: ClarifyAnswer.nullable(),
});
export type ClarifyResponse = z.infer<typeof ClarifyResponse>;

// ---------------------------------------------------------------- /products

export const RawPage = z.object({
  /** Which query this page is for (the product's noon_query or backup_query). */
  query: z.string().max(60),
  /** The embedded JSON (or whole HTML) the phone's WebView read from noon's search page. */
  page: z.string().max(4_000_000),
});

export const ProductsRequest = z.object({
  product: ProductRec,
  budget_aed: z.number().int().min(BUDGET.min).max(BUDGET.max),
  avoid_terms: z.array(z.string().max(60)).max(12),
  /** Language for the one-line pick reasons. Listings themselves never depend on it. */
  language: Language,
  /** Layer 2: search pages the phone fetched through its hidden WebView. */
  raw_pages: z.array(RawPage).min(1).max(2).optional(),
  /** Layer 3: the app tells us it fell back to a plain search link (for the counter). */
  link_fallback: z.boolean().optional(),
});
export type ProductsRequest = z.infer<typeof ProductsRequest>;

export const Listing = z.object({
  id: z.string(),
  title: z.string(),
  brand: z.string().nullable(),
  url: z.string().url(),
  image: z.string().url(),
  price_aed: z.number(),
  original_price_aed: z.number().nullable(),
  rating: z.number().nullable(),
  rating_count: z.number().int().nullable(),
  in_stock: z.boolean(),
});
export type Listing = z.infer<typeof Listing>;

export const PickedListing = Listing.extend({ reason: z.string().nullable() });
export type PickedListing = z.infer<typeof PickedListing>;

export const ProductsResponse = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    layer: z.enum(['worker', 'webview']),
    cached: z.boolean(),
    listings: z.array(PickedListing).max(3),
    /** Always present so the app can show "See more on noon". */
    search_url: z.string().url(),
  }),
  z.object({
    status: z.literal('blocked'),
    /** The queries the phone should load in its WebView (main first, then backup). */
    queries: z.array(z.string()).min(1).max(2),
    search_url: z.string().url(),
  }),
  z.object({ status: z.literal('link'), search_url: z.string().url() }),
]);
export type ProductsResponse = z.infer<typeof ProductsResponse>;

// ---------------------------------------------------------------- errors

export const ErrorCode = z.enum([
  'bad_request',
  'unauthorized',
  'rate_limited',
  'ai_failed',
  'upstream_failed',
  'internal',
]);
export const ErrorResponse = z.object({
  ok: z.literal(false),
  error: ErrorCode,
  message: z.string(),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const HEADERS = { invite: 'x-invite-code', device: 'x-device-id' } as const;
