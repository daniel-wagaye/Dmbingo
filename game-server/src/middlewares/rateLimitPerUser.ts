const rateMaps = new Map<string, Map<number, number[]>>();

function getOrCreateMap(key: string): Map<number, number[]> {
  let map = rateMaps.get(key);
  if (!map) {
    map = new Map();
    rateMaps.set(key, map);
  }
  return map;
}

export function isAllowed(
  category: string,
  telegramId: number,
  windowMs: number,
  limit: number
): boolean {
  const map = getOrCreateMap(category);
  const now = Date.now();
  let arr = map.get(telegramId) || [];
  arr = arr.filter((ts) => now - ts < windowMs);
  if (arr.length >= limit) {
    map.set(telegramId, arr);
    return false;
  }
  arr.push(now);
  map.set(telegramId, arr);
  return true;
}

export function clearAllRateLimits(): number {
  let totalEntries = 0;
  for (const [, map] of rateMaps) {
    totalEntries += map.size;
    map.clear();
  }
  rateMaps.clear();
  return totalEntries;
}