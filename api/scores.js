// api/scores.js — feeds the AirPods Max Sprint board
// Returns raw batch rows in the exact shape window.SprintBoard.apply() expects.
// The board does the scoring (tiers, tickets, clean logic) itself.
//
// Requires env var: CLICKUP_TOKEN  (Vercel → Settings → Environment Variables)
// NEVER commit the token to the repo.

const LIST_ID = "901517390600";

const F = {
  editor:        "4766406c-05cb-4fd3-ad8e-7f969b67a57f", // users
  format:        "9f191f7e-59f3-4b02-8491-ff759d1bc792", // labels
  concept:       "99dba62b-a4f6-4f34-a65d-b3fe7821196b", // dropdown
  readyToLaunch: "b52f8799-7bb6-4b97-a9e7-48436c5affc5", // date
  readyForEdit:  "825ebb96-7629-47b0-8454-10ce92f309e9", // date
  csFault:       "56129090-2d02-43c2-8195-c831289d23d3", // number
  needEdits: [
    "6eac1b98-2c4b-40aa-bf9a-f717e5a96844", // Date Needs Edits 1
    "fcdee4bc-64e5-4460-bf1c-cba69306dba7", // Date Needs Edits 2
    "10de6da5-9c31-4309-85df-acd27885952e", // Date Needs Edits 3
    "65a870ec-e424-45e8-b258-1e55a62bc2d0", // Date Needs Edits 4
  ],
};

// Format label ID → label name (the board matches tiers by name)
const FORMAT_NAME = {
  "6cd85943-67f9-4d70-88aa-7c5b03a6d8b6": "Animation",
  "ae6c0bae-4fab-4fe4-9a70-ced26e194a2c": "Static",
  "981020fd-a5e7-48c3-9d1d-a1bfb767e1f2": "Text-Only UGC",
  "e3a13baf-36c6-4238-bf98-706060d571c1": "Yapping-UGC",
  "6506da18-77da-4195-be0a-bb88a1c2858a": "AI-Podcast",
  "17a498a2-b685-4673-813d-76c0cd1bfbf4": "AI-UGC",
  "9ee13e07-f2f9-4d6b-bf3e-da01ec8f7508": "Native Ad",
  "f9ffdceb-ad82-4271-ac88-9c2eb5cc5f53": "Voiceover",
  "8fbf555b-5be2-4789-b220-8a4e031bd584": "Voiceover-UGC",
  "a8b819cf-1b24-4c16-9ac4-69876850ba8d": "Educational-VO",
  "0de0a600-849f-454a-afcf-f8c5836d0da9": "Talking Animation",
};

// Rank order used only to pick the heaviest label when a batch has several
const TIER_RANK = {
  "Animation": 1, "Static": 1, "Text-Only UGC": 1, "Yapping-UGC": 1,
  "AI-Podcast": 2, "AI-UGC": 2, "Native Ad": 2,
  "Voiceover": 3, "Voiceover-UGC": 3, "Educational-VO": 3, "Talking Animation": 3,
};

// Concept = VSL forces the Heavy tier regardless of Format. Set false to disable.
const VSL_OVERRIDES_HEAVY = true;
const CONCEPT_VSL_ID = "f10dcc62-5fd4-4861-9727-b653f14cfb20";

// Optional: rename a ClickUp username for display. Keys must match ClickUp exactly.
// The VALUE must match the board's roster spelling exactly too — the roster lives
// in index.html and any name that differs by even one letter shows up as a second,
// empty row on the board instead of merging into the editor's own row.
const NAME_MAP = {
  "Joshua cecil": "joshua Cecil", // ClickUp says "Joshua cecil"; roster says "joshua Cecil"
};

// Editors excluded from the sprint (exact ClickUp usernames).
// Team leads are permanently out — they are never competing.
// NOTE: keep this in step with DROP_FROM_ROSTER at the end of index.html, which
// removes the same people from the board's own roster list.
const EXCLUDE = ["MJ NEW", "Ben Schlueter", "Andrei Oboukhov"];

