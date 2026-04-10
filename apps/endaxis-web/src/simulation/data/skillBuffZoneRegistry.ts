/**
 * Skill buff zone registry — maps skill-applied effect types to their
 * damage multiplier zones.
 *
 * Classification rules (from game descriptions):
 *   - "XX增幅"  → amplify zone (增幅区)
 *   - "造成的XX伤害增加" → damageBonus zone (增伤区)
 *   - "受到的XX伤害增加" / "XX脆弱" → fragility zone (脆弱区)
 *
 * Stack behaviour:
 *   - If max stacks are not specified → independent buffs (co-existing)
 *   - Unlike conduction/corrosion which overwrite on re-application
 *
 * This registry is consumed by simulator.ts effect routing (Route 2.9+).
 */

import type { DynamicBonusStat, DynamicBonusZone } from "../equipment/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single bonus descriptor: zone + stat + skills.json label for value lookup. */
export interface BonusDescriptor {
  zone: DynamicBonusZone;
  stat: DynamicBonusStat;
  /** Label in skills.json for looking up the value at the current skill level. */
  valueLabel: string;
  /** Fixed value override — used when the value is constant and not from skills.json. */
  fixedValue?: number;
}

export interface SkillBuffZoneEntry {
  /** Effect type string as it appears in gamedata.json anomaly arrays. */
  effectType: string;
  /** Human-readable Chinese name. */
  name: string;
  /**
   * Bonus descriptors. Each entry produces one DynamicBonus on the Effect.
   * Use this for multi-bonus buffs (e.g., 聚焦 = emag fragility + blaze fragility).
   *
   * For single-bonus buffs, use the shorthand fields `zone`, `stat`, `valueLabel` instead.
   * If `bonuses` is provided it takes precedence over the shorthand fields.
   */
  bonuses?: BonusDescriptor[];
  /** Shorthand: zone for single-bonus entries. Ignored when `bonuses` is set. */
  zone?: DynamicBonusZone;
  /** Shorthand: stat for single-bonus entries. Ignored when `bonuses` is set. */
  stat?: DynamicBonusStat;
  /** Shorthand: valueLabel for single-bonus entries. Ignored when `bonuses` is set. */
  valueLabel?: string;
  /** Who receives the buff: "team" = all allies, "enemy" = debuff on target, "source" = self only. */
  target: "team" | "enemy" | "source";
  /**
   * Stack behaviour:
   * - "independent": each application is a separate Effect (co-existing, no overwrite)
   * - "refresh": same-id refresh duration (addOrRefreshBuff)
   */
  stackBehaviour: "independent" | "refresh";
  /** Label in skills.json for looking up the duration. */
  durationLabel?: string;
  /** Fixed default duration when anomaly node has duration=0. */
  defaultDuration?: number;
  /** Characters that use this effect type. */
  usedBy: string[];
  /**
   * Carrier-only buff: no damage zone effect, just a marker Effect on the target.
   * Routed through the engine to avoid UNKNOWN_EFFECT_TYPE, but creates
   * an Effect with no dynamicBonuses.
   */
  carrierOnly?: boolean;
  /** True if zone classification is uncertain and needs manual review. */
  needsReview?: boolean;
  /** Notes for review. */
  reviewNote?: string;
}

/**
 * Resolve the bonus descriptors for an entry.
 * Returns the `bonuses` array if present, otherwise wraps the shorthand fields.
 */
