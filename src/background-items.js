import { CANDY_DROP_MULT, ITEM_RATES } from './config.js';

const BALLS = new Set(['poke-ball', 'ultra-ball', 'master-ball']);

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function ensureData(gameData) {
  gameData.items = gameData.items && typeof gameData.items === 'object' && !Array.isArray(gameData.items)
    ? gameData.items
    : {};
  gameData.stats = gameData.stats && typeof gameData.stats === 'object' ? gameData.stats : {};
  gameData.stats.totalItemsEarned = gameData.stats.totalItemsEarned
    && typeof gameData.stats.totalItemsEarned === 'object'
    && !Array.isArray(gameData.stats.totalItemsEarned)
    ? gameData.stats.totalItemsEarned
    : {};
  gameData.systemLogs = Array.isArray(gameData.systemLogs) ? gameData.systemLogs : [];
  gameData.background = gameData.background && typeof gameData.background === 'object'
    ? gameData.background
    : {};
  gameData.background.stats = gameData.background.stats && typeof gameData.background.stats === 'object'
    ? gameData.background.stats
    : {};
  gameData.background.stats.items = gameData.background.stats.items
    && typeof gameData.background.stats.items === 'object'
    && !Array.isArray(gameData.background.stats.items)
    ? gameData.background.stats.items
    : {};
  gameData.background.stats.itemDrops = finiteNonNegative(gameData.background.stats.itemDrops);
}

function itemDropMultiplier(follower, from, to) {
  const endsAt = finiteNonNegative(follower?.endsAt);
  const boost = finiteNonNegative(follower?.boost);
  const enabled = Array.isArray(follower?.groups)
    && follower.groups.includes('itemdrop')
    && boost > 0
    && endsAt > from;
  if (!enabled) return { boostedMs: 0, normalMs: Math.max(0, to - from), boost: 0 };
  const boostedTo = Math.min(to, endsAt);
  return {
    boostedMs: Math.max(0, boostedTo - from),
    normalMs: Math.max(0, to - boostedTo),
    boost,
  };
}

function rollCandyMultiplier(multipliers, random) {
  const choices = Array.isArray(multipliers) ? multipliers : [];
  const total = choices.reduce((sum, choice) => {
    const weight = finiteNonNegative(choice?.weight);
    const mult = finiteNonNegative(choice?.mult);
    return mult > 0 ? sum + weight : sum;
  }, 0);
  if (total <= 0) return 1;
  let roll = finiteNonNegative(random?.()) % 1 * total;
  for (const choice of choices) {
    const mult = finiteNonNegative(choice?.mult);
    const weight = finiteNonNegative(choice?.weight);
    if (mult <= 0) continue;
    roll -= weight;
    if (roll <= 0) return mult;
  }
  return finiteNonNegative(choices.at(-1)?.mult) || 1;
}

function pushBackgroundLog(gameData, item, qty, drops, time) {
  const existing = gameData.systemLogs.find(log =>
    log?.time === time
    && log.type === 'item_gain'
    && log.details?.background === true
    && log.details?.item === item,
  );
  if (existing) {
    existing.details.qty = finiteNonNegative(existing.details.qty) + qty;
    existing.details.drops = finiteNonNegative(existing.details.drops) + drops;
    return;
  }
  gameData.systemLogs.push({
    time,
    type: 'item_gain',
    details: { item, qty, drops, background: true },
  });
  if (gameData.systemLogs.length > 50) {
    gameData.systemLogs.splice(0, gameData.systemLogs.length - 50);
  }
}

/**
 * Settles ordinary-road item drops for one elapsed time span.
 * The caller must pass a mutable background state copy and persist it only
 * after the complete background settlement succeeds.
 */
export function settleBackgroundItems({
  state,
  from,
  to,
  itemRates = ITEM_RATES,
  candyMultipliers = CANDY_DROP_MULT,
  random = Math.random,
  enabled = true,
  logTime = to,
} = {}) {
  const result = { items: {}, drops: {} };
  if (!enabled || !state?.gameData || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return result;
  }

  const gameData = state.gameData;
  ensureData(gameData);
  state.balls = state.balls && typeof state.balls === 'object' ? state.balls : {};
  const follower = gameData.follower;
  const { boostedMs, normalMs, boost } = itemDropMultiplier(follower, from, to);

  for (const [item, rawRate] of Object.entries(itemRates || {})) {
    const rate = finiteNonNegative(rawRate);
    if (rate <= 0) continue;
    const current = finiteNonNegative(gameData[`_f_${item}`]);
    const gainedProgress = (normalMs / 1000) * rate
      + (boostedMs / 1000) * rate * (1 + boost);
    const progress = current + gainedProgress;
    const drops = Math.floor(progress);
    gameData[`_f_${item}`] = progress - drops;
    if (drops <= 0) continue;

    let qty = drops;
    if (item === 'candy') {
      qty = 0;
      for (let i = 0; i < drops; i += 1) {
        qty += rollCandyMultiplier(candyMultipliers, random);
      }
    }
    const currentInventory = BALLS.has(item)
      ? finiteNonNegative(state.balls[item])
      : finiteNonNegative(gameData.items[item]);
    const currentEarned = finiteNonNegative(gameData.stats.totalItemsEarned[item]);
    const currentBackground = finiteNonNegative(gameData.background.stats.items[item]);
    gameData.items[item] = currentInventory + qty;
    gameData.stats.totalItemsEarned[item] = currentEarned + qty;
    gameData.background.stats.items[item] = currentBackground + qty;
    gameData.background.stats.itemDrops += drops;
    result.items[item] = qty;
    result.drops[item] = drops;
    if (BALLS.has(item)) state.balls[item] = gameData.items[item];
    pushBackgroundLog(gameData, item, qty, drops, logTime);
  }

  return result;
}
