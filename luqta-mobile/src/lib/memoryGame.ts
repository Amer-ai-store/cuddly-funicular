// "العب واربح" memory matching game — pure state machine (6 pairs of product icons).
export type Card = { id: number; face: string; matched: boolean; open: boolean };
export type GameState = { cards: Card[]; opened: number[]; moves: number; matches: number; startedAt: number | null; finishedAt: number | null; locked: boolean };
export const FACES = ["🛒", "🎧", "🕯️", "👟", "⌚", "🧴"];

/** Deterministic shuffle from a seed so tests can reproduce a deck. */
export function newGame(seed = Date.now()): GameState {
  let s = seed % 2147483647; if (s <= 0) s += 2147483646;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const deck = [...FACES, ...FACES].map((face, i) => ({ face, k: rnd(), i }));
  deck.sort((a, b) => a.k - b.k);
  return { cards: deck.map((d, id) => ({ id, face: d.face, matched: false, open: false })), opened: [], moves: 0, matches: 0, startedAt: null, finishedAt: null, locked: false };
}

export function flip(state: GameState, index: number, now = Date.now()): GameState {
  const card = state.cards[index];
  if (!card || state.locked || card.open || card.matched || state.finishedAt) return state;
  const cards = state.cards.map((c, i) => (i === index ? { ...c, open: true } : c));
  const opened = [...state.opened, index];
  const startedAt = state.startedAt ?? now;
  if (opened.length < 2) return { ...state, cards, opened, startedAt };
  const [a, b] = opened, moves = state.moves + 1;
  if (cards[a].face === cards[b].face) {
    const done = cards.map((c, i) => (i === a || i === b ? { ...c, matched: true } : c));
    const matches = state.matches + 1;
    return { ...state, cards: done, opened: [], moves, matches, startedAt, finishedAt: matches === FACES.length ? now : null };
  }
  return { ...state, cards, opened, moves, startedAt, locked: true };
}

/** Close an unmatched pair after the reveal delay. */
export function settle(state: GameState): GameState {
  if (!state.locked) return state;
  return { ...state, cards: state.cards.map((c, i) => (state.opened.includes(i) && !c.matched ? { ...c, open: false } : c)), opened: [], locked: false };
}

export const elapsedSeconds = (s: GameState) => (s.startedAt && s.finishedAt ? Math.max(1, Math.round((s.finishedAt - s.startedAt) / 1000)) : 0);
