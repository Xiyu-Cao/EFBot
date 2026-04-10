/**
 * Debug gauge calculation in the simulation engine.
 * Run: node --experimental-vm-modules scripts/debugGauge.mjs
 *
 * Actually we can't easily run the simulation outside Vite due to import.meta.glob.
 * Instead, let's trace what the engine should produce step by step.
 */

// Manual trace of gauge events for LAEVATAIN's combo:
// Actions (in order):
// 1. ARDELIA link (gaugeGain=10 for ARDELIA, teamGaugeGain=0)
// 2. WULFGARD skill (spCost=100, gaugeGain=6.5, teamGaugeGain=6.5)
// 3. WULFGARD link (gaugeGain=10, teamGaugeGain=0)
// 4. AKEKURI skill (spCost=100, gaugeGain=6.5, teamGaugeGain=6.5)
// 5. LAEVATAIN link (gaugeGain=25, teamGaugeGain=0)
// 6. LAEVATAIN enhanced_skill (gaugeGain=106.5, teamGaugeGain=6.5)

const ult_charge_eff = 183.6; // from equipment
const eff = ult_charge_eff / 100; // 1.836

let gauge = 0;
const events = [];

function log(desc, change) {
  gauge += change;
  gauge = Math.min(gauge, 300); // cap at maxGauge (before P4 reduction)
  events.push({ desc, change: change.toFixed(2), gauge: gauge.toFixed(2) });
}

// SP-based charges (from SpChangeHandler):
// WULFGARD skill consumes 100 SP → all actors get 6.5 * eff
log("WULFGARD skill SP→charge (team)", 6.5 * eff);
// AKEKURI skill consumes 100 SP → all actors get 6.5 * eff
log("AKEKURI skill SP→charge (team)", 6.5 * eff);

// Action gaugeGain (from ActionEndHandler):
// ARDELIA link ends → teamGaugeGain=0, no effect on LAEVATAIN
// WULFGARD skill ends → teamGaugeGain=6.5 → LAEVATAIN gets 6.5 * eff
log("WULFGARD skill teamGaugeGain", 6.5 * eff);
// WULFGARD link ends → teamGaugeGain=0
// AKEKURI skill ends → teamGaugeGain=6.5 → LAEVATAIN gets 6.5 * eff
log("AKEKURI skill teamGaugeGain", 6.5 * eff);
// LAEVATAIN link ends → gaugeGain=25 (self) → 25 * eff
log("LAEVATAIN link gaugeGain", 25 * eff);
// LAEVATAIN enhanced skill ends → gaugeGain=106.5 (self) → 106.5 * eff
log("LAEVATAIN enh-skill gaugeGain", 106.5 * eff);
// LAEVATAIN enhanced skill SP consumed → 6.5 * eff (from SpChangeHandler, self)
log("LAEVATAIN enh-skill SP→charge (self)", 6.5 * eff);

console.log("\n=== Gauge trace for LAEVATAIN ===");
console.log("ult_charge_eff:", ult_charge_eff, "→ multiplier:", eff.toFixed(3));
console.log("");
events.forEach(e => console.log(`  ${e.desc}: +${e.change} → gauge=${e.gauge}`));
console.log("\nFinal gauge:", gauge.toFixed(2));
console.log("Required (P4):", 255);
console.log("Required (no P4):", 300);
console.log("Sufficient for P4?", gauge >= 255);
console.log("\n=== PROBLEM CHECK ===");
console.log("SP-based charge is DUPLICATED:");
console.log("  SpChangeHandler gives ALL actors charge from SP consumption");
console.log("  ActionEndHandler ALSO gives teamGaugeGain to teammates");
console.log("  For skills: SP consumption already generates teamGaugeGain equivalent!");
console.log("  So teamGaugeGain from ActionEndHandler is DOUBLE-COUNTING!");