// --- Manual adjustments — edit these two blocks by hand ---------------------
// Keys must match the ClickUp batch name exactly. /api/scores reports
// `overridesApplied` and warns about keys that matched nothing.
//
//   "Batch#755": { date: "2026-08-03" }   score it for a different date
//   "Batch#747": { count: 2 }             counts as two batches
//   "Batch#748": { count: 2, cleanCount: 1 }  two videos, only one of them clean
//   "Batch#804": { rounds: 0 }            wipe the revision rounds
//   "Batch#717": { clean: true }          force clean / force not-clean
//   "Batch#801": { exclude: true }        drop from the sprint
//   "Batch#802": { editor: "Edi" }        reassign (also overrides EXCLUDE)
//   "Batch#803": { format: "Voiceover" }  force a tier
//
// `rounds: 0` and `clean: true` both make a batch score as clean. The
// difference is what the drill-down shows: `rounds: 0` says the revisions
// never happened, `clean: true` keeps them but blames the brief, not the editor.
//
// `count` alone duplicates a row exactly, so every copy is clean or none is.
// When one ticket holds several videos and only some came back clean, use
// `cleanCount`: that many copies are scored clean with no revisions, and the
// rest keep the rounds ClickUp recorded. It wins over `clean` if both are set.
//
// PREFER FIXING CLICKUP OVER ADDING AN OVERRIDE HERE.
// An override lives in this file, so it only ever affects this board — the
// weekly Editor Leaderboard reads ClickUp on its own and will never see it,
// which is how the two boards drift apart. Most of these keys have a ClickUp
// field that says the same thing, and a fix made there shows up on both:
//
//   clean / rounds   ->  CS Fault Revisions  (rounds that were not the
//                        editor's fault; set it equal to the round count and
//                        the batch is clean everywhere)
//   format           ->  the Format label
//   editor           ->  the Editor field
//   date             ->  Entered — Ready to Launch
//   exclude          ->  clear Entered — Ready to Launch
//
// Only `count` and `cleanCount` have no ClickUp equivalent: one ticket is one
// task, so a ticket holding several videos genuinely needs an override here.
const OVERRIDES = {
  // Two videos shipped under one batch ticket, both clean. `clean` keeps it
  // that way if a Needs Edits stamp lands on the ticket later.
  "Batch#866": { count: 2, clean: true },

  // Revision round waived by Ben — scored as if it never happened.
  "Batch#825": { rounds: 0 },

  // One revision round, confirmed with the creative strategist. The automation
  // wrote the same date into Needs Edits 1 AND 2 (and pushed Need Edits Counter
  // to 2), so both ClickUp and this API read it as two. See the duplicate-stamp
  // warning in /api/scores.
  "OSP-18": { rounds: 1 },

  // Two Voiceover videos under one ticket, both clean. `editor` is a no-op —
  // ClickUp already has Aakif on it — and `date` only moves it within the
  // window (Aug 11), which changes nothing while there is no ticket gate.
  "Batch#613": { editor: "Aakif", clean: true, format: "Voiceover", count: 2, date: "2026-08-11" },

  "Batch#768": { clean: true },

  // Two videos under one ticket for Nils, both clean. Note this is additive to
  // the manual credit below: the same batch name also counts once for Aakriti,
  // so Batch#793 appears three times on the board in total.
  "Batch#793": { clean: true, count: 2, date: "2026-08-11" },

  // Two Heavy videos under one ticket, of which one came back clean. Its
  // ClickUp label (Voiceover-UGC) is already Heavy, so the tier is left alone
  // and this scores a single clean Heavy point, not two.
  "Batch#783": { count: 2, cleanCount: 1 },

  // Revision round waived by Ben, and pinned to the Standard tier. It had no
  // Format label when the waiver went in, which scores untiered at 1.0; the
  // label has since been set to AI-UGC in ClickUp, and pinning it here means
  // clearing or changing that label can no longer quietly drop it back to 1.0
  // before the sprint closes.
  "Batch#836": { rounds: 0, format: "AI-UGC" },

  // Aakif's, two rounds recorded, both waived as not his fault.
  // Equivalent in ClickUp: set CS Fault Revisions = 2 on the task, which the
  // weekly leaderboard would pick up too. See the note above the block.
  "Batch#865": { clean: true },

  // NOTE THE LOWERCASE KEY: the ClickUp task is named "osp-20", not "OSP-20",
  // and keys must match exactly.
  // Pac's, finished with no revisions — the two Needs Edits stamps carry the
  // same date (Sun 30 Aug), the same double-stamp artefact as OSP-18. Counts as
  // two ads. Ben's rule is that OSP ads are worth 1.0 each, but its ClickUp
  // label is AI-UGC (Standard, 1.2), so the label is overridden to "OSP": the
  // board's tier table has no such name, and an unrecognised format scores
  // exactly 1.0 — giving the 2.0 total Ben asked for. Its real Ready-to-Launch
  // is Mon 31 Aug; dated back into the Aug 24-30 week as requested.
  "osp-20": { rounds: 0, count: 2, format: "OSP", date: "2026-08-30" },

  // Pac's, two videos under one ticket, already clean in ClickUp with no
  // rounds, so `count` is the only key doing work. Animation is Light, so this
  // is 2 x 1.0. Moved from Sun 30 Aug into the week starting Mon 31 Aug.
  "Batch#835": { count: 2, date: "2026-08-31" },
};

