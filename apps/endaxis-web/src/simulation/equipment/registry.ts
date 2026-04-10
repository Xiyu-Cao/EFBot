/**
 * Equipment registration entry point.
 *
 * Maps equipment/weapon IDs to their registration functions.
 * Called from the simulation pipeline to register passives before engine.run().
 */

import type { SimulationEngine } from "../engine/SimulationEngine";
import type { GameDatabase, ScenarioData } from "../compiler/types";
import type { DiagnosticCollector } from "../diagnostics";
import type { WeaponData } from "./weaponDataAdapter";
import { registerWeaponFromData } from "./weaponDataAdapter";
import {
  registerDianjianSet,
  registerDonghuoyongSet,
  registerMaichongshiSet,
  registerChaoyongSet,
  registerMIJingyongSet,
  registerTuohuangSet,
  registerNianguSet,
  registerYinglongSet,
  registerAboliSet,
  registerQingchaoyuSet,
  registerTianzaiFanghuSet,
  registerChangxiSet,
  registerParadigmWeapon,
  registerZuopinShijiWeapon,
  registerEminentReputeWeapon,
  registerAncientCanalWeapon,
  registerValiantWeapon,
  registerObjVelocitousWeapon,
} from "./definitions";

// ---------------------------------------------------------------------------
// Set ID → registration function
// ---------------------------------------------------------------------------

type SetRegistrationFn = (
  engine: SimulationEngine,
  actorId: string,
) => void;

const SET_REGISTRY: Record<string, SetRegistrationFn> = {
  dianjian: registerDianjianSet,
  donghuoyong: registerDonghuoyongSet,
  maichongshi: registerMaichongshiSet,
  chaoyong: registerChaoyongSet,
  mi_jingyong: registerMIJingyongSet,
  tuohuang: registerTuohuangSet,
  niangu: registerNianguSet,
  yinglong: registerYinglongSet,
  aboli: registerAboliSet,
  qingchaoyu: registerQingchaoyuSet,
  tianzai_fanghu: registerTianzaiFanghuSet,
  changxi: registerChangxiSet,
};

const WEAPON_REGISTRY: Record<string, SetRegistrationFn> = {
  zuopin_shiji: registerZuopinShijiWeapon,
  eminent_repute: registerEminentReputeWeapon,
  ancient_canal: registerAncientCanalWeapon,
  valiant: registerValiantWeapon,
  obj_velocitous: registerObjVelocitousWeapon,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EquipmentConfig {
  actorId: string;
  setId?: string;
  /** Registry key, e.g. "paradigm" — not the raw gamedata weapon id */
  weaponId?: string;
  /** Original `track.weaponId` from scenario (e.g. wpn_claym_0004) for db lookup */
  weaponDatabaseId?: string;
}

function weaponDataFromDb(
  db: GameDatabase | undefined,
  weaponDatabaseId: string | undefined,
): WeaponData | undefined {
  if (!weaponDatabaseId || !db?.weaponDatabase?.length) return undefined;
  const row = db.weaponDatabase.find((w) => w.id === weaponDatabaseId);
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    passiveStats: row.passiveStats,
    triggeredBuffs: row.triggeredBuffs,
  };
}

export interface RegisterEquipmentOptions {
  db?: GameDatabase;
  diagnostics?: DiagnosticCollector;
}

/**
 * Register equipment passives for all actors on the engine.
 *
 * Call this after createEngine() but before engine.run().
 * Pass `db` so 典范 (paradigm) can merge triggeredBuffs from gamedata.json.
 */
