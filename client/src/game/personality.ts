// Personality engine for Catan AI — canonical (sync to server + shared).
// Each AI is a named character with a trait profile. Traits bias the existing
// decision points in aiTurn(). A lightweight learning layer nudges each AI's
// weights toward the winner's profile after every local game, so they "grow"
// from their games.

export type Trait =
  | 'aggression' // robber targeting + knight play
  | 'expansion'  // roads/settlements over cities
  | 'devCards'   // buy/play development cards
  | 'trading'    // accept/propose trades generously
  | 'risk';      // greedy setup, VP chase, city-over-settlement

export type TraitWeights = Record<Trait, number>; // 0..1, default 0.5

export interface Personality {
  id: string;
  name: string;
  emoji: string;
  tagline: string;
  weights: TraitWeights;
}

// Fixed roster, one per color slot. In local games red is the human, so the
// Builder/Warlord/Merchant are the three you face; Gambler shows in 4-AI games.
export const PERSONALITIES: Record<string, Personality> = {
  builder: {
    id: 'builder',
    name: 'The Builder',
    emoji: '🏗️',
    tagline: 'Roads first. Settle wide, grow fast.',
    weights: { aggression: 0.3, expansion: 0.85, devCards: 0.2, trading: 0.4, risk: 0.3 },
  },
  warlord: {
    id: 'warlord',
    name: 'The Warlord',
    emoji: '⚔️',
    tagline: 'Block the leader. Steal what you need.',
    weights: { aggression: 0.9, expansion: 0.4, devCards: 0.6, trading: 0.2, risk: 0.5 },
  },
  merchant: {
    id: 'merchant',
    name: 'The Merchant',
    emoji: '⚖️',
    tagline: 'Trade everything. Hunt the ports.',
    weights: { aggression: 0.3, expansion: 0.5, devCards: 0.3, trading: 0.95, risk: 0.4 },
  },
  gambler: {
    id: 'gambler',
    name: 'The Gambler',
    emoji: '🎲',
    tagline: 'Buy dev cards. Swing for the win.',
    weights: { aggression: 0.5, expansion: 0.3, devCards: 0.95, trading: 0.4, risk: 0.9 },
  },
};

// Color → personality assignment (stable so the same seat is the same character).
export const COLOR_PERSONALITY: Record<string, string> = {
  red: 'gambler',
  blue: 'builder',
  white: 'warlord',
  orange: 'merchant',
};

export const DEFAULT_WEIGHTS: TraitWeights = {
  aggression: 0.5, expansion: 0.5, devCards: 0.5, trading: 0.5, risk: 0.5,
};

// Merge a personality's base weights with any learned deltas (clamped 0..1).
export function getTraits(
  personalityId?: string,
  learned?: Partial<TraitWeights>,
): TraitWeights {
  const base = (personalityId && PERSONALITIES[personalityId]?.weights) || DEFAULT_WEIGHTS;
  const out: TraitWeights = { ...base };
  (Object.keys(DEFAULT_WEIGHTS) as Trait[]).forEach(t => {
    if (learned && typeof learned[t] === 'number') {
      out[t] = Math.max(0, Math.min(1, base[t] + (learned[t] as number)));
    }
  });
  return out;
}

// ── Learning ────────────────────────────────────────────────────────────────
// Persisted per personality in localStorage (local games only). After a game we
// nudge each AI's learned deltas toward the winner's profile so losers drift
// toward what wins and winners keep their style.

export interface PersonalityStats {
  games: number;
  wins: number;
  avgVp: number;
  learned: Partial<TraitWeights>;
}

export const STORE_KEY = 'catan_ai_learning_v1';

export function loadStats(): Record<string, PersonalityStats> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export function saveStats(all: Record<string, PersonalityStats>) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    /* storage full / unavailable — learning is best-effort */
  }
}

// Record one finished game. `results` maps personalityId → { vp, won }.
// Nudge each AI's learned weights toward the winner's base profile.
export function learnFromGame(
  results: Record<string, { vp: number; won: boolean }>,
): Record<string, PersonalityStats> {
  const all = loadStats();
  const winnerId = Object.keys(results).find(id => results[id]?.won);
  const winnerWeights = winnerId ? PERSONALITIES[winnerId]?.weights : null;

  Object.keys(results).forEach(id => {
    const r = results[id];
    if (!r) return;
    const st = all[id] || { games: 0, wins: 0, avgVp: 0, learned: {} };
    st.games += 1;
    if (r.won) st.wins += 1;
    st.avgVp = st.games === 1 ? r.vp : (st.avgVp * (st.games - 1) + r.vp) / st.games;

    // Nudge toward the winner's profile (only if this AI didn't win).
    if (winnerWeights && !r.won) {
      const learn = st.learned || {};
      (Object.keys(DEFAULT_WEIGHTS) as Trait[]).forEach(t => {
        const base = PERSONALITIES[id]?.weights?.[t] ?? 0.5;
        const delta = (winnerWeights[t] - base) * 0.12; // small step per game
        learn[t] = Math.max(-0.5, Math.min(0.5, (learn[t] || 0) + delta));
      });
      st.learned = learn;
    }
    all[id] = st;
  });

  saveStats(all);
  return all;
}
