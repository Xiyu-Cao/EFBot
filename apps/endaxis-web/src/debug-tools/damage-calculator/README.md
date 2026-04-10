# Damage Debug Calculator

**TEMP DEBUG TOOL — NOT IN PRODUCTION FLOW — SAFE TO DELETE AFTER DAMAGE VALIDATION**

## What is this?

A standalone single-hit damage calculator for manually verifying the damage formula.
Not connected to the timeline, legality system, or simulation runtime.

## How to open

Navigate to `/#/debug-calc` in the browser.

Or click "← Back to Timeline" in the header to return to the main app.

## How to use

1. **Base Panel**: Set base ATK, ability values, or use ATK Override to skip the formula
2. **Hit & Zones**: Set skill multiplier and all multiplier zones as final values (no auto +1)
3. **Results**: See non-crit, crit, expected, and total damage with full breakdown
4. **Copy**: Click "Copy Breakdown" to get a text summary for sharing

## How to delete

Remove these paths:
- `src/debug-tools/damage-calculator/` (this entire directory)
- The route in `src/router/index.js` (the `/debug-calc` line)

No other files depend on this module.
