// Offline tests for api/scores.js.  Run with:  node test/scores.test.mjs
//
// No network and no CLICKUP_TOKEN needed: global.fetch is stubbed with the real
// shapes ClickUp returns. Two groups:
//   1. the pipeline, with OVERRIDES / MANUAL_CREDITS blanked, so hand-made score
//      adjustments can never break these tests
//   2. the manual-adjustment layer, with those blocks patched per test
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

process.env.CLICKUP_TOKEN = "fake";
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "api", "scores.js");
const src = readFileSync(SRC, "utf8");
const TMP = mkdtempSync(join(tmpdir(), "sprint-test-"));

// --- field ids ------------------------------------------------------------
const RTL = "b52f8799-7bb6-4b97-a9e7-48436c5affc5";
const RFE = "825ebb96-7629-47b0-8454-10ce92f309e9";
const NE = [
  "6eac1b98-2c4b-40aa-bf9a-f717e5a96844",
  "fcdee4bc-64e5-4460-bf1c-cba69306dba7",
  "10de6da5-9c31-4309-85df-acd27885952e",
  "65a870ec-e424-45e8-b258-1e55a62bc2d0",
];
const CS = "56129090-2d02-43c2-8195-c831289d23d3";
const ED = "4766406c-05cb-4fd3-ad8e-7f969b67a57f";
const FMT = "9f191f7e-59f3-4b02-8491-ff759d1bc792";
const F_STATIC = "ae6c0bae-4fab-4fe4-9a70-ced26e194a2c";
const F_AIUGC = "17a498a2-b685-4673-813d-76c0cd1bfbf4";
const F_ANIM = "6cd85943-67f9-4d70-88aa-7c5b03a6d8b6";
const F_VOUGC = "8fbf555b-5be2-4789-b220-8a4e031bd584";
const F_VO = "f9ffdceb-ad82-4271-ac88-9c2eb5cc5f53";

const cf = (o) => Object.entries(o).map(([id, value]) => ({ id, value }));
const WINDOW_START = 1786312800000;
const WINDOW_END = 1788213600000;
const IN = 1786590000000; // Aug 13 2026
const OUT = 1780000000000;

// --- time-in-status shapes ClickUp has shipped -----------------------------
const SHAPES = {
  by_minute: (m) => ({ total_time: { by_minute: m, since: "1785987076001" } }), // live REST
  flat: (m) => ({ total_time_minutes: m }), // MCP client
  unknown: () => ({ total_time: "1d 16h 45m" }), // neither → must not drop a round
};
let SHAPE = "by_minute";
const st = (status, mins) => ({ status, ...SHAPES[SHAPE](mins) });

let listCalls = [];
let bulkCalls = [];
let resolvedPages = 0;
let PAGE_PLAN = null;
let TIS = null;

function stubFetch({ bulkFails = false, listFails = false } = {}) {
  global.fetch = async (url) => {
    if (url.includes("/list/")) {
      const page = Number(new URL(url).searchParams.get("page"));
      listCalls.push({ page, url, resolvedWhenStarted: resolvedPages });
      if (listFails) return { ok: false, status: 500, text: async () => "boom" };
      await new Promise((r) => setTimeout(r, 20)); // makes serial vs parallel visible
      resolvedPages++;
      return { ok: true, json: async () => PAGE_PLAN[page] || { tasks: [], last_page: true } };
    }
    if (url.includes("bulk_time_in_status")) {
      bulkCalls.push(url);
      if (bulkFails) return { ok: false, status: 403, text: async () => "ClickApp disabled" };
      return { ok: true, json: async () => ({ tasks: TIS(), task_count: 1 }) };
    }
    throw new Error("unexpected fetch: " + url);
  };
}

let seq = 0;
async function run({ tasks, overrides = "{}", credits = "[]", plan = null, ...opts } = {}) {
  let code = 200;
  let payload;
  listCalls = [];
  bulkCalls = [];
  resolvedPages = 0;
  PAGE_PLAN = plan || { 0: { tasks, last_page: true } };

  let patched = src
    .replace(/const OVERRIDES = \{[\s\S]*?\n\};/, `const OVERRIDES = ${overrides};`)
    .replace(/const MANUAL_CREDITS = \[[\s\S]*?\n\];/, `const MANUAL_CREDITS = ${credits};`);
  if (!patched.includes(`const OVERRIDES = ${overrides}`)) {
    throw new Error("OVERRIDES block not patched — has its shape changed?");
  }
  if (!patched.includes(`const MANUAL_CREDITS = ${credits}`)) {
    throw new Error("MANUAL_CREDITS block not patched — has its shape changed?");
  }
  const file = join(TMP, `scores_${seq++}.mjs`);
  writeFileSync(file, patched);
  const { default: handler } = await import(file);

  stubFetch(opts);
  await handler({}, {
    setHeader(k, v) { (this.headers ||= {})[k] = v; },
    status(c) { code = c; return this; },
    json(p) { payload = p; this.payload = p; return this; },
    get sent() { return payload; },
  });
  return { payload, code, headers: {} };
}

