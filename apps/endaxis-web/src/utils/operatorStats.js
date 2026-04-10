/**
 * Operator base attribute lookup.
 *
 * Queries warfarin-wiki normalized data to resolve an operator's base stats
 * at a given character level.  This is a pure lookup — it does NOT include
 * weapon / equipment / buff modifiers.
 *
 * ── Future calculation chain ──
 * 1. Track config state   (track.growth — promotion, level, skills)
 * 2. Base attribute lookup (THIS FILE — per-level stats from wiki data)
 * 3. Weapon / equipment config  (track.weaponId, equipArmorId, etc.)
 * 4. Modifier aggregation  (weapon deltas + equipment deltas + buffs)
 * 5. Final display stats   (computed, not stored)
 * 6. Simulation input      (fed into runtime)
 */

// ── Chinese label → CORE_STATS id mapping ──
const STAT_NAME_MAP = {
  '力量':  'strength',
  '敏捷':  'agility',
  '智识':  'intellect',
  '意志':  'will',
  '攻击力': 'attack',
  '生命值': 'hp',
}

/**
 * Parse the per-level stats table (table index 1) from warfarin-wiki
 * normalized data into a lookup-friendly structure.
 *
 * @param {Object} wikiNormalized — the full normalized JSON for one operator
 * @returns {Map<number, Object>|null}  Map from level (1-90) →
 *          { strength, agility, intellect, will, attack, hp }
 *          Returns null if data is missing or malformed.
 */
export function parseStatsTable(wikiNormalized) {
  if (!wikiNormalized?.stats?.tables?.[1]) return null
  const table = wikiNormalized.stats.tables[1]
  if (table.length < 2) return null

  // First row is the header: ["", "1", "2", ..., "90"]
  const header = table[0]
  const levelCount = header.length - 1 // skip the empty first cell

  const result = new Map()

  // Initialize empty objects for each level
  for (let i = 0; i < levelCount; i++) {
    const level = parseInt(header[i + 1], 10)
    if (!Number.isFinite(level)) continue
    result.set(level, {})
  }

  // Fill in each stat row
  for (let r = 1; r < table.length; r++) {
    const row = table[r]
    const label = row[0]
    const statId = STAT_NAME_MAP[label]
    if (!statId) continue // unknown stat, skip

    for (let i = 0; i < levelCount; i++) {
      const level = parseInt(header[i + 1], 10)
      if (!Number.isFinite(level)) continue
      const entry = result.get(level)
      if (entry) entry[statId] = Number(row[i + 1]) || 0
    }
  }

  return result
}

/**
 * Look up an operator's base stats at a specific character level.
 *
 * @param {Object} wikiNormalized — normalized wiki JSON for the operator
 * @param {number} level — character level (1-90)
 * @returns {{ strength: number, agility: number, intellect: number,
 *             will: number, attack: number, hp: number } | null}
 */
export function lookupBaseStats(wikiNormalized, level) {
  const table = parseStatsTable(wikiNormalized)
  if (!table) return null
  return table.get(level) || null
}

/**
 * Eagerly load all warfarin-wiki normalized operator modules.
 * Returns a function: (slug) → normalized JSON or null.
 *
 * Usage:
 *   const getWikiData = createWikiDataLoader()
 *   const data = getWikiData('endministrator')
 */
export function createWikiDataLoader() {
  const modules = import.meta.glob(
    '../external-data/warfarin-wiki/operators/normalized/*.json',
    { eager: true }
  )
  return function getWikiData(slug) {
    if (!slug) return null
    const key = `../external-data/warfarin-wiki/operators/normalized/${slug}.json`
    const mod = modules[key]
    return mod?.default || mod || null
  }
}

// Re-export the name map for consumers that need to do their own mapping
export { STAT_NAME_MAP }
