// Question and option ids. These ids are the only values the backend ever sees:
// both languages map their visible text to the same ids, so the analysis never
// depends on the app language.

export const SKIN_FEEL = ['tight_flaky', 'comfortable', 'shiny_tzone', 'shiny_all'] as const;
export const REACTIVITY = ['often', 'sometimes', 'rarely'] as const;
export const MAIN_BOTHER = [
  'breakouts',
  'dark_spots',
  'oiliness',
  'dryness',
  'redness',
  'dullness',
] as const;
export const AVOID = ['fragrance', 'alcohol', 'nothing', 'unsure', 'other'] as const;
export const CONDITIONS = ['pregnant_breastfeeding', 'prescription', 'none', 'unsure'] as const;

export type SkinFeel = (typeof SKIN_FEEL)[number];
export type Reactivity = (typeof REACTIVITY)[number];
export type MainBother = (typeof MAIN_BOTHER)[number];
export type AvoidOption = (typeof AVOID)[number];
export type ConditionOption = (typeof CONDITIONS)[number];

/** Questions that open the skin helper on "I'm not sure". Safety questions never do. */
export const HELPER_QUESTIONS = ['skin_feel', 'reactivity'] as const;
export type HelperQuestionId = (typeof HELPER_QUESTIONS)[number];

export const HELPER_OPTIONS: Record<HelperQuestionId, readonly string[]> = {
  skin_feel: SKIN_FEEL,
  reactivity: REACTIVITY,
};

export const BUDGET = { min: 10, max: 150, step: 5, default: 50 } as const;

/** Q1 answer → skin type. Used to enforce the "user answers override the photo" rule. */
export const SKIN_FEEL_TO_TYPE = {
  tight_flaky: 'dry',
  comfortable: 'normal',
  shiny_tzone: 'combination',
  shiny_all: 'oily',
} as const satisfies Record<SkinFeel, string>;

/** Q2 answer → sensitivity. */
export const REACTIVITY_TO_SENSITIVITY = {
  often: 'high',
  sometimes: 'medium',
  rarely: 'low',
} as const satisfies Record<Reactivity, string>;