// --- tiny assertion helper ------------------------------------------------
let failures = 0;
let group = "";
const section = (t) => { group = t; console.log(`\n--- ${t} ---`); };
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${a}\n        want ${e}`}`);
};
const names = (p) => p.tasks.map((t) => t.batch).sort();
const find = (p, b) => p.tasks.filter((t) => t.batch === b);

// =========================================================================
// Fixtures
// =========================================================================
const misclick = { // stamp present, no time in "needs edits"
  id: "t_mis", name: "Batch#808", url: "https://app.clickup.com/t/86cay40w2",
  custom_fields: cf({ [ED]: [{ id: 1, username: "Joshua cecil" }],
    [FMT]: [F_AIUGC, F_ANIM], [RTL]: IN, [RFE]: 1785549600000, [NE[0]]: IN }),
};
const realRound = { // one round, 2445 minutes in the status
  id: "t_real", name: "Batch#755", url: "u",
  custom_fields: cf({ [ED]: [{ id: 2, username: "Pac Vishnu" }],
    [FMT]: [F_VOUGC], [RTL]: IN, [RFE]: 1785882600000, [NE[0]]: IN }),
};
const twoWithCsFault = {
  id: "t_two", name: "Batch#900", url: "u",
  custom_fields: cf({ [ED]: [{ id: 3, username: "Aakif" }],
    [FMT]: [F_VO], [RTL]: IN, [RFE]: 1785882600000, [NE[0]]: IN, [NE[1]]: IN, [CS]: 1 }),
};
const cleanBatch = {
  id: "t_clean", name: "Batch#901", url: "u",
  custom_fields: cf({ [ED]: [{ id: 4, username: "Edi" }], [FMT]: [F_STATIC], [RTL]: IN, [RFE]: 1785882600000 }),
};
const outOfWindow = {
  id: "t_old", name: "Batch#700", url: "u",
  custom_fields: cf({ [ED]: [{ id: 5, username: "Aakif" }], [FMT]: [F_STATIC], [RTL]: OUT }),
};
const excludedEditor = {
  id: "t_lead", name: "Batch#600", url: "u",
  custom_fields: cf({ [ED]: [{ id: 6, username: "Ben Schlueter" }], [FMT]: [F_STATIC], [RTL]: IN }),
};
const noEditor = {
  id: "t_noed", name: "Batch#500", url: "u",
  custom_fields: cf({ [FMT]: [F_STATIC], [RTL]: IN }),
};
const dupStamps = { // same date in NE1 and NE2 — the OSP-18 shape
  id: "t_dup", name: "OSP-18", url: "u",
  custom_fields: cf({ [ED]: [{ id: 7, username: "Pac Vishnu" }],
    [FMT]: [F_STATIC], [RTL]: IN, [NE[0]]: IN, [NE[1]]: IN }),
};

const TIS_DEFAULT = () => ({
  t_mis: { current_status: st("ready to launch", 15), status_history: [st("in review", 263)] },
  t_real: { current_status: st("testing", 2624), status_history: [st("needs edits", 2445)] },
  t_two: { current_status: st("needs edits", 900), status_history: [st("in review", 12)] },
  t_dup: { current_status: st("ready to launch", 10), status_history: [st("needs edits", 688)] },
});
TIS = TIS_DEFAULT;

const CORE = [misclick, realRound, twoWithCsFault, cleanBatch, outOfWindow];

// =========================================================================
// 1. Pipeline
// =========================================================================
section("request shape");
let r = await run({ tasks: CORE });
let u = new URL(listCalls[0].url);
check("date_updated_gt is 30 days before the window opens",
  u.searchParams.get("date_updated_gt"), String(WINDOW_START - 30 * 86400000));
check("closed tasks included, subtasks excluded",
  [u.searchParams.get("include_closed"), u.searchParams.get("subtasks")], ["true", "false"]);
check("one page → one list call", listCalls.length, 1);

