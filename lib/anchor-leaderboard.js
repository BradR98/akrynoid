/**
 * leaderboard.js - classic arcade Top-10 table with 3-character names, persisted to localStorage.
 * Pure functions + an injectable storage ({getItem,setItem}); storage failures (private mode, quota) are swallowed.
 */
export const LB_SIZE = 10;
export const NAME_LEN = 3;

/** Uppercase A-Z / 0-9 only, trimmed to 3 and padded with '-' (so "BR" -> "BR-", "" -> "---"). */
export function cleanName(s) {
  const t = String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, NAME_LEN);
  return t + '-'.repeat(NAME_LEN - t.length);
}

/** Read + sanitise the table: bad / hostile JSON just yields an empty or trimmed board. Sorted high -> low, max 10 rows. */
export function loadBoard(storage, storageKey) {
  let raw = null;
  try { raw = storage && storageKey ? JSON.parse(storage.getItem(storageKey)) : null; } catch (_) { raw = null; }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e) => e && Number.isFinite(e.score) && e.score > 0)
    .map((e) => ({ name: cleanName(e.name), score: Math.floor(e.score), level: Math.max(1, Math.floor(e.level) || 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, LB_SIZE);
}

export function saveBoard(storage, board, storageKey) { try { if (storage && storageKey) storage.setItem(storageKey, JSON.stringify(board)); } catch (_) {} }

/** Does `score` earn a place? Needs to beat 10th place (or the table has a free row) and be > 0. */
export function qualifies(board, score) {
  return score > 0 && (board.length < LB_SIZE || score > board[LB_SIZE - 1].score);
}

/**
 * Insert an entry; ties rank below existing equal scores. @returns {{board:object[], rank:number}} rank is 0-based, -1 if it missed.
 * Does not mutate the input array.
 */
export function insertScore(board, entry) {
  const e = { name: cleanName(entry.name), score: Math.floor(entry.score), level: Math.max(1, Math.floor(entry.level) || 1) };
  if (!qualifies(board, e.score)) return { board: board.slice(), rank: -1 };
  let rank = board.findIndex((x) => e.score > x.score); if (rank < 0) rank = board.length;
  const out = board.slice(); out.splice(rank, 0, e);
  return { board: out.slice(0, LB_SIZE), rank };
}
