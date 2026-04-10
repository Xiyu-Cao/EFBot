/**
 * Lightweight loader for the per-operator static data folders.
 *
 * Usage:
 *   import { loadOperator } from '@/data/operators/loader.js'
 *   const op = loadOperator('ENDMINISTRATOR')
 *   op.meta   // meta.json contents
 *   op.stats  // stats.json contents
 *   op.skills // skills.json contents
 *   ...
 *
 * Returns null fields for operators that don't have a folder yet
 * (graceful fallback for the incremental migration).
 */

const metaModules = import.meta.glob('./**/meta.json', { eager: true })
const statsModules = import.meta.glob('./**/stats.json', { eager: true })
const skillsModules = import.meta.glob('./**/skills.json', { eager: true })
const talentsModules = import.meta.glob('./**/talents.json', { eager: true })
const aeModules = import.meta.glob('./**/ability-expansion.json', { eager: true })
const potentialModules = import.meta.glob('./**/potentials.json', { eager: true })

function resolve(modules, operatorId, file) {
  const key = `./${operatorId}/${file}`
  const mod = modules[key]
  return mod?.default || mod || null
}

/**
 * Load all static data files for one operator.
 * @param {string} operatorId  e.g. 'ENDMINISTRATOR'
 * @returns {{ meta, stats, skills, talents, abilityExpansion, potentials }}
 */
export function loadOperator(operatorId) {
  if (!operatorId) return { meta: null, stats: null, skills: null, talents: null, abilityExpansion: null, potentials: null }
  return {
    meta:             resolve(metaModules, operatorId, 'meta.json'),
    stats:            resolve(statsModules, operatorId, 'stats.json'),
    skills:           resolve(skillsModules, operatorId, 'skills.json'),
    talents:          resolve(talentsModules, operatorId, 'talents.json'),
    abilityExpansion: resolve(aeModules, operatorId, 'ability-expansion.json'),
    potentials:       resolve(potentialModules, operatorId, 'potentials.json'),
  }
}

/**
 * Look up base stats for an operator at a specific level from the new static data.
 * Returns null if the operator hasn't been migrated yet.
 *
 * @param {string} operatorId
 * @param {number} level  1-90
 * @returns {{ strength, agility, intellect, will, attack, hp } | null}
 */
export function lookupOperatorStats(operatorId, level) {
  const statsData = resolve(statsModules, operatorId, 'stats.json')
  if (!statsData?.levels) return null
  return statsData.levels[String(level)] || null
}

/** List all operator IDs that have been migrated (have a meta.json). */
export function listMigratedOperators() {
  return Object.keys(metaModules).map(k => {
    const match = k.match(/^\.\/([^/]+)\/meta\.json$/)
    return match ? match[1] : null
  }).filter(Boolean)
}