// Batches credited to an editor by hand, with no ClickUp task behind them.
// Each one counts as a clean batch at the tier named in `format`, so it is
// worth exactly what the real batch would have been worth. `date` must fall
// inside the sprint window. These are additive: they never take a batch away
// from whoever ClickUp says did the work.
const MANUAL_CREDITS = [
  {
    batch: "Batch#793",
    editor: "Aakriti Choudhary",
    format: "AI-UGC", // Standard, x1.2 — the batch's own heaviest label
    date: "2026-08-22",
    url: "https://app.clickup.com/t/86cawyxat",
    // Assigned to Aakriti by mistake and reassigned to Nils, who is editing it
    // now and keeps his own credit when it launches. Ben promised her the
    // batch anyway, so it is granted here rather than waiting on that launch.
    note: "mis-assignment, credit promised by Ben",
  },
];

// Sprint window — CEST (UTC+2) in August
const WINDOW_START = 1786312800000; // Mon Aug 10 2026 00:00 CEST
const WINDOW_END   = 1788213600000; // Tue Sep  1 2026 00:00 CEST

// --- Accidental "Needs Edits" detection -------------------------------------
// A ClickUp automation stamps "Date Needs Edits N" the moment a task enters the
// "needs edits" status. If someone drops a task in there by mistake and pulls it
// straight back out, the stamp sticks and the editor loses a clean batch for a
// revision that never happened.
//
// A real round leaves hours or days of recorded time in the status; a misclick
// leaves none. So we cross-check the stamps against ClickUp's time-in-status
// record and drop rounds that no status time backs up.
//
// NOTE ON THE THRESHOLD: ClickUp's time-in-status API reports whole MINUTES, so
// "under 10 seconds" is not expressible — the finest available test is "no
// recorded time at all", i.e. under a minute. That is a superset of the 10-second
// rule and still nowhere near a real round (a real one measured 2,445 minutes).
const NEEDS_EDITS_STATUS = "needs edits";
const MISCLICK_MAX_MINUTES = 1;

// ---------------------------------------------------------------------------
function fieldValue(task, id) {
  const f = (task.custom_fields || []).find((x) => x.id === id);
  return f ? f.value : undefined;
}

