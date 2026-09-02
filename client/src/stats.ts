// Player stats persistence — track game history, wins, and performance.
import { getStored, setStored } from './storage';

export interface GameStanding {
  name: string;
  color: string;
  vp: number;
}

export interface GameRecord {
  id: string;
  date: string;          // ISO
  players: number;
  mode: 'ai' | 'online';
  won: boolean;
  wonAs: string;         // color
  victoryPoints: number; // your VP (legacy records may store winner VP)
  playerColor: string;
  opponents: number;
  myVictoryPoints?: number;
  scores?: GameStanding[];
  longestRoad?: string;
  largestArmy?: string;
  tip?: string;
}

export interface ProfileStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;       // 0-100
  currentStreak: number;
  longestStreak: number;
  bestVictoryPoints: number;
  totalVictoryPoints: number;
  avgPointsPerWin: number;
  lastPlayed: string | null;
}

const STATS_KEY = 'catan_stats';
const HISTORY_KEY = 'catan_history';

function defaultStats(): ProfileStats {
  return {
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    currentStreak: 0,
    longestStreak: 0,
    bestVictoryPoints: 0,
    totalVictoryPoints: 0,
    avgPointsPerWin: 0,
    lastPlayed: null,
  };
}

export function getStats(): ProfileStats {
  const raw = getStored(STATS_KEY);
  if (!raw) return defaultStats();
  try {
    return { ...defaultStats(), ...JSON.parse(raw) };
  } catch {
    return defaultStats();
  }
}

export function getHistory(): GameRecord[] {
  const raw = getStored(HISTORY_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function recordGame(rec: Omit<GameRecord, 'id' | 'date'>): ProfileStats {
  const stats = getStats();
  const history = getHistory();

  const record: GameRecord = {
    ...rec,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: new Date().toISOString(),
  };

  history.push(record);
  // Keep last 50 games
  const trimmed = history.slice(-50);
  setStored(HISTORY_KEY, JSON.stringify(trimmed));

  // Update stats
  stats.gamesPlayed += 1;
  if (rec.won) {
    stats.wins += 1;
    stats.currentStreak += 1;
    if (stats.currentStreak > stats.longestStreak) stats.longestStreak = stats.currentStreak;
    stats.totalVictoryPoints += rec.victoryPoints;
    if (rec.victoryPoints > stats.bestVictoryPoints) stats.bestVictoryPoints = rec.victoryPoints;
    stats.avgPointsPerWin = stats.wins > 0
      ? Math.round((stats.totalVictoryPoints / stats.wins) * 10) / 10
      : 0;
  } else {
    stats.losses += 1;
    stats.currentStreak = 0;
  }
  stats.winRate = stats.gamesPlayed > 0
    ? Math.round((stats.wins / stats.gamesPlayed) * 1000) / 10
    : 0;
  stats.lastPlayed = new Date().toISOString();

  setStored(STATS_KEY, JSON.stringify(stats));
  return stats;
}

export function clearHistory(): void {
  setStored(STATS_KEY, JSON.stringify(defaultStats()));
  setStored(HISTORY_KEY, JSON.stringify([]));
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
