// LLM-driven AI opponents with distinct personalities.
//
// Each AI opponent reasons about the board through its own personality profile
// — like playing against a real person, not a rule bot. The personality prompt
// is built here, then sent to the game server's /api/llm/move endpoint, which
// forwards it to Ollama Cloud with the server-held API key. That keeps the key
// OUT of the browser bundle (it only lives on the Render server).
//
// Works from the phone AND the Mac. If the server has no key, is slow, errors,
// or the model returns a bad id, we ALWAYS fall back to the rule AI so a game
// never stalls.

import type { GameState, Player } from './types';
import {
  settlementCandidates,
  cityCandidates,
  roadCandidates,
  canAfford,
  BUILDING_COSTS,
  getStealTargets,
} from './rules';
import { PERSONALITIES } from './personality';
import { getServerUrl } from '../serverUrl';

const TIMEOUT_MS = 20000;

interface LegalMove {
  id: string;
  label: string;
  kind: string;
  key?: string;
}

interface LlmResult {
  ok: boolean;
  action: { action: string; data?: any } | null;
}

/** Build the list of legal moves the LLM can choose from, given the phase. */
function legalMoves(state: GameState, player: Player): LegalMove[] {
  const color = player.color;
  const moves: LegalMove[] = [];
  const add = (m: LegalMove) => moves.push(m);

  if (state.phase === 'roll') {
    add({ id: 'roll_dice', label: 'Roll the dice', kind: 'roll_dice' });
    return moves;
  }
  if (state.phase === 'trade') {
    add({ id: 'skip_trade', label: 'Skip trading this turn', kind: 'skip_trade' });
    return moves;
  }

  // Build phase (and setup handled separately below)
  const setts = settlementCandidates(state, color);
  if (player.settlementsRemaining > 0) {
    setts.forEach((s, i) => {
      const afford = canAfford(player, BUILDING_COSTS.settlement);
      add({ id: `settle_${i}`, label: `Place settlement at ${s.key}${afford ? '' : ' (can\'t afford)'}`, kind: 'place_settlement', key: s.key });
    });
  }
  const cities = cityCandidates(state, color);
  if (player.citiesRemaining > 0) {
    cities.forEach((c, i) => {
      const afford = canAfford(player, BUILDING_COSTS.city);
      add({ id: `city_${i}`, label: `Upgrade to city at ${c.key}${afford ? '' : ' (can\'t)'}`, kind: 'place_city', key: c.key });
    });
  }
  const roads = roadCandidates(state, color);
  if (player.roadsRemaining > 0) {
    roads.forEach((e, i) => {
      const afford = canAfford(player, BUILDING_COSTS.road);
      add({ id: `road_${i}`, label: `Build road ${e.key}${afford ? '' : ' (can\'t)'}`, kind: 'place_road', key: e.key });
    });
  }
  if (canAfford(player, BUILDING_COSTS.devCard) && (state.devDeck || []).length > 0) {
    add({ id: 'dev_card', label: 'Buy a development card', kind: 'buy_dev_card' });
  }
  add({ id: 'end_turn', label: 'End my turn', kind: 'end_turn' });
  return moves;
}

/** Build the prompt that lets a personality show through. */
function buildPrompt(state: GameState, player: Player, moves: LegalMove[]): string {
  const persona = PERSONALITIES[player.personalityId || ''];

  // Behavioral directive per archetype — this is what makes a small model
  // actually deviate instead of defaulting to the safe move.
  const directive = !persona
    ? 'Play a solid, balanced game.'
    : persona.weights.expansion >= 0.8
      ? 'You LOVE expanding: prefer settlements and roads that grow your reach, even over upgrading to cities. Settle wide and build roads.'
      : persona.weights.devCards >= 0.8
        ? 'You LOVE development cards: buy them aggressively and favor card-play over ordinary builds, even when it feels risky.'
        : persona.weights.aggression >= 0.8
          ? 'You are aggressive: target and block whoever is winning, steal and attack; do not be passive.'
          : persona.weights.trading >= 0.8
            ? 'You are a trader: look for deals and lean into moves that set up trades and ports.'
            : 'Play a solid, balanced game.';

  const identity = persona ? `${persona.name} — ${persona.tagline}` : 'A balanced player.';

  // Inventory
  const res = (['brick', 'lumber', 'wool', 'grain', 'ore'] as const)
    .map(r => `${r}:${player.resources[r] || 0}`)
    .join(' ');
  const vp = player.victoryPoints ?? 0;

  // Other players
  const others = state.players
    .filter(p => p.color !== player.color)
    .map(p => `${p.name}(${p.color}) ${p.victoryPoints ?? 0}VP`)
    .join(', ');

  const moveLines = moves.map(m => `${m.id}: ${m.label}`).join('\n');

  return [
    `You are ${identity}.`,
    `Your resources: ${res}. Victory points: ${vp}.`,
    `Other players: ${others || 'none'}.`,
    `Current phase: ${state.phase}.`,
    ``,
    `Legal moves:`,
    moveLines,
    ``,
    `Your style: ${directive}`,
    ``,
    `Choose the move that fits your personality best RIGHT NOW. `,
    `Reply with ONLY the move id (e.g. settle_2, road_0, dev_card, end_turn, roll_dice). No extra words.`,
  ].join('\n');
}

/**
 * Ask the local Ollama model to choose a move for this AI, given its
 * personality. Resolves `{ok:true, action}` on success; `{ok:false}` on any
 * failure so the caller falls back to the rule AI.
 */
export async function llmChooseAction(
  state: GameState,
  player: Player,
): Promise<LlmResult> {
  try {
    const moves = legalMoves(state, player);
    if (moves.length === 0) return { ok: false, action: null };

    const prompt = buildPrompt(state, player, moves);
    const url = `${getServerUrl()}/api/llm/move`;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({ prompt }),
    });
    clearTimeout(to);
    if (!r.ok) return { ok: false, action: null };
    const data = await r.json();
    if (!data?.ok) return { ok: false, action: null };
    const text = (data.text || '').trim().toLowerCase();

    // Match the chosen id (allow a trailing period or whitespace).
    const id = text.split(/[\s.]+/)[0];
    const chosen = moves.find(m => m.id === id);
    if (!chosen) return { ok: false, action: null };

    return { ok: true, action: { action: chosen.kind, data: chosen.key ? { key: chosen.key } : undefined } };
  } catch {
    // Timeout, network, or parse error → fall back to rule AI.
    return { ok: false, action: null };
  }
}

// Re-export the rule helpers the LLM path relies on, so the build tree is clean.
export const llmHelpers = { needStealTargets: getStealTargets };
