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

// Editors excluded from the sprint (exact ClickUp usernames)
const EXCLUDE = ["MJ NEW"];

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

// Board expects one entry per round, CS-fault rounds first.
function faultsFor(rounds, csFault) {
  return [
    ...Array(csFault).fill("Brief"),
    ...Array(rounds - csFault).fill("Editor"),
  ];
}

async function fetchAllTasks(token) {
  const tasks = [];
  for (let page = 0; page < 40; page++) {
    const url =
      `https://api.clickup.com/api/v2/list/${LIST_ID}/task` +
      `?include_closed=true&subtasks=false&page=${page}`;
    const res = await fetch(url, { headers: { Authorization: token } });
    if (!res.ok) throw new Error(`ClickUp ${res.status}: ${await res.text()}`);
    const data = await res.json();
    tasks.push(...(data.tasks || []));
    if (data.last_page || !data.tasks || data.tasks.length === 0) break;
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

function mapTask(task, warnings) {
  const rtl = toMillis(fieldValue(task, F.readyToLaunch));
  if (rtl === null || rtl < WINDOW_START || rtl >= WINDOW_END) return null;

  const editorVal = fieldValue(task, F.editor);
  const editor = Array.isArray(editorVal) && editorVal.length ? editorVal[0] : null;
  if (!editor) {
    warnings.push(`${task.name}: no Editor set — excluded`);
    return null;
  }
  const rawName = editor.username || editor.email || String(editor.id);
  const editorName = NAME_MAP[rawName] || rawName;
  if (EXCLUDE.includes(rawName)) return null;

  // revision rounds = how many "Date Needs Edits" fields are filled
  const rounds = F.needEdits.reduce(
    (n, id) => n + (toMillis(fieldValue(task, id)) !== null ? 1 : 0),
    0
  );

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
  if (Array.isArray(labels)) {
    for (const l of labels) {
      const id = typeof l === "string" ? l : l && l.id;
      const nm = FORMAT_NAME[id];
      if (nm && (!format || (TIER_RANK[nm] || 0) > (TIER_RANK[format] || 0))) {
        format = nm;
      }
    }
  }

  if (VSL_OVERRIDES_HEAVY) {
    const concept = fieldValue(task, F.concept);
    const cid = concept && (typeof concept === "string" ? concept : concept.id);
    if (cid === CONCEPT_VSL_ID) format = "Voiceover"; // heaviest tier
  }

  if (!format) warnings.push(`${task.name}: no Format label — scored untiered`);

  return {
    id: task.id,
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
    const raw = await fetchAllTasks(token);
    const mapped = raw.map((t) => mapTask(t, warnings)).filter(Boolean);

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

    const tasks = mapped.map((m) => m.row);

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({
      fetchedAt: Date.now(),
      tasks,
      taskCount: tasks.length,
      scannedCount: raw.length,
      misclicksDropped,
      warnings,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}