section("pagination");
const filler = (n, page) => Array.from({ length: n }, (_, i) => ({
  id: `f${page}_${i}`, name: `Filler#${page}_${i}`, url: "u", custom_fields: cf({ [RTL]: OUT }),
}));
r = await run({ tasks: [], plan: {
  0: { tasks: [...CORE, ...filler(95, 0)], last_page: false },
  1: { tasks: filler(100, 1), last_page: false },
  2: { tasks: filler(40, 2), last_page: true },
} });
check("page 0 fetched first and alone",
  listCalls[0].page === 0 && listCalls[0].resolvedWhenStarted === 0, true);
const rest = listCalls.filter((c) => c.page > 0);
check("remaining pages issued in parallel, not serially",
  rest.length > 1 && rest.every((c) => c.resolvedWhenStarted === 1), true);
check("nothing in-window is lost across pages", names(r.payload),
  ["Batch#755", "Batch#808", "Batch#900", "Batch#901"]);

section("scoring — live REST shape (total_time.by_minute)");
r = await run({ tasks: CORE });
let by = Object.fromEntries(r.payload.tasks.map((t) => [t.batch, t]));
check("out-of-window batch dropped", r.payload.tasks.length, 4);
check("accidental stamp cleared", [by["Batch#808"].ne, by["Batch#808"].faults], ["0", []]);
check("editor renamed to the roster spelling", by["Batch#808"].editor, "joshua Cecil");
check("heaviest format label wins", by["Batch#808"].format, "AI-UGC");
check("misclick counted", r.payload.misclicksDropped, 1);
check("real round untouched", [by["Batch#755"].ne, by["Batch#755"].faults], ["1", ["Editor"]]);
check("CS-fault round attributed to the brief",
  [by["Batch#900"].ne, by["Batch#900"].faults], ["2", ["Brief", "Editor"]]);
check("clean batch untouched", [by["Batch#901"].ne, by["Batch#901"].faults], ["0", []]);
check("clickup url passed through for the drill-down",
  by["Batch#808"].url, "https://app.clickup.com/t/86cay40w2");
check("only stamped tasks are queried for time-in-status",
  bulkCalls.length === 1 && bulkCalls[0].includes("t_mis") && !bulkCalls[0].includes("t_clean"), true);

section("scoring — MCP shape (flat total_time_minutes)");
SHAPE = "flat";
r = await run({ tasks: CORE });
by = Object.fromEntries(r.payload.tasks.map((t) => [t.batch, t]));
check("accidental stamp still cleared", by["Batch#808"].ne, "0");
check("real round still kept", by["Batch#755"].faults, ["Editor"]);

section("scoring — unreadable duration must never drop a round");
SHAPE = "unknown";
r = await run({ tasks: CORE });
by = Object.fromEntries(r.payload.tasks.map((t) => [t.batch, t]));
check("unparseable time leaves the round alone", by["Batch#755"].faults, ["Editor"]);
check("status absent entirely still reads as accidental", by["Batch#808"].ne, "0");
SHAPE = "by_minute";

section("failure paths");
r = await run({ tasks: CORE, bulkFails: true });
by = Object.fromEntries(r.payload.tasks.map((t) => [t.batch, t]));
check("time-in-status down → raw stamps stand", [by["Batch#808"].ne, by["Batch#755"].ne], ["1", "1"]);
check("board still gets its data", r.payload.tasks.length, 4);
check("failure surfaced as a warning",
  r.payload.warnings.some((w) => w.includes("Could not check time-in-status")), true);
r = await run({ tasks: CORE, listFails: true });
check("list endpoint down → 500 with an error", [r.code, !!r.payload.error], [500, true]);

section("duplicate Needs Edits stamps");
r = await run({ tasks: [...CORE, dupStamps] });
check("two identical stamps are still counted, not silently collapsed",
  [find(r.payload, "OSP-18")[0].ne, find(r.payload, "OSP-18")[0].faults], ["2", ["Editor", "Editor"]]);
check("flagged for a human",
  r.payload.duplicateStamps.find((x) => x.batch === "OSP-18"),
  { batch: "OSP-18", stamps: 2, distinctDates: 1, overridden: false });
check("warning names the override to write",
  r.payload.warnings.some((w) => w.includes("OSP-18") && w.includes("{ rounds: N }")), true);
check("single-stamp batches are not flagged",
  r.payload.duplicateStamps.some((x) => x.batch === "Batch#755"), false);