export function resolveBonuses(entry: SkillBuffZoneEntry): BonusDescriptor[] {
  if (entry.bonuses) return entry.bonuses;
  if (entry.zone && entry.stat && entry.valueLabel) {
    return [{ zone: entry.zone, stat: entry.stat, valueLabel: entry.valueLabel }];
  }
  if (entry.zone && entry.stat) {
    return [{ zone: entry.zone, stat: entry.stat, valueLabel: "" }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * All known skill buff effect types and their zone classifications.
 *
 * Keyed by effect type string (the `type` field in gamedata anomaly arrays).
 */
export const SKILL_BUFF_ZONE_REGISTRY: Record<string, SkillBuffZoneEntry> = {

  // ── Amplify zone (增幅区) ──
  // Description pattern: "XX增幅" — explicit amplify keyword

  fire_enhance: {
    effectType: "fire_enhance",
    name: "灼热增幅",
    zone: "amplify",
    stat: "blaze_dmg",
    target: "team",
    stackBehaviour: "independent",
    valueLabel: "灼热增幅效果",
    durationLabel: undefined, // duration from anomaly node (12s)
    usedBy: ["ANTAL"],
  },

  pulse_enhance: {
    effectType: "pulse_enhance",
    name: "电磁增幅",
    zone: "amplify",
    stat: "emag_dmg",
    target: "team",
    stackBehaviour: "independent",
    valueLabel: "电磁增幅效果",
    durationLabel: undefined,
    usedBy: ["ANTAL"],
  },

  cryst_enhance: {
    effectType: "cryst_enhance",
    name: "寒冷增幅",
    zone: "amplify",
    stat: "cold_dmg",
    target: "team",
    stackBehaviour: "independent",
    valueLabel: "基础寒冷增幅效果",
    durationLabel: undefined,
    usedBy: ["XAIHI"],
  },

  natural_enhance: {
    effectType: "natural_enhance",
    name: "自然增幅",
    zone: "amplify",
    stat: "nature_dmg",
    target: "team",
    stackBehaviour: "independent",
    valueLabel: "基础自然增幅效果",
    durationLabel: undefined,
    usedBy: ["XAIHI"],
  },

  spell_enhance: {
    effectType: "spell_enhance",
    name: "法术增幅",
    zone: "amplify",
    stat: "arts_dmg",
    target: "source",
    stackBehaviour: "refresh",
    valueLabel: "法术增幅效果",
    durationLabel: "法术增幅持续时间",
    usedBy: ["XAIHI"],
    // 实际触发条件：主控干员有支援晶体时重击→回血→满血则施加法术增幅。
    // 当前简化：无血量系统，默认满血，直接施加。
  },

  // ── Fragility zone (脆弱区) ──
  // Description pattern: "XX脆弱" or "受到的XX伤害增加"
  // Note: physical_weakness, physical_vulnerable, spell_vulnerable are
  // already handled by dedicated routes (2.6.5 / 2.7 / 2.8) in simulator.ts.
  // Listed here for completeness but NOT routed through this registry.

  // physical_weakness — already routed (LIFENG skill)
  // physical_vulnerable — already routed (ESTELLA link via boundEffect, ARDELIA skill)
  // spell_vulnerable — already routed (GILBERTA ultimate, ARDELIA skill)

  // ── Carrier buffs (载体标记，无直接乘区效果) ──

  endmin_debuff: {
    effectType: "endmin_debuff",
    name: "源石结晶",
    target: "enemy",
    stackBehaviour: "refresh",
    usedBy: ["ENDMINISTRATOR"],
    carrierOnly: true,
    // 连携技「锁闭序列」施加，封印时间 4-5 秒（「封印时间（秒）」）。
    // 被物理异常/破防消耗时额外造成物理伤害（「击碎结晶伤害倍率」）。
    //
    // 天赋0「本质瓦解」：结晶被消耗后→自身 ATK+15/30%，15秒，不叠加。
    // 天赋1「现实静滞」：结晶存在期间→敌人受到物理伤害+10/20% (vulnerability)，
    //   与结晶同生同灭——结晶消失/被消耗时此 debuff 同步移除。
    //
    // 实现思路：
    //   1. endmin_debuff 作为载体 Effect 放在 enemy.effects 上
    //   2. registerTriggeredBuff 监听 APPLY_PHYSICAL_ANOMALY → 消耗结晶 + 入队额外 DAMAGE_TICK
    //   3. 天赋0: 消耗事件 → 给 ENDMINISTRATOR 自身 ATK% buff
    //   4. 天赋1: 结晶存在时附加 linked vulnerability debuff，结晶 EFFECT_END 时一并移除
  },

  pograni_buff: {
    effectType: "pograni_buff",
    name: "铁誓",
    target: "source",
    stackBehaviour: "independent",
    usedBy: ["POGRANICHNK"],
    carrierOnly: true,
    // 终结技「盾卫旗队，上前」生成 5 点铁誓，持续 30 秒（「铁誓持续时间」），不刷新。
    // 消耗触发条件（每次消耗 1 层）：
    //   1. 敌人受到物理异常时 → 同时施加袭扰效果
    //   2. 骏卫施放连携技时 → 第一个 hit 施加袭扰效果
    // 袭扰效果：造成物理伤害（「袭扰伤害倍率」45-100%）+ 恢复技力（「袭扰恢复技力」7.5-10）
    // 最后一层消耗时：改为决胜效果（「决胜伤害倍率」200-450% +「决胜失衡值」15 +「决胜恢复技力」30-40）
  },

  dapan_buff: {
    effectType: "dapan_buff",
    name: "备料",
    target: "source",
    stackBehaviour: "refresh",
    usedBy: ["DAPAN"],
    carrierOnly: true,
    // 天赋1「尝尝咸淡」：终结技最后一击命中→获得备料（最多1/2层，20秒）。
    // 备料状态下连携技命中→恢复40%冷却时间并消耗一层。
    // 当前无冷却动态恢复机制，仅做载体标记。
  },

  weak: {
    effectType: "weak",
    name: "虚弱",
    target: "enemy",
    stackBehaviour: "refresh",
    usedBy: ["CATCHER"],
    carrierOnly: true,
    // 终结技「教科书式猛攻」对敌人施加虚弱（减伤 debuff），持续 8 秒。
    // 虚弱效果 20-30%（「虚弱效果」），虚弱持续时间 8 秒（「虚弱持续时间（秒）」）。
    // 模拟器不考虑敌人伤害，仅做标记。
  },

  comboskillwater: {
    effectType: "comboskillwater",
    name: "涡流",
    target: "source",
    stackBehaviour: "independent",
    usedBy: ["TANGTANG"],
    carrierOnly: true,
    // 连携技「河水，助我！」生成涡流，最多 2 处，持续 30 秒（「涡流持续时间（秒）」）。
    // 战技消耗所有涡流→形成额外水龙卷，并根据数量返还技力。
    // 类似莱万汀熔火：被动层数，被战技消耗。
  },

  skillwater: {
    effectType: "skillwater",
    name: "水龙卷",
    target: "enemy",
    stackBehaviour: "independent",
    usedBy: ["TANGTANG"],
    carrierOnly: true,
    // 战技「踏潮卷浪！」生成水龙卷（1 个基础 + 消耗涡流数量个额外），
    // 持续 3 秒（「水龙卷持续时间（秒）」），对范围内敌人持续造成寒冷伤害。
    // stacks 字段表示水龙卷数量 (1/2/3)。
    // 总倍率从「单个水龙卷伤害倍率」读取，但实际为持续伤害，每段倍率待后续数据。
    // 多个水龙卷时额外施加法术脆弱（「两个/三个水龙卷法术脆弱」）。
    // 类似雷枪处理方式：后续按 buff 直接计算持续伤害。
  },

  ultskilldebuff: {
    effectType: "ultskilldebuff",
    name: "古老图形",
    target: "enemy",
    stackBehaviour: "refresh",
    usedBy: ["TANGTANG"],
    carrierOnly: true,
    // 终结技「大当家盯着呢！」封锁敌人，暂停行动 4 秒（「古老图形持续时间（秒）」），
    // 并造成持续寒冷伤害（「持续伤害总倍率」）。
    // 演化结束降下巨浪（「巨浪伤害倍率」），主控下落攻击可提前触发（「提前降下巨浪伤害倍率」）。
    // 当前做载体标记，持续伤害和巨浪由 damage_ticks 处理。
  },

  combo: {
    effectType: "combo",
    name: "连击",
    bonuses: [
      { zone: "combo", stat: "all_dmg", valueLabel: "", fixedValue: 30 },
    ],
    target: "team",
    stackBehaviour: "refresh",
    usedBy: ["LIFENG", "AKEKURI"],
    // 全队下一个战技/终结技享受独立连击乘区加成：战技 +30%，终结技 +20%。
    // 使用后消耗（一次性 buff）。持续时间 20 秒。
    // 当前简化：固定 30%（战技值），不区分战技/终结技，不实现消耗。
    // TODO: 监听 ACTION_START(skill/ultimate) 消耗 combo buff，
    //   根据技能类型选择 30%(skill) 或 20%(ultimate)。
  },

  magma_1: {
    effectType: "magma_1",
    name: "熔火",
    target: "source",
    stackBehaviour: "independent",
    usedBy: ["LAEVATAIN"],
    carrierOnly: true,
    // 莱万汀被动层数（0-4层），无持续时间，无特殊 buff 效果。
    // 战技/连携技/终结技/普攻均可施加（每次 +1 层）。
    // 战技消耗全部熔火层数，根据层数强化伤害。
    // blaze_to_magma：普攻重击将灼热附着转换为熔火层。
  },

  blaze_to_magma: {
    effectType: "blaze_to_magma",
    name: "灼热→熔火转换",
    target: "source",
    stackBehaviour: "refresh",
    usedBy: ["LAEVATAIN"],
    carrierOnly: true,
    // 普攻重击触发：消耗敌方灼热附着，转换为自身熔火层数。
    // 与 magma_1 联动，当前做载体标记。
  },

  Thunderlances: {
    effectType: "Thunderlances",
    name: "雷枪",
    target: "source",
    stackBehaviour: "independent",
    usedBy: ["AVYWENNA"],
    carrierOnly: true,
    defaultDuration: 30,
    // 连携技生成 3 根雷枪（stacks=3 → 3 个独立 Effect），持续 30 秒。
    // 战技回收时消耗全部存活雷枪，每根造成伤害（「雷枪伤害倍率」）。
  },

  "Thunderlances EX": {
    effectType: "Thunderlances EX",
    name: "强雷枪",
    target: "source",
    stackBehaviour: "independent",
    usedBy: ["AVYWENNA"],
    carrierOnly: true,
    defaultDuration: 30,
    // 终结技生成 1 根强雷枪，持续 30 秒。
    // 战技回收时消耗，造成更高伤害（「强雷枪伤害倍率」）。
  },

  affix_slow: {
    effectType: "affix_slow",
    name: "缓速",
    target: "enemy",
    stackBehaviour: "refresh",
    usedBy: ["GILBERTA", "FLUORITE"],
    carrierOnly: true,
    // 通用控制 debuff，图标 /icons/icon_battle_affix_slow.webp。
    // GILBERTA 终结技施加，持续 5 秒。无直接伤害乘区效果。
    // FLUORITE 战技炸弹命中时施加 30% 缓速。
    // 作为载体标记存在：触发 FLUORITE 天赋「落井下石爱好者」
    // 对缓速目标造成伤害+10/20%。
  },

  fluorite_bomb: {
    effectType: "fluorite_bomb",
    name: "粘性炸弹",
    target: "enemy",
    stackBehaviour: "refresh",
    usedBy: ["FLUORITE"],
    carrierOnly: true,
    // 战技「小惊喜」第一段命中时施加，持续至第二段爆炸。
    // 最多 1 个——存在期间禁用战技（排轴器层面已约束）。
    // 终结技施放时若存在炸弹，提前引爆 +30% 伤害。
  },

  antal_buff: {
    effectType: "antal_buff",
    name: "聚焦",
    bonuses: [
      { zone: "fragility", stat: "emag_dmg", valueLabel: "电磁脆弱效果" },
      { zone: "fragility", stat: "blaze_dmg", valueLabel: "灼热脆弱效果" },
    ],
    target: "enemy",
    stackBehaviour: "refresh",
    usedBy: ["ANTAL"],
    // 对敌人施加聚焦（电磁脆弱+灼热脆弱），60秒，最多聚焦1个敌人。
  },

  skill_seraph: {
    effectType: "skill_seraph",
    name: "支援晶体",
    zone: "damageBonus", // ignored — carrierOnly
    stat: "all_dmg",     // ignored — carrierOnly
    target: "source",
    stackBehaviour: "refresh",
    usedBy: ["XAIHI"],
    carrierOnly: true,
    // 支援晶体：绑定在主控干员身上，切换主控时跟随切换。
    // 主控干员打出重击后触发恢复效果，满血则施加法术增幅 (spell_enhance)。
    // 触发后消耗（consumed）。到期自然消失（expired）不触发效果。
    // 当前简化：仅创建载体标记，增幅由 spell_enhance 条目直接施加。
  },

  lastrite_buff: {
    effectType: "lastrite_buff",
    name: "低温灌注",
    target: "source",
    stackBehaviour: "refresh",
    usedBy: ["LASTRITE"],
    carrierOnly: true,
    // 战技「塞什卡的秘传」：给主控干员低温灌注 buff，持续15秒。
    // 主控干员下一次重击触发→生成别礼幻影追击（寒冷伤害，「幻影追击伤害倍率」），
    // 施加寒冷附着，触发后消耗。到期自然消失不触发效果。
    //
    // 天赋0「低温症」：别礼消耗任何法术附着后→对目标施加寒冷脆弱，
    //   效果 = 被消耗层数 × 2/4%，15秒，不叠加。
    //   注意：此天赋监听的是「消耗法术附着」事件（连携技噬冬），不是 lastrite_buff 消耗。
    // 天赋1「低温脆性」：终结技造成伤害时，如果目标有寒冷脆弱，
    //   视为原效果的 1.2/1.5 倍（乘算放大）。
    //
    // 当前简化：载体标记 + 幻影追击由 spell_enhance 同理默认触发。
  },
};

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Returns the zone entry for a skill effect type, or undefined if not registered.
 */
export function getSkillBuffZone(effectType: string): SkillBuffZoneEntry | undefined {
  return SKILL_BUFF_ZONE_REGISTRY[effectType];
}

/**
 * Returns true if the effect type is a known skill buff that should be
 * routed through the zone system (not a placeholder / needs-review entry).
 * Includes carrierOnly entries (they create marker Effects, no DynamicBonus).
 */
export function isRoutableSkillBuff(effectType: string): boolean {
  const entry = SKILL_BUFF_ZONE_REGISTRY[effectType];
  return !!entry && !entry.needsReview;
}
