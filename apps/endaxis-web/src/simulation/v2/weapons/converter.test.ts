import { describe, it, expect } from "vitest";
import { extractWeaponPassiveStats } from "./converter";
import { V2_WEAPON_REGISTRY } from "./definitions";

describe("extractWeaponPassiveStats", () => {
  it("emits type=percent for weapon attack passive (攻击力+X%)", () => {
    // 钢铁余音 max tier: "攻击力+14%"
    const weapon = V2_WEAPON_REGISTRY.wpn_sword_0005!;
    const mods = extractWeaponPassiveStats(weapon, 8);
    const atkMod = mods.find(m => m.stat === "attack");
    expect(atkMod).toBeDefined();
    expect(atkMod!.type).toBe("percent");
    expect(atkMod!.value).toBe(14);
  });

  it("emits type=flat for originium_arts_power passive (source 强度+X points)", () => {
    // 坚城铸造者 max tier: "源石技艺强度+70"
    const weapon = V2_WEAPON_REGISTRY.wpn_sword_0007!;
    const mods = extractWeaponPassiveStats(weapon, 8);
    const oapMod = mods.find(m => m.stat === "originium_arts_power");
    expect(oapMod).toBeDefined();
    expect(oapMod!.type).toBe("flat");
    expect(oapMod!.value).toBe(70);
  });

  it("emits type=flat for dmg-zone stats (routed via sumFlat later)", () => {
    // 不知归 (wpn_sword_0016) max tier: "物理伤害+44.8%"
    const weapon = V2_WEAPON_REGISTRY.wpn_sword_0016!;
    const mods = extractWeaponPassiveStats(weapon, 8);
    const physMod = mods.find(m => m.stat === "physical_dmg");
    expect(physMod).toBeDefined();
    // physical_dmg uses flatModifiers bucket by convention (sumFlat reads it).
    expect(physMod!.type).toBe("flat");
  });
});