export function registerEquipmentPassives(
  engine: SimulationEngine,
  configs: EquipmentConfig[],
  options?: RegisterEquipmentOptions,
): void {
  const { db, diagnostics } = options ?? {};

  for (const config of configs) {
    if (config.setId) {
      const register = SET_REGISTRY[config.setId];
      if (register) {
        register(engine, config.actorId);
      }
    }

    // Resolve weaponId from weaponDatabaseId if not explicitly set
    const weaponKey =
      config.weaponId ?? WEAPON_ID_TO_KEY[config.weaponDatabaseId ?? ""];

    if (weaponKey === "paradigm") {
      const fromDb = weaponDataFromDb(db, config.weaponDatabaseId);
      registerParadigmWeapon(engine, config.actorId, fromDb, diagnostics);
      continue;
    }

    if (weaponKey) {
      const register = WEAPON_REGISTRY[weaponKey];
      if (register) {
        register(engine, config.actorId);
        continue;
      }
    }

    // Auto-register from gamedata.json metadata (covers ~40 weapons)
    if (config.weaponDatabaseId && db) {
      const fromDb = weaponDataFromDb(db, config.weaponDatabaseId);
      if (fromDb?.triggeredBuffs?.length) {
        registerWeaponFromData(engine, config.actorId, fromDb, undefined, diagnostics);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Category name (Chinese) → set registry key mapping
// ---------------------------------------------------------------------------

export const CATEGORY_TO_SET_ID: Record<string, string> = {
  "点剑": "dianjian",
  "动火用": "donghuoyong",
  "脉冲式": "maichongshi",
  "潮涌": "chaoyong",
  "M.I.警用": "mi_jingyong",
  "拓荒": "tuohuang",
  "碾骨": "niangu",
  "50式应龙": "yinglong",
  "阿伯莉遗声": "aboli",
  "轻超域": "qingchaoyu",
  "天灾防护": "tianzai_fanghu",
  "长息": "changxi",
};

// ---------------------------------------------------------------------------
// Weapon ID → weapon registry key mapping
// Matches gamedata.json weaponDatabase[].id to WEAPON_REGISTRY keys.
// ---------------------------------------------------------------------------

const WEAPON_ID_TO_KEY: Record<string, string> = {
  wpn_claym_0004: "paradigm",        // 典范
  wpn_staff_0006: "zuopin_shiji",    // 作品：蚀迹
  wpn_sword_0013: "eminent_repute",  // 显赫声名
  wpn_claym_0014: "ancient_canal",   // 古渠
  wpn_lance_0010: "valiant",         // 骁勇
  wpn_pistol_0012: "obj_velocitous", // O.B.J.迅极
};

// ---------------------------------------------------------------------------
// Auto-extraction from ScenarioData
// ---------------------------------------------------------------------------

/**
 * Extract EquipmentConfig[] from scenario tracks.
 *
 * Determines active set bonuses by counting equipped items per category
 * (3+ items from same category = set bonus active).
 *
 * @param scenario - the scenario data (with tracks and equipment references)
 * @param equipmentDatabase - the equipment database from gamedata.json
 *   (needed to look up category from equipment item IDs)
 */
export function extractEquipmentConfigs(
  scenario: ScenarioData,
  equipmentDatabase?: Array<{ id: string; category?: string }>,
): EquipmentConfig[] {
  const configs: EquipmentConfig[] = [];
  const eqDb = equipmentDatabase ?? [];

  for (const track of scenario.tracks ?? []) {
    const actorId = track.id;
    let setId: string | undefined;
    let weaponId: string | undefined;

    // Determine active set bonus from equipped items
    const equippedIds = [
      track.equipArmorId,
      track.equipGlovesId,
      track.equipAccessory1Id,
      track.equipAccessory2Id,
    ].filter(Boolean) as string[];

    if (equippedIds.length >= 3) {
      // Count categories
      const catCounts = new Map<string, number>();
      for (const eqId of equippedIds) {
        const item = eqDb.find((e) => e.id === eqId);
        const cat = item?.category;
        if (cat) catCounts.set(cat, (catCounts.get(cat) || 0) + 1);
      }
      // First category with 3+ items activates the set
      for (const [cat, count] of catCounts) {
        if (count >= 3) {
          setId = CATEGORY_TO_SET_ID[cat];
          break;
        }
      }
    }

    const weaponDatabaseId = track.weaponId ?? undefined;
    if (weaponDatabaseId) {
      weaponId = WEAPON_ID_TO_KEY[weaponDatabaseId];
    }

    if (setId || weaponId) {
      configs.push({
        actorId,
        setId,
        weaponId,
        weaponDatabaseId,
      });
    }
  }

  return configs;
}

/**
 * Re-export individual registration functions for direct use in tests.
 */
export {
  registerDianjianSet,
  registerDonghuoyongSet,
  registerMaichongshiSet,
  registerChaoyongSet,
  registerMIJingyongSet,
  registerTuohuangSet,
  registerNianguSet,
  registerYinglongSet,
  registerAboliSet,
  registerQingchaoyuSet,
  registerTianzaiFanghuSet,
  registerChangxiSet,
  registerParadigmWeapon,
  registerZuopinShijiWeapon,
  registerEminentReputeWeapon,
  registerAncientCanalWeapon,
  registerValiantWeapon,
  registerObjVelocitousWeapon,
};
