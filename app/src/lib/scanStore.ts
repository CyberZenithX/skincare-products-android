// One in-memory scan session. The photo lives here as base64 only: the camera
// and resize files are deleted right after preparation. The session is written
// to disk only for a language-switch reload (draft), and that copy is deleted
// once the scan finishes.

import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BUDGET,
  type Answers,
  type AnalyzeResponse,
  type AvoidOption,
  type ConditionOption,
  type MainBother,
  type PickedListing,
  type Reactivity,
  type SkinFeel,
  type SkinMapGeometry,
  type Confidence,
  type AnswerSource,
} from '@skinfix/shared';

export interface HelperAnswer<T extends string> {
  value: T | null;
  source: AnswerSource;
  confidence: Confidence;
  also_possible: T | null;
}

export interface DraftAnswers {
  skin_feel?: HelperAnswer<SkinFeel>;
  reactivity?: HelperAnswer<Reactivity>;
  /** undefined = not answered yet; null = "Not sure, you tell me". */
  main_bother?: MainBother | null;
  avoid: AvoidOption[];
  avoid_other: string;
  conditions: ConditionOption[];
  budget_aed: number;
}

export interface ScanPhoto {
  base64: string;
  width: number;
  height: number;
  source: 'camera' | 'gallery';
}

export type ListingState =
  | { state: 'loading' }
  | { state: 'ok'; listings: PickedListing[]; search_url: string }
  | { state: 'link'; search_url: string }
  | { state: 'error'; search_url: string };

export interface ScanState {
  photo: ScanPhoto | null;
  geometry: SkinMapGeometry | null;
  answers: DraftAnswers;
  step: number;
  result: AnalyzeResponse | null;
  listings: ListingState[];
  /** Set after a "Re-check": the tissue-test answer replaces Q1. */
  recheck: boolean;
}

const initial = (): ScanState => ({
  photo: null,
  geometry: null,
  answers: { avoid: [], avoid_other: '', conditions: [], budget_aed: BUDGET.default },
  step: 0,
  result: null,
  listings: [],
  recheck: false,
});

let state: ScanState = initial();
const listeners = new Set<() => void>();

export const scanStore = {
  get: () => state,
  set(patch: Partial<ScanState> | ((s: ScanState) => Partial<ScanState>)) {
    const p = typeof patch === 'function' ? patch(state) : patch;
    state = { ...state, ...p };
    listeners.forEach((l) => l());
  },
  setAnswers(patch: Partial<DraftAnswers>) {
    scanStore.set((s) => ({ answers: { ...s.answers, ...patch } }));
  },
  reset() {
    state = initial();
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useScan<T>(select: (s: ScanState) => T): T {
  return useSyncExternalStore(scanStore.subscribe, () => select(state));
}

/** Validate the draft into the request shape. Returns null if anything is missing. */
export function toAnswers(a: DraftAnswers): Answers | null {
  if (!a.skin_feel || !a.reactivity || a.main_bother === undefined) return null;
  if (!a.avoid.length || !a.conditions.length) return null;
  return {
    skin_feel: a.skin_feel,
    reactivity: a.reactivity,
    main_bother: a.main_bother,
    avoid: a.avoid,
    avoid_other: a.avoid.includes('other') ? a.avoid_other.trim() : '',
    conditions: a.conditions,
    budget_aed: a.budget_aed,
  };
}

// ---------------------------------------------------------------- language-switch draft

const DRAFT_KEY = 'draft:v1';

export interface Draft {
  route: string;
  photo: ScanPhoto | null;
  geometry: SkinMapGeometry | null;
  answers: DraftAnswers;
  step: number;
}

export async function saveDraft(route: string) {
  const s = state;
  if (s.result) return; // scan already finished: nothing to restore
  if (!s.photo && s.step === 0) return; // nothing in progress
  const d: Draft = { route, photo: s.photo, geometry: s.geometry, answers: s.answers, step: s.step };
  await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(d));
}

export async function restoreDraft(): Promise<Draft | null> {
  try {
    const raw = await AsyncStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    scanStore.set({ photo: d.photo, geometry: d.geometry, answers: d.answers, step: d.step });
    return d;
  } catch {
    return null;
  }
}

export async function clearDraft() {
  await AsyncStorage.removeItem(DRAFT_KEY).catch(() => undefined);
}