// =========================================================================
// 2. Manual adjustments
// =========================================================================
section("team leads are out of the competition");
r = await run({ tasks: [...CORE, excludedEditor] });
check("a lead's batch is dropped", find(r.payload, "Batch#600").length, 0);
r = await run({ tasks: [...CORE, excludedEditor], overrides: '{ "Batch#600": { editor: "Edi" } }' });
check("an explicit reassignment still rescues it",
  find(r.payload, "Batch#600")[0].editor, "Edi");

section("each OVERRIDES key");
r = await run({ tasks: CORE, overrides: '{ "Batch#901": { exclude: true } }' });
check("exclude drops the batch", find(r.payload, "Batch#901").length, 0);
check("applied key reported", r.payload.overridesApplied, ["Batch#901"]);

r = await run({ tasks: CORE, overrides: '{ "Batch#700": { date: "2026-08-14" } }' });
check("date pulls an out-of-window batch in", find(r.payload, "Batch#700").length, 1);
check("moved batch carries the new date",
  new Date(find(r.payload, "Batch#700")[0].rtl).toISOString().slice(0, 10), "2026-08-13");

r = await run({ tasks: CORE, overrides: '{ "Batch#901": { count: 3 } }' });
check("count duplicates the row", find(r.payload, "Batch#901").length, 3);
check("copies are independent objects",
  find(r.payload, "Batch#901")[0] !== find(r.payload, "Batch#901")[1], true);
r = await run({ tasks: CORE, overrides: '{ "Batch#901": { count: 0 } }' });
check("nonsense count refused, row kept once", find(r.payload, "Batch#901").length, 1);
check("and warned", r.payload.warnings.some((w) => w.includes("not a whole number")), true);

r = await run({ tasks: CORE, overrides: '{ "Batch#755": { rounds: 0 } }' });
check("rounds:0 wipes the revision rounds",
  [find(r.payload, "Batch#755")[0].ne, find(r.payload, "Batch#755")[0].faults], ["0", []]);
r = await run({ tasks: CORE, overrides: '{ "Batch#901": { rounds: 2 } }' });
check("rounds:N sets editor-fault rounds",
  [find(r.payload, "Batch#901")[0].ne, find(r.payload, "Batch#901")[0].faults], ["2", ["Editor", "Editor"]]);
r = await run({ tasks: CORE, overrides: '{ "Batch#755": { rounds: -1 } }' });
check("negative rounds refused", find(r.payload, "Batch#755")[0].faults, ["Editor"]);

r = await run({ tasks: CORE, overrides: '{ "Batch#755": { clean: true } }' });
check("clean:true reassigns blame to the brief", find(r.payload, "Batch#755")[0].faults, ["Brief"]);
r = await run({ tasks: CORE, overrides: '{ "Batch#901": { clean: false } }' });
check("clean:false on a 0-round batch adds an editor round",
  [find(r.payload, "Batch#901")[0].ne, find(r.payload, "Batch#901")[0].faults], ["1", ["Editor"]]);
r = await run({ tasks: CORE, overrides: '{ "Batch#755": { clean: false } }' });
check("a hand-set verdict is not undone by the misclick pass",
  find(r.payload, "Batch#755")[0].faults, ["Editor"]);

r = await run({ tasks: CORE, overrides: '{ "Batch#901": { editor: "Mustafa" } }' });
check("editor reassigns", find(r.payload, "Batch#901")[0].editor, "Mustafa");
r = await run({ tasks: [...CORE, noEditor], overrides: '{ "Batch#500": { editor: "Mustafa" } }' });
check("editor override supplies a missing Editor field",
  find(r.payload, "Batch#500")[0].editor, "Mustafa");

r = await run({ tasks: CORE, overrides: '{ "Batch#901": { format: "Voiceover" } }' });
check("format forces a tier", find(r.payload, "Batch#901")[0].format, "Voiceover");

r = await run({ tasks: CORE, overrides: '{ "Batch#999": { clean: true } }' });
check("a key matching nothing warns instead of failing silently",
  r.payload.warnings.some((w) => w.includes('OVERRIDES["Batch#999"] matched no batch')), true);

section("cleanCount — one ticket, several videos, mixed outcomes");
// Batch#755 carries one real editor round, so an untouched copy is not clean.
r = await run({ tasks: CORE, overrides: '{ "Batch#755": { count: 2, cleanCount: 1 } }' });
let mixed = find(r.payload, "Batch#755");
check("both videos are delivered", mixed.length, 2);
check("exactly one of them is clean",
  mixed.filter((t) => t.ne === "0" && t.faults.length === 0).length, 1);
