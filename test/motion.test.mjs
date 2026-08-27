// Tests the motion physics that ship inside index.html's appended script.
// Run with:  node test/motion.test.mjs
//
// The functions are parsed out of the shipped file rather than copied, so this
// tests the real source. requestAnimationFrame is replaced with a synthetic
// 60fps clock, which makes the spring deterministic and lets it settle without
// a browser (rAF is throttled in hidden tabs, so this cannot be tested there).
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const html = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"),
  "utf8"
);

function extract(name) {
  const start = html.indexOf(`  function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found in index.html`);
  const end = html.indexOf("\n  }\n", start);
  if (end < 0) throw new Error(`could not find the end of ${name}`);
  return html.slice(start, end + 4);
}

// --- synthetic display clock ----------------------------------------------
let now = 0;
let queue = [];
globalThis.requestAnimationFrame = (fn) => { queue.push(fn); return queue.length; };
globalThis.cancelAnimationFrame = (id) => { queue[id - 1] = null; };
function runFrames(maxFrames = 600, step = 1000 / 60) {
  let frames = 0;
  while (queue.length && frames < maxFrames) {
    const batch = queue;
    queue = [];
    now += step;
    for (const fn of batch) if (fn) fn(now);
    frames++;
  }
  return frames;
}

// constants the functions close over, taken from the shipped file too
const constants = (html.match(/^\s*var SPRING_STEP = .*$/m) || [])[0];
if (!constants) throw new Error("SPRING_STEP not found in index.html");

const src = [constants, extract("spring"), extract("project"), extract("rubberband")].join("\n");
const { spring, project, rubberband } = new Function(
  `${src}; return { spring, project, rubberband };`
)();

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` +
    (ok ? "" : `\n        got  ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`));
};
const near = (label, actual, expected, tol) => {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` +
    (ok ? "" : `\n        got  ${actual}\n        want ${expected} ±${tol}`));
};

// =========================================================================
console.log("--- momentum projection (Apple's exponential decay) ---");
// (v/1000) * d / (1-d);  d = 0.998 → factor 499
near("1000 px/s projects ~499px", project(1000), 499, 0.5);
near("default rate is 0.998", project(1000, 0.998), project(1000), 1e-9);
near("snappier rate travels less", project(1000, 0.99), 99, 0.5);
check("no velocity, no projection", project(0), 0);
check("direction is preserved", project(-1000) < 0, true);
// the textbook v^2/(2a) form would be quadratic; this one must stay linear in v
near("linear in velocity", project(2000) / project(1000), 2, 1e-9);

console.log("\n--- rubber-banding ---");
const DIM = 800;
const r50 = rubberband(50, DIM);
const r200 = rubberband(200, DIM);
const r800 = rubberband(800, DIM);
check("always resists — output is less than the input", [r50 < 50, r200 < 200, r800 < 800], [true, true, true]);
check("still monotonic: pulling further always moves further", r50 < r200 && r200 < r800, true);
check("resistance grows with distance", (r200 / 200) < (r50 / 50), true);
check("zero in, zero out", rubberband(0, DIM), 0);
// This formula resists from the very first pixel — the ratio tends to the
// constant (0.55), not to 1:1. Worth knowing: iOS's classic scroll rubber band
// starts at 1:1 and stiffens; this one is grippier immediately.
near("small pulls follow at roughly the constant", r50 / 50, 0.55, 0.03);
check("and the ratio never exceeds the constant",
  [r50 / 50, r200 / 200, r800 / 800].every((x) => x <= 0.55 + 1e-9), true);

console.log("\n--- spring: critically damped (damping 1.0) ---");
let frames = [];
let done = false;
spring(400, 0, 0, 1.0, 0.35, (v) => frames.push(v), () => { done = true; });
runFrames();
check("settles", done, true);
check("lands exactly on target", frames[frames.length - 1], 0);
check("never overshoots past the target", frames.every((v) => v >= -0.5), true);
check("moves monotonically toward the target",
  frames.every((v, i) => i === 0 || v <= frames[i - 1] + 0.5), true);
// response is not a duration, but a 0.35s response should settle in well under a second
check("settles in under a second at 60fps", frames.length < 60, true);

console.log("\n--- spring: under-damped (damping 0.8) bounces ---");
frames = [];
done = false;
spring(400, 0, 0, 0.8, 0.3, (v) => frames.push(v), () => { done = true; });
runFrames();
check("settles", done, true);
check("overshoots past the target at least once", frames.some((v) => v < -1), true);
// the discrete integration should stay close to the analytic overshoot
near("overshoot is close to the analytic value",
  Math.min(...frames), -400 * Math.exp(-Math.PI * 0.8 / Math.sqrt(1 - 0.64)), 2);
check("but comes back and lands on target", frames[frames.length - 1], 0);

console.log("\n--- spring: velocity handoff ---");
// A sheet released while still moving downward must keep going that way first,
// so there is no visible seam between the finger and the animation.
frames = [];
spring(0, 0, 600, 1.0, 0.35, (v) => frames.push(v), null);
runFrames();
check("continues in the direction of the flick before returning",
  Math.max(...frames) > 5, true);
check("still ends at the target", frames[frames.length - 1], 0);

frames = [];
spring(100, 0, -800, 1.0, 0.35, (v) => frames.push(v), null);
runFrames();
check("a fast reversal is absorbed, not bounced off a wall",
  frames.every((v) => v > -60), true);

console.log("\n--- spring: interruption ---");
frames = [];
const live = spring(400, 0, 0, 1.0, 0.35, (v) => frames.push(v), null);
runFrames(6); // let it get moving
const midValue = live.value;
const midVelocity = live.velocity;
live.cancel();
const framesAtCancel = frames.length;
runFrames(30);
check("cancel stops the animation dead", frames.length, framesAtCancel);
check("exposes a live on-screen value to resume from",
  midValue > 0 && midValue < 400, true);
check("exposes live velocity to carry into the next spring", midVelocity < 0, true);

// resuming from the interrupted value keeps the motion continuous
frames = [];
spring(midValue, 0, midVelocity, 1.0, 0.35, (v) => frames.push(v), null);
runFrames();
near("resumed spring starts exactly where the last one stopped", frames[0], midValue, 12);
check("and still lands on target", frames[frames.length - 1], 0);

console.log("\n--- spring: a stalled tab does not explode the integration ---");
frames = [];
done = false;
spring(400, 0, 0, 1.0, 0.35, (v) => frames.push(v), () => { done = true; });
runFrames(2);
now += 10000; // tab hidden for ten seconds
runFrames();
check("dt is clamped, so it settles rather than diverging", done, true);
check("no NaN or runaway values", frames.every((v) => Number.isFinite(v)), true);
check("lands on target after the stall", frames[frames.length - 1], 0);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall green");
process.exit(failures ? 1 : 0);