function toMillis(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function neFor(rounds) {
  return rounds >= 4 ? "3+" : String(rounds);
}

// Hand-written dates are plain days in sprint-local time (CEST).
function parseLocalDate(value, label, warnings) {
  const ms = Date.parse(String(value) + "T00:00:00+02:00");
  if (!Number.isFinite(ms)) {
    warnings.push(`${label}: could not read the date "${value}" — ignored`);
    return null;
  }
  return ms;
}

// Board expects one entry per round, CS-fault rounds first.
function faultsFor(rounds, csFault) {
  return [
    ...Array(csFault).fill("Brief"),
    ...Array(rounds - csFault).fill("Editor"),
  ];
}

// Don't drag the whole list over the wire. A batch that reaches Ready-to-Launch
// inside the sprint is necessarily touched at that moment, so anything left
// untouched through the 30 days before the window opened cannot qualify. The
// buffer is deliberately generous so a manual date override that pulls an older
// batch into the sprint still finds its task.
const UPDATED_SINCE = WINDOW_START - 30 * 24 * 60 * 60 * 1000;

const MAX_PAGES = 40;
const PAGE_CONCURRENCY = 8;

function taskPageUrl(page) {
  return (
    `https://api.clickup.com/api/v2/list/${LIST_ID}/task` +
    `?include_closed=true&subtasks=false` +
    `&date_updated_gt=${UPDATED_SINCE}&page=${page}`
  );
}

async function fetchTaskPage(token, page) {
  const res = await fetch(taskPageUrl(page), { headers: { Authorization: token } });
  if (!res.ok) throw new Error(`ClickUp ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchAllTasks(token) {
  const first = await fetchTaskPage(token, 0);
  const tasks = [...(first.tasks || [])];
  if (first.last_page || !first.tasks || first.tasks.length === 0) return tasks;

  // ClickUp does not tell us the page count up front, so pull the remainder in
  // parallel windows and stop at the first page that reports the end. Pages
  // requested past the end just come back empty, which costs one round trip
  // instead of a serial walk.
  for (let page = 1; page < MAX_PAGES; ) {
    const batch = [];
    for (let i = 0; i < PAGE_CONCURRENCY && page + i < MAX_PAGES; i++) {
      batch.push(fetchTaskPage(token, page + i));
    }
    const pages = await Promise.all(batch);
    let done = false;
    for (const p of pages) {
      const list = p.tasks || [];
      tasks.push(...list);
      if (p.last_page || list.length === 0) done = true;
    }
    page += batch.length;
    if (done) break;
  }
  return tasks;
}

// ClickUp has shipped two shapes for this: total_time as an object with
// by_minute, and a flat total_time_minutes. Returns null when neither parses —
// callers must treat null as "unknown", never as zero.
function statusMinutes(entry) {
  if (!entry) return null;
  const tt = entry.total_time;
  if (tt && typeof tt === "object" && tt.by_minute !== undefined) {
    const n = Number(tt.by_minute);
    return Number.isFinite(n) ? n : null;
  }
  const m = Number(entry.total_time_minutes);
  return Number.isFinite(m) ? m : null;
}

// How long each task sat in the "needs edits" status, keyed by task id.
// Only called for the handful of in-window tasks that carry a stamp.
async function fetchNeedsEditsMinutes(token, ids) {
  const out = new Map();
  const isNeedsEdits = (s) =>
    String(s || "").trim().toLowerCase() === NEEDS_EDITS_STATUS;

  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const qs = chunk.map((id) => `task_ids[]=${encodeURIComponent(id)}`).join("&");
    const res = await fetch(
      `https://api.clickup.com/api/v2/task/bulk_time_in_status/task_ids?${qs}`,
      { headers: { Authorization: token } }
    );
    if (!res.ok) {
      throw new Error(`ClickUp time-in-status ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    const byId = data.tasks || data; // endpoint has shipped both shapes

    for (const id of Object.keys(byId)) {
      const entry = byId[id] || {};
      const history = Array.isArray(entry.status_history) ? entry.status_history : [];
      const cur = entry.current_status;

      let minutes = 0;
      let seen = false;
      let unparsed = false;
      for (const h of history) {
        if (!isNeedsEdits(h.status)) continue;
        seen = true;
        const m = statusMinutes(h);
        if (m === null) unparsed = true;
        else minutes += m;
      }
      // history normally already includes the current status; only add it
      // separately when it does not, so the time is never counted twice.
      if (!seen && cur && isNeedsEdits(cur.status)) {
        seen = true;
        const m = statusMinutes(cur);
        if (m === null) unparsed = true;
        else minutes += m;
      }

      out.set(id, {
        minutes,
        unparsed,
        // Did we understand this task's payload at all? If the shape changes
        // again we must not read "no needs-edits time" out of a blank object.
        understood: history.length > 0 || !!cur,
      });
    }
  }
  return out;
}

function mapTask(task, warnings, usedOverrides, duplicateStamps, unmappedFormats, editorAudit) {
  const ov = OVERRIDES[task.name] || null;
  if (ov) usedOverrides.add(task.name);
  if (ov && ov.exclude) return null;

  // The date override runs before the window test — moving a batch into or out
  // of the sprint is the whole point of it.
  let rtl = toMillis(fieldValue(task, F.readyToLaunch));
  if (ov && ov.date) {
    const moved = parseLocalDate(ov.date, task.name, warnings);
    if (moved !== null) rtl = moved;
  }
  if (rtl === null || rtl < WINDOW_START || rtl >= WINDOW_END) return null;

  const editorVal = fieldValue(task, F.editor);
  const editorList = Array.isArray(editorVal) ? editorVal.filter(Boolean) : [];
  const editor = editorList.length ? editorList[0] : null;
  const rawName = editor ? editor.username || editor.email || String(editor.id) : null;

  // The Editor field allows several people. We score the first one, which means
  // a batch with two editors set silently credits one and drops the other —
  // worth surfacing rather than quietly picking.
  if (editorList.length > 1) {
    const all = editorList.map((u) => u.username || u.email || String(u.id));
    warnings.push(
      `${task.name}: ${all.length} editors set (${all.join(", ")}) — credited to ${all[0]} only`
    );
    editorAudit.push({ batch: task.name, credited: all[0], alsoSet: all.slice(1) });
  }

  let editorName;
  if (ov && ov.editor) {
    editorName = ov.editor; // a deliberate reassignment beats EXCLUDE
  } else if (!rawName) {
    warnings.push(`${task.name}: no Editor set — excluded`);
    return null;
  } else if (EXCLUDE.includes(rawName)) {
    return null;
  } else {
    editorName = NAME_MAP[rawName] || rawName;
  }

  // revision rounds = how many "Date Needs Edits" fields are filled
  const stamps = F.needEdits
    .map((id) => toMillis(fieldValue(task, id)))
    .filter((v) => v !== null);
  const rounds = stamps.length;

  // A duplicated automation run writes the SAME date into two of the four
  // fields, so one round reads as two. The fields are day-granular, so two
  // genuine rounds on one day look identical too — hence a flag for a human
  // rather than an automatic correction.
  const distinctStamps = new Set(stamps).size;
  if (distinctStamps < rounds) {
    const corrected = !!(ov && (ov.rounds !== undefined || ov.clean !== undefined));
    warnings.push(
      `${task.name}: ${rounds} Needs Edits stamps but only ${distinctStamps} distinct ` +
        `date(s) — one round may have been stamped twice. ` +
        (corrected
          ? `An override already corrects this one.`
          : `Still counted as ${rounds}: confirm the real number and set ` +
            `OVERRIDES["${task.name}"] = { rounds: N }`)
    );
    duplicateStamps.push({
      batch: task.name,
      stamps: rounds,
      distinctDates: distinctStamps,
      overridden: !!(ov && ov.rounds !== undefined),
    });
  }

  const csRaw = fieldValue(task, F.csFault);
  let csFault =
    csRaw === undefined || csRaw === null || csRaw === "" ? 0 : Number(csRaw);
  if (!Number.isFinite(csFault) || csFault < 0) csFault = 0;
  if (csFault > rounds) {
    warnings.push(`${task.name}: CS Fault (${csFault}) > rounds (${rounds}) — capped`);
    csFault = rounds;
  }

  // format label name — take the heaviest if several are set
  const labels = fieldValue(task, F.format);
  let format = "";
  const unknownLabels = [];
  if (Array.isArray(labels)) {
    for (const l of labels) {
      const id = typeof l === "string" ? l : l && l.id;
      if (!id) continue;
      const nm = FORMAT_NAME[id];
      if (!nm) {
        unknownLabels.push(id);
        continue;
      }
      if (!format || (TIER_RANK[nm] || 0) > (TIER_RANK[format] || 0)) format = nm;
    }
  }

  if (VSL_OVERRIDES_HEAVY) {
    const concept = fieldValue(task, F.concept);
    const cid = concept && (typeof concept === "string" ? concept : concept.id);
    if (cid === CONCEPT_VSL_ID) format = "Voiceover"; // heaviest tier
  }

  if (ov && ov.format) format = ov.format;

  // "untiered" is scored at 1.0, so a label the tier table has never heard of
  // quietly costs a Heavy batch half a point. Say which case it is.
  if (!format) {
    if (unknownLabels.length) {
      warnings.push(
        `${task.name}: Format label ${unknownLabels.join(", ")} is not in FORMAT_NAME ` +
          `— scored untiered at 1.0`
      );
      unmappedFormats.push({ batch: task.name, editor: editorName, labelIds: unknownLabels });
    } else {
      warnings.push(`${task.name}: no Format label — scored untiered`);
    }
  }

  return {
    id: task.id,
    ov,
    rounds,
    csFault,
    row: {
      batch: task.name,
      editor: editorName,
      format,
      ne: neFor(rounds),
      faults: faultsFor(rounds, csFault),
      rtl,
      rfe: toMillis(fieldValue(task, F.readyForEdit)),
      // extra field, ignored by the board — the drill-down panel links to it
      url: task.url || `https://app.clickup.com/t/${task.id}`,
    },
  };
}

export default async function handler(req, res) {
  const token = process.env.CLICKUP_TOKEN;
  if (!token) return res.status(500).json({ error: "CLICKUP_TOKEN is not set" });

  try {
    const warnings = [];
    const usedOverrides = new Set();
    const duplicateStamps = [];
    const unmappedFormats = [];
    const editorAudit = [];
    const raw = await fetchAllTasks(token);
    const mapped = raw.map((t) => mapTask(t, warnings, usedOverrides, duplicateStamps, unmappedFormats, editorAudit)).filter(Boolean);

    // Cross-check stamped rounds against recorded time in "needs edits".
    let misclicksDropped = 0;
    const stamped = mapped.filter((m) => m.rounds > 0);
    if (stamped.length) {
      try {
        const minutes = await fetchNeedsEditsMinutes(
          token,
          stamped.map((m) => m.id)
        );
        for (const m of stamped) {
          const info = minutes.get(m.id);
          // Only ever drop a round on a positive reading. Anything unknown —
          // task missing from the response, payload we could not parse — leaves
          // the stamp alone, because wrongly clearing a real round hands an
          // editor points they did not earn.
          if (!info || !info.understood || info.unparsed) continue;
          if (info.minutes >= MISCLICK_MAX_MINUTES) continue; // real round(s)
          // Every stamp on this task is unbacked by status time.
          warnings.push(
            `${m.row.batch}: ${m.rounds} Needs Edits stamp(s) but ${info.minutes}m ` +
              `recorded in "${NEEDS_EDITS_STATUS}" — treated as accidental, not counted`
          );
          m.rounds = 0;
          m.csFault = 0;
          m.row.ne = neFor(0);
          m.row.faults = [];
          misclicksDropped++;
        }
      } catch (err) {
        // Never let this break the board: fall back to the raw stamps.
        warnings.push(
          `Could not check time-in-status, revision stamps left as-is: ${
            err.message || err
          }`
        );
      }
    }

    // Forced clean/not-clean runs after the misclick pass so a hand-set verdict
    // is never quietly undone by it.
    const tasks = [];
    for (const m of mapped) {
      const ov = m.ov;

      if (ov && ov.rounds !== undefined) {
        const n = Math.floor(Number(ov.rounds));
        if (Number.isFinite(n) && n >= 0) {
          m.rounds = n;
          m.csFault = Math.min(m.csFault, n);
          m.row.ne = neFor(n);
          m.row.faults = faultsFor(n, m.csFault);
        } else {
          warnings.push(`${m.row.batch}: rounds "${ov.rounds}" is not a whole number ≥ 0 — ignored`);
        }
      }

      if (ov && typeof ov.clean === "boolean") {
        if (ov.clean) {
          m.row.faults = Array(m.rounds).fill("Brief");
        } else {
          if (m.rounds === 0) {
            m.rounds = 1;
            m.row.ne = neFor(1);
          }
          m.row.faults = Array(m.rounds).fill("Editor");
        }
      }

      let copies = 1;
      if (ov && ov.count !== undefined) {
        const n = Math.floor(Number(ov.count));
        if (Number.isFinite(n) && n >= 1) copies = n;
        else warnings.push(`${m.row.batch}: count "${ov.count}" is not a whole number ≥ 1 — ignored`);
      }

      // How many of those copies were actually clean. The rest keep the rounds
      // ClickUp recorded, so one ticket can hold a clean video and a messy one.
      let cleanCopies = 0;
      if (ov && ov.cleanCount !== undefined) {
        const k = Math.floor(Number(ov.cleanCount));
        if (!Number.isFinite(k) || k < 0) {
          warnings.push(`${m.row.batch}: cleanCount "${ov.cleanCount}" is not a whole number ≥ 0 — ignored`);
        } else {
          cleanCopies = Math.min(k, copies);
          if (k > copies) {
            warnings.push(
              `${m.row.batch}: cleanCount ${k} is more than the ${copies} cop${copies === 1 ? "y" : "ies"} — capped`
            );
          }
        }
      }

      // Snapshot before the loop: cleaning the first copy mutates m.row, and
      // cloning from it after that would hand every later copy the cleaned
      // version instead of the batch's real rounds.
      const pristine = { ...m.row, faults: m.row.faults.slice() };
      for (let i = 0; i < copies; i++) {
        const row = i === 0 ? m.row : { ...pristine, faults: pristine.faults.slice() };
        if (i < cleanCopies) {
          row.ne = neFor(0);
          row.faults = [];
        }
        tasks.push(row);
      }
    }

    for (const key of Object.keys(OVERRIDES)) {
      if (!usedOverrides.has(key)) {
        warnings.push(`OVERRIDES["${key}"] matched no batch in ClickUp — check the name`);
      }
    }

    // Hand-granted batches, added on top of whatever ClickUp reported.
    const creditsApplied = [];
    for (const c of MANUAL_CREDITS) {
      const rtl = parseLocalDate(c.date, `manual credit ${c.batch}`, warnings);
      if (rtl === null) continue;
      if (rtl < WINDOW_START || rtl >= WINDOW_END) {
        warnings.push(
          `manual credit ${c.batch} (${c.editor}): ${c.date} is outside the sprint window — not counted`
        );
        continue;
      }
      tasks.push({
        batch: c.batch,
        editor: c.editor,
        format: c.format || "",
        ne: "0",
        faults: [],
        rtl,
        rfe: null, // no real edit time — keep it out of the speed tiebreak
        url: c.url || null,
      });
      creditsApplied.push(`${c.batch} → ${c.editor}${c.note ? ` (${c.note})` : ""}`);
    }

    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
    return res.status(200).json({
      fetchedAt: Date.now(),
      tasks,
      taskCount: tasks.length,
      scannedCount: raw.length,
      misclicksDropped,
      overridesApplied: [...usedOverrides],
      duplicateStamps,
      unmappedFormats,
      editorAudit,
      manualCredits: creditsApplied,
      warnings,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}
