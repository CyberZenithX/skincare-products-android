import { HELPER_OPTIONS, z, ClarifyTest, type ClarifyRequest, type ClarifyResponse } from '@skinfix/shared';
import type { Env } from './env';
import { generateJson, imagePart } from './gemini';
import { clarifySystem } from './prompts';

export const MAX_CLUES = 3;

/** Per-call schema: the answer value is narrowed to this question's option ids. */
function clarifySchema(req: ClarifyRequest, mustAnswer: boolean, allowTest: boolean) {
  const opts = HELPER_OPTIONS[req.question_id] as unknown as [string, ...string[]];
  const statuses = mustAnswer ? (['answered'] as const) : allowTest ? (['asking', 'suggest_test', 'answered'] as const) : (['asking', 'answered'] as const);
  return z.object({
    status: z.enum(statuses as unknown as [string, ...string[]]),
    clue_number: z.number().int(),
    message: z.string().min(1).max(240),
    options: z.array(z.string().min(1).max(80)).max(4),
    test: ClarifyTest.nullable(),
    answer: z
      .object({
        value: z.enum(opts),
        confidence: z.enum(['low', 'medium', 'high']),
        also_possible: z.enum(opts).nullable(),
        why: z.string().max(240),
        what_would_change_it: z.string().max(240),
      })
      .nullable(),
  });
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export async function clarify(env: Env, req: ClarifyRequest): Promise<ClarifyResponse> {
  const clues = req.turns.filter((t) => t.kind === 'clue').length;
  const testTurn = req.turns.find((t) => t.kind === 'test');
  const testSkipped = !!testTurn && /^skipped$/i.test(testTurn.answered.trim());
  // The Worker owns the cap: after 3 clues (the 4th call), or a skipped test, answer now.
  const mustAnswer = req.force_answer || clues >= MAX_CLUES || testSkipped;
  const allowTest = req.question_id === 'skin_feel' && !testTurn;
  const clueNumber = Math.min(clues + 1, MAX_CLUES + 1);
  const schema = clarifySchema(req, mustAnswer, allowTest);
  const asked = new Set(req.turns.map((t) => norm(t.asked)));

  const transcript = req.turns.length
    ? req.turns.map((t, i) => `${i + 1}. [${t.kind}] asked: ${t.asked}\n   answered: ${t.answered}`).join('\n')
    : '(no questions asked yet)';

  const out = await generateJson(env, {
    system: clarifySystem(req.question_id, req.language, mustAnswer, clueNumber),
    parts: [imagePart(req.image_base64), { text: `CONVERSATION SO FAR\n${transcript}` }],
    schema,
    check: (r) => {
      if (r.status === 'answered' && !r.answer) return 'status "answered" needs answer';
      if (r.status === 'asking' && (r.options.length < 2 || r.answer)) return 'status "asking" needs 2-4 options and answer=null';
      if (r.status === 'suggest_test' && !r.test) return 'status "suggest_test" needs test';
      if (r.status === 'asking' && asked.has(norm(r.message))) return 'that question was already asked; ask a different one';
      if (r.options.some((o) => /not sure|غير متأكد|لست متأكد/i.test(o))) return 'do not include "Not sure" in options';
      if (r.answer && testSkipped && r.answer.confidence === 'high') return 'the test was skipped, so confidence cannot be high';
      if (r.answer && r.answer.also_possible === r.answer.value) return 'also_possible must differ from value';
      return null;
    },
    timeoutMs: 15_000,
  });

  return {
    status: out.status as ClarifyResponse['status'],
    clue_number: clueNumber,
    message: out.message,
    options: out.status === 'asking' ? out.options : [],
    test: out.status === 'suggest_test' ? out.test : null,
    answer: out.status === 'answered' ? out.answer : null,
  };
}