check("the other keeps the rounds ClickUp recorded",
  mixed.filter((t) => t.faults.includes("Editor")).length, 1);
check("tier is untouched — still the batch's own format",
  [...new Set(mixed.map((t) => t.format))], ["Voiceover-UGC"]);

r = await run({ tasks: CORE, overrides: '{ "Batch#755": { count: 2, cleanCount: 2 } }' });
check("cleanCount can cover every copy",
  find(r.payload, "Batch#755").every((t) => t.ne === "0"), true);

r = await run({ tasks: CORE, overrides: '{ "Batch#755": { count: 2, cleanCount: 5 } }' });
check("more clean than copies is capped, not invented",
  find(r.payload, "Batch#755").length, 2);
check("and warns", r.payload.warnings.some((w) => w.includes("more than the 2 copies")), true);

r = await run({ tasks: CORE, overrides: '{ "Batch#755": { count: 2, cleanCount: -1 } }' });
check("negative cleanCount refused, rounds left alone",
  find(r.payload, "Batch#755").every((t) => t.faults.includes("Editor")), true);

r = await run({ tasks: CORE, overrides: '{ "Batch#755": { cleanCount: 1 } }' });
check("cleanCount without count cleans the single row",
  [find(r.payload, "Batch#755")[0].ne, find(r.payload, "Batch#755")[0].faults], ["0", []]);

r = await run({ tasks: CORE, overrides: '{ "Batch#901": { count: 2, cleanCount: 1 } }' });
check("an already-clean batch is unaffected by the split",
  find(r.payload, "Batch#901").every((t) => t.ne === "0"), true);

section("all five keys at once (the Batch#613 shape)");
r = await run({ tasks: CORE, overrides:
  '{ "Batch#755": { editor: "Aakif", clean: true, format: "Voiceover", count: 2, date: "2026-08-11" } }' });
const five = find(r.payload, "Batch#755");
check("count applied", five.length, 2);
check("every copy reassigned, cleaned and re-tiered",
  five.map((t) => [t.editor, t.format, t.ne, t.faults.join("/")]),
  [["Aakif", "Voiceover", "1", "Brief"], ["Aakif", "Voiceover", "1", "Brief"]]);
check("date applied to every copy",
  [...new Set(five.map((t) => new Date(t.rtl).toISOString().slice(0, 10)))], ["2026-08-10"]);

section("MANUAL_CREDITS");
const credit = `[{ batch: "Batch#793", editor: "Aakriti Choudhary", format: "AI-UGC",
  date: "2026-08-22", url: "https://app.clickup.com/t/86cawyxat", note: "mis-assignment" }]`;
r = await run({ tasks: CORE, credits: credit });
const c = find(r.payload, "Batch#793")[0];
check("credit appears exactly once", find(r.payload, "Batch#793").length, 1);
check("credited as a clean batch at the named tier",
  [c.editor, c.format, c.ne, c.faults], ["Aakriti Choudhary", "AI-UGC", "0", []]);
check("dated inside the window", c.rtl >= WINDOW_START && c.rtl < WINDOW_END, true);
check("no rfe, so it cannot skew the speed tiebreak", c.rfe, null);
check("reported in manualCredits", r.payload.manualCredits.length, 1);

r = await run({ tasks: CORE, credits:
  `[{ batch: "Batch#901", editor: "Aakriti Choudhary", format: "AI-UGC", date: "2026-08-22" }]` });
check("a credit never steals the batch from the real editor",
  find(r.payload, "Batch#901").map((t) => t.editor).sort(), ["Aakriti Choudhary", "Edi"]);

r = await run({ tasks: CORE, credits:
  `[{ batch: "Batch#794", editor: "Edi", format: "AI-UGC", date: "2026-09-15" }]` });
check("out-of-window credit refused", find(r.payload, "Batch#794").length, 0);
check("and warned", r.payload.warnings.some((w) => w.includes("outside the sprint window")), true);

section("both blocks together");
r = await run({ tasks: CORE, overrides: '{ "Batch#901": { count: 2, clean: true } }', credits: credit });
check("override and credit coexist",
  [find(r.payload, "Batch#901").length, find(r.payload, "Batch#793").length], [2, 1]);
check("both reported",
  [r.payload.overridesApplied, r.payload.manualCredits.length], [["Batch#901"], 1]);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall green");
process.exit(failures ? 1 : 0);
