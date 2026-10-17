// =====================================================================
// IMPORT TABLE — fill the tracker from a finished table (old results).
//
// Input: a screenshot of the table (read by the AI) OR the table copied from
// Excel / Google Sheets and pasted as text (read exactly, no AI needed).
// The table may cover a whole month or just a few days: every column is
// matched to its date (e.g. "11-Dec"), shown in a preview, and only the days
// you leave ticked are written. Existing days are never wiped: by default only
// EMPTY fields are filled in; "Overwrite" replaces the fields the table has.
//
// Uses globals from app.js: state, isAdmin, sb, dateKey, MONTHS, escapeHtml,
// canonicalPlayerName, callAiVision, parseAiJson, determineLeagueByTrophies,
// saveData, renderCalendar, renderTables, remoteUpsertFights, remoteSavePlayers,
// remoteSaveLeftPlayers, bgSync, tableYear, tableMonth, parseUrlList,
// extractUrlsFromDataTransfer, urlToImageBlob.
// =====================================================================
(function(){
  "use strict";

  // ---------- pure parsing helpers (also unit-tested in node) ----------
  const MON = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11,
                sij:0, velj:1, ozu:2, tra:3, svi:4, lip:5, srp:6, kol:7, ruj:8, lis:9, stu:10, pro:11 };
  const LEAGUE = { W: "Warm-up", N: "Novice", B: "Bronze", S: "Silver", G: "Gold" };
  const strip = s => String(s == null ? "" : s).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const clean = s => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

  function mkDate(d, mo, y){
    if(d < 1 || d > 31 || mo < 0 || mo > 11) return null;
    let year = null;
    if(y){ year = +y; if(year < 100) year += 2000; }
    return { day: d, month: mo, year };
  }
  // "11-Dec", "11 Dec", "11.12.", "11/12/2025"  ->  {day, month(0-11), year|null}
  function parseDateCell(s){
    s = clean(strip(s));
    if(!s) return null;
    let m = /^(\d{1,2})\s*[-\/. ]\s*([A-Za-z]{3,9})\.?(?:\s*[-\/., ]\s*(\d{2,4}))?$/.exec(s);
    if(m){
      const mo = MON[m[2].slice(0, 3).toLowerCase()];
      return mo === undefined ? null : mkDate(+m[1], mo, m[3]);
    }
    m = /^(\d{1,2})\s*[.\/-]\s*(\d{1,2})\.?(?:\s*[.\/-]\s*(\d{2,4})\.?)?$/.exec(s);
    if(m && +m[2] >= 1 && +m[2] <= 12) return mkDate(+m[1], +m[2] - 1, m[3]);
    return null;
  }
  // "104, 45 (S)"  ->  {trophies:"104", position:"45", league:"Silver"}
  function parseStanding(s){
    const m = /^(\d+)\s*,\s*(\d+)(?:\s*\(\s*([A-Za-z])\s*\))?$/.exec(clean(s));
    if(!m) return null;
    const league = m[3] ? LEAGUE[m[3].toUpperCase()] : "";
    return { trophies: m[1], position: m[2], league: league || "" };
  }
  // "8221–2373" / "8221--2373"  ->  {our:"8221", their:"2373"}
  function parseScorePair(s){
    const m = /^(\d[\d\s.,]*?)\s*[-\u2013\u2014]+\s*(\d[\d\s.,]*)$/.exec(clean(s));
    if(!m) return null;
    return { our: m[1].replace(/[\s.,]/g, ""), their: m[2].replace(/[\s.,]/g, "") };
  }
  function normResult(s){
    const t = clean(s).toLowerCase();
    if(t === "win" || t === "won") return "WIN";
    if(t === "loss" || t === "lose" || t === "lost") return "LOSS";
    if(t === "draw") return "DRAW";
    return "";
  }

  // Excel / Sheets clipboard text -> grid (handles quoted cells with line breaks)
  function parseTSV(text){
    const rows = []; let row = [], cell = "", q = false;
    text = String(text || "");
    for(let i = 0; i < text.length; i++){
      const c = text[i];
      if(q){
        if(c === '"'){ if(text[i + 1] === '"'){ cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if(c === '"' && cell === "") q = true;
      else if(c === "\t"){ row.push(cell); cell = ""; }
      else if(c === "\n" || c === "\r"){
        if(c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    row.push(cell); rows.push(row);
    return rows;
  }

  // grid -> { titleYear, cols:[{date,result,ourStanding,opponent,oppStanding,score,ranks:{name:rank}}] }
  function colsFromGrid(grid){
    const g = grid.map(r => r.map(clean));
    const at = (r, j) => (g[r] && g[r][j]) || "";
    const nonEmpty = r => g[r].filter(c => c !== "").length;
    const dateRows = [];
    g.forEach((r, i) => {
      const dc = r.filter(c => parseDateCell(c)).length, ne = nonEmpty(i);
      if((dc >= 2 && dc >= ne - 1) || (dc === 1 && ne === 1)) dateRows.push(i);
    });
    const cols = []; let titleYear = null;
    const anyYear = /\b(20\d{2})\b/;
    dateRows.forEach((di, bi) => {
      const dayCols = g[di].map((c, j) => parseDateCell(c) ? j : -1).filter(j => j >= 0);
      const first = dayCols[0];
      const ratio = (r, test) => {
        const vals = dayCols.map(j => at(r, j)).filter(v => v !== "");
        const ok = vals.filter(test).length;
        return ok >= 1 && ok >= vals.length * 0.6;
      };
      const isResult = r => ratio(r, v => normResult(v));
      const isStanding = r => ratio(r, v => parseStanding(v));
      const isScore = r => ratio(r, v => parseScorePair(v));
      const blank = r => nonEmpty(r) === 0;
      const nameOf = r => { for(let j = first - 1; j >= 0; j--) if(at(r, j)) return at(r, j); return ""; };

      // header rows ABOVE the date row: result row and our standing row
      const prevDate = bi ? dateRows[bi - 1] : -1;
      let resultRow = -1, ourRow = -1, top = di;
      for(let r = di - 1; r > prevDate && r >= di - 4; r--){
        if(blank(r)) continue;
        if(resultRow < 0 && isResult(r)){ resultRow = r; top = r; }
        else if(ourRow < 0 && isStanding(r)){ ourRow = r; top = r; }
        else break;
      }
      // a year in the title cell (left of the day columns) near this block
      for(let r = Math.max(0, top - 1); r <= di + 3 && r < g.length && !titleYear; r++){
        for(let j = 0; j < first && !titleYear; j++){ const m = anyYear.exec(at(r, j)); if(m) titleYear = +m[1]; }
      }

      // rows BELOW: opponent name, opponent standing, score, then players
      const nextDate = bi + 1 < dateRows.length ? dateRows[bi + 1] : g.length;
      const info = { opp: -1, oppStanding: -1, score: -1 };
      const players = [];
      let inPlayers = false;
      const nextNonBlank = r => { for(let k = r + 1; k < g.length; k++) if(!blank(k)) return k; return -1; };
      for(let r = di + 1; r < nextDate; r++){
        if(blank(r)) continue;
        if(isResult(r)) break;                                   // next block's header
        const nm = nameOf(r);
        if(!inPlayers && !nm){
          if(isStanding(r)){
            if(nextNonBlank(r) === nextDate) break;               // that is the NEXT block's "our standing"
            if(info.oppStanding < 0) info.oppStanding = r;
          } else if(isScore(r)){ if(info.score < 0) info.score = r; }
          else if(info.opp < 0) info.opp = r;
          continue;
        }
        if(nm){ inPlayers = true; players.push([nm, r]); }
      }
      dayCols.forEach(j => {
        const ranks = {};
        players.forEach(([nm, r]) => { const v = at(r, j); if(/^\d+$/.test(v)) ranks[nm] = +v; });
        cols.push({
          date: at(di, j),
          result: resultRow >= 0 ? at(resultRow, j) : "",
          ourStanding: ourRow >= 0 ? at(ourRow, j) : "",
          opponent: info.opp >= 0 ? at(info.opp, j) : "",
          oppStanding: info.oppStanding >= 0 ? at(info.oppStanding, j) : "",
          score: info.score >= 0 ? at(info.score, j) : "",
          ranks
        });
      });
    });
    if(!titleYear){ for(const r of g){ for(const c of r){ const m = anyYear.exec(c); if(m && !parseDateCell(c)){ titleYear = +m[1]; break; } } if(titleYear) break; } }
    return { titleYear, cols };
  }

  // AI answer { title, columns:[...], players:[{name, ranks:{date:rank}}] } -> same shape as colsFromGrid
  function colsFromAi(p){
    const cols = (p.columns || []).map(c => ({
      date: clean(c.date), result: clean(c.result), ourStanding: clean(c.ourStanding),
      opponent: clean(c.opponent), oppStanding: clean(c.oppStanding), score: clean(c.score), ranks: {}
    }));
    const idx = new Map();
    cols.forEach((c, i) => { const d = parseDateCell(c.date); if(d) idx.set(d.day + "/" + d.month, i); });
    let lost = 0;
    (p.players || []).forEach(pl => {
      const name = clean(pl.name); if(!name) return;
      Object.entries(pl.ranks || {}).forEach(([dt, rk]) => {
        const d = parseDateCell(dt), i = d ? idx.get(d.day + "/" + d.month) : undefined;
        const n = parseInt(String(rk).replace(/\D/g, ""), 10);
        if(i === undefined || !isFinite(n)){ lost++; return; }
        cols[i].ranks[name] = n;
      });
    });
    const my = /\b(20\d{2})\b/.exec(String(p.title || ""));
    return { titleYear: my ? +my[1] : null, cols, lost };
  }

  // cols + first-column year -> one entry per real date (duplicates merged)
  function buildEntries(cols, year0, daysIn){
    const byKey = new Map(); let y = year0, prevM = -1;
    cols.forEach(c => {
      const d = parseDateCell(c.date); if(!d) return;
      let yr;
      if(d.year){ yr = d.year; y = yr; prevM = d.month; }
      else { if(prevM >= 0 && d.month < prevM) y++; prevM = d.month; yr = y; }
      if(d.day > daysIn(yr, d.month)) return;
      const e = {
        y: yr, m: d.month, d: d.day,
        result: normResult(c.result), opponent: clean(c.opponent),
        our: parseStanding(c.ourStanding), opp: parseStanding(c.oppStanding),
        score: parseScorePair(c.score), ranks: Object.assign({}, c.ranks), warn: []
      };
      const key = `${yr}-${String(d.month + 1).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
      e.key = key;
      const o = byKey.get(key);
      if(!o){ byKey.set(key, e); return; }
      ["result", "opponent", "our", "opp", "score"].forEach(k => { if(!o[k]) o[k] = e[k]; });
      Object.entries(e.ranks).forEach(([n, r]) => { if(!(n in o.ranks)) o.ranks[n] = r; });
    });
    const out = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
    out.forEach(e => {
      const rs = Object.values(e.ranks);
      if(new Set(rs).size !== rs.length) e.warn.push("two players have the same rank");
      if(e.score && e.result){
        const r = +e.score.our > +e.score.their ? "WIN" : +e.score.our < +e.score.their ? "LOSS" : "DRAW";
        if(r !== e.result) e.warn.push(`table says ${e.result}, scores say ${r}`);
      }
    });
    return out;
  }

  const has = v => v !== undefined && v !== null && String(v).trim() !== "";
  // Merge one table day into an (optional) existing fight. mode: "fill" | "overwrite"
  function mergeFight(existing, e, mode, canon){
    const ow = mode === "overwrite";
    const f = existing ? JSON.parse(JSON.stringify(existing)) : {
      opponentName: "", ourTrophies: "", ourPosition: "", ourLeague: "Warm-up",
      oppTrophies: "", oppPosition: "", oppLeague: "Warm-up",
      ourFinalScore: "", theirFinalScore: "", mapName: "", fishSet: [], playerRanks: {}, playerScores: {}
    };
    f.playerRanks = f.playerRanks || {};
    let filled = 0, diffs = 0;
    const group = (probe, vals) => {
      if(!vals) return;
      const cur = existing && has(existing[probe]);
      if(!cur){ Object.assign(f, vals); filled++; return; }
      const differs = Object.keys(vals).some(k => String(existing[k] ?? "") !== String(vals[k] ?? ""));
      if(differs){ diffs++; if(ow) Object.assign(f, vals); }
    };
    if(has(e.opponent)) group("opponentName", { opponentName: e.opponent });
    if(e.our) group("ourTrophies", { ourTrophies: e.our.trophies, ourPosition: e.our.position,
      ourLeague: e.our.league || determineLeagueByTrophies(e.our.trophies) });
    if(e.opp) group("oppTrophies", { oppTrophies: e.opp.trophies, oppPosition: e.opp.position,
      oppLeague: e.opp.league || determineLeagueByTrophies(e.opp.trophies) });
    if(e.score) group("ourFinalScore", { ourFinalScore: e.score.our, theirFinalScore: e.score.their });
    // only a WIN/LOSS word and no scores: keep the word so the day still shows its result
    if(e.result && !e.score && !has(f.ourFinalScore) && (ow || !has(f.result))){
      if(f.result !== e.result){ if(!has(f.result)) filled++; else diffs++; f.result = e.result; }
    }
    const ranks = {};
    Object.entries(e.ranks).forEach(([raw, r]) => {
      const name = canon(raw);
      ranks[name] = r;
      const exKey = Object.keys(f.playerRanks).find(k => k.toLowerCase() === name.toLowerCase());
      if(exKey === undefined){ f.playerRanks[name] = r; filled++; }
      else if(Number(f.playerRanks[exKey]) !== r){ diffs++; if(ow) f.playerRanks[exKey] = r; }
    });
    return { fight: f, filled, diffs, changed: filled > 0 || (ow && diffs > 0), ranks };
  }

  const api = { parseDateCell, parseStanding, parseScorePair, parseTSV, colsFromGrid, colsFromAi, buildEntries, mergeFight, normResult };
  if(typeof window !== "undefined") window.TableImportPure = api;
  if(typeof module !== "undefined" && module.exports) module.exports = api;
  if(typeof document === "undefined") return;

  // ---------- UI ----------
  const $ = id => document.getElementById(id);
  let raw = null;            // { titleYear, cols }
  let plan = [];             // [{ e, ex, res, checked }]
  let newNames = [];
  let ctl = null;

  const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
  const fmtDay = e => `${e.d} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][e.m]} ${e.y}`;
  const setStatus = t => { $("tiStatus").textContent = t || ""; };

  function openModal(){
    if(!isAdmin) return;
    raw = null; plan = []; newNames = [];
    $("tiPaste").value = ""; $("tiPreviewBlock").classList.add("hidden");
    $("tiYear").value = typeof tableYear === "number" ? tableYear : new Date().getFullYear();
    setStatus("");
    $("tableImportModal").classList.remove("hidden");
  }
  function closeModal(){
    if(ctl) ctl.abort();
    $("tableImportModal").classList.add("hidden");
  }

  function canonFor(raw){
    const n = String(raw).trim();
    const known = canonicalPlayerName(n);
    if(state.players.some(p => p.toLowerCase() === known.toLowerCase())) return known;
    const have = newNames.find(x => x.toLowerCase() === n.toLowerCase());
    if(have) return have;
    newNames.push(n);
    return n;
  }

  function rebuildPlan(){
    if(!raw) return;
    const year0 = parseInt($("tiYear").value, 10) || (typeof tableYear === "number" ? tableYear : new Date().getFullYear());
    const mode = $("tiMode").value;
    const prevChecked = new Map(plan.map(p => [p.e.key, p.checked]));
    newNames = [];
    const entries = buildEntries(raw.cols, year0, daysIn);
    plan = entries.map(e => {
      const ex = state.fights[e.key] || null;
      const res = mergeFight(ex, e, mode, canonFor);
      return { e, ex, res, checked: prevChecked.has(e.key) ? prevChecked.get(e.key) : res.changed };
    });
    plan.forEach(p => { if(!p.res.changed) p.checked = false; });
    renderPreview();
  }

  function renderPreview(){
    $("tiPreviewBlock").classList.remove("hidden");
    if(!plan.length){
      $("tiPreview").innerHTML = '<p class="hint">No dates found in the table. Make sure the date row (e.g. 11-Dec) is included.</p>';
      $("tiApply").disabled = true; return;
    }
    const rows = plan.map((p, i) => {
      const e = p.e, r = p.res;
      const score = e.score ? `${e.score.our}–${e.score.their}` : "";
      const result = e.result || (e.score ? (+e.score.our > +e.score.their ? "WIN" : +e.score.our < +e.score.their ? "LOSS" : "DRAW") : "");
      const nPl = Object.keys(e.ranks).length;
      let status;
      if(!p.ex) status = '<span class="ti-new">new day</span>';
      else status = `exists · fills ${r.filled}` + (r.diffs ? ` · <span class="ti-diff" title="Fields where the table differs from what is saved (${$("tiMode").value === "overwrite" ? "will be overwritten" : "kept as saved"})">${r.diffs} differ</span>` : "");
      if(!r.changed) status = (p.ex ? "exists · " : "") + "nothing to change";
      const warn = e.warn.length ? ` <span class="ti-warn" title="${escapeHtml(e.warn.join("; "))}">⚠ ${escapeHtml(e.warn.join("; "))}</span>` : "";
      return `<tr><td><input type="checkbox" data-i="${i}" ${p.checked ? "checked" : ""} ${r.changed ? "" : "disabled"}></td>
        <td>${escapeHtml(fmtDay(e))}</td><td class="${result ? "ti-" + result.toLowerCase() : ""}">${result || "—"}</td>
        <td class="left">${escapeHtml(e.opponent)}</td><td>${score}</td><td>${nPl}</td><td class="left">${status}${warn}</td></tr>`;
    }).join("");
    $("tiPreview").innerHTML = `<div class="an-table-scroll"><table class="ti-table"><thead><tr>
      <th><input type="checkbox" id="tiAll" checked></th><th>Date</th><th>Result</th><th class="left">Opponent</th><th>Score</th><th>Players</th><th class="left">Status</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
    $("tiPreview").querySelectorAll("input[data-i]").forEach(cb => cb.addEventListener("change", () => { plan[+cb.dataset.i].checked = cb.checked; updateSummary(); }));
    $("tiAll").addEventListener("change", ev => {
      plan.forEach(p => { if(p.res.changed) p.checked = ev.target.checked; });
      $("tiPreview").querySelectorAll("input[data-i]").forEach(cb => { if(!cb.disabled) cb.checked = ev.target.checked; });
      updateSummary();
    });
    updateSummary();
  }

  function usedNewNames(){
    const used = new Set();
    plan.filter(p => p.checked).forEach(p => Object.keys(p.res.ranks).forEach(n => {
      if(newNames.some(x => x.toLowerCase() === n.toLowerCase())) used.add(n);
    }));
    return [...used];
  }
  function updateSummary(){
    const n = plan.filter(p => p.checked).length, nn = usedNewNames();
    $("tiSummary").innerHTML = `${n} day(s) selected.` + (nn.length
      ? ` <b>New players</b> (not in your list yet): ${nn.map(escapeHtml).join(", ")}.` : "");
    $("tiLeftRow").classList.toggle("hidden", !nn.length);
    $("tiApply").disabled = n === 0;
    $("tiApply").textContent = n ? `Import ${n} day(s)` : "Import";
  }

  // ----- reading -----
  function gotParsed(p, note){
    raw = p;
    if(p.titleYear) $("tiYear").value = p.titleYear;
    rebuildPlan();
    setStatus(note || `Read ${p.cols.length} column(s). Check the preview below before importing.`);
  }
  function readPasted(){
    const text = $("tiPaste").value;
    if(!text.trim()) return;
    const p = colsFromGrid(parseTSV(text));
    if(!p.cols.length){ setStatus("Couldn't find a date row (like 11-Dec) in the pasted text."); $("tiPreviewBlock").classList.add("hidden"); return; }
    gotParsed(p);
  }
  async function readImages(files){
    files = Array.from(files || []).filter(f => f.type && f.type.startsWith("image/"));
    if(!files.length) return;
    if(ctl) ctl.abort();
    ctl = new AbortController();
    const signal = ctl.signal;
    $("tiReadPaste").disabled = true;
    setStatus(`Reading ${files.length} image(s) with AI...`);
    const known = state.players.length ? `Known player names (use these EXACT spellings if a name in the image matches one, even approximately): ${state.players.join(", ")}.` : "";
    const prompt = `This is a screenshot of a clan-war results table from a spreadsheet. Each COLUMN is one day. The header of every column (top to bottom) can contain: the result (WIN / LOSS / DRAW), optionally OUR standing like "104, 45 (S)", the date like "11-Dec", the opponent clan name, optionally the OPPONENT standing like "121, 21 (S)", and optionally the final score like "8221–2373". The rows below the header are PLAYERS: the first cell is the player name, and each day cell holds the player's rank that day (a number) or "-" / empty if they did not play.
${known}

You may receive several images of the same table (or of different parts of it): merge them. Each date appears once in "columns", each player once in "players".

Rules:
- Copy the date text of every column exactly as written in its header (e.g. "11-Dec"). Keep the left-to-right order.
- Use "" for any header value that is missing. Do not invent anything.
- In "ranks" include ONLY the cells that contain a number, keyed by that column's date text. Skip "-" and empty cells.
- Be careful that every number is attached to the correct column; read each player row from left to right.
- "title" = the text of the big title cell on the left (e.g. "12 - 28 DECEMBER 2025"), or "".
- Ranks and scores are plain integers (no spaces).

Return EXCLUSIVELY a valid JSON object (no markdown fences):
{"title":"","columns":[{"date":"11-Dec","result":"WIN","ourStanding":"","opponent":"moo moo","oppStanding":"","score":""}],"players":[{"name":"Astrix","ranks":{"16-Dec":2,"17-Dec":1}}]}`;
    try{
      const txt = await callAiVision(files, prompt, { signal, expectJson: true, onStatus: setStatus });
      if(signal.aborted) return;
      const p = colsFromAi(parseAiJson(txt));
      if(!p.cols.length) throw new Error("the AI found no columns in the image");
      gotParsed(p, `Read ${p.cols.length} column(s) from the image(s)` + (p.lost ? ` (${p.lost} rank cell(s) couldn't be matched to a date and were skipped)` : "") + ". AI can misread digits — check the preview, or paste the table from Excel for an exact import.");
    }catch(err){
      if(err.name === "AbortError" || signal.aborted) return;
      setStatus("Error: " + err.message);
    }finally{
      $("tiReadPaste").disabled = false;
    }
  }

  // ----- apply -----
  async function applyImport(){
    if(!isAdmin) return;
    const chosen = plan.filter(p => p.checked && p.res.changed);
    if(!chosen.length) return;
    const clan = state.ourClanName;
    const fightsByKey = {};
    chosen.forEach(p => { fightsByKey[p.e.key] = p.res.fight; });
    const playersAfter = [...state.players];
    const newUsed = usedNewNames();
    newUsed.forEach(n => { if(!playersAfter.some(x => x.toLowerCase() === n.toLowerCase())) playersAfter.push(n); });
    const markLeft = $("tiMarkLeft").checked && newUsed.length > 0;
    const leftAfter = markLeft
      ? [...state.leftPlayers, ...newUsed.filter(n => !state.leftPlayers.some(x => String(x).toLowerCase() === n.toLowerCase()))]
      : state.leftPlayers;
    const btn = $("tiApply");
    btn.disabled = true;
    if(sb){
      try{
        await remoteUpsertFights(clan, fightsByKey);
        await remoteSavePlayers(clan, playersAfter);
      }catch(err){
        console.error(err);
        alert("Couldn't save to the database: " + (err.message || err) + "\n\nNothing was changed — try again (are you still logged in?).");
        btn.disabled = false;
        return;
      }
    }
    if(clan !== state.ourClanName){ closeModal(); return; } // clan switched meanwhile (data is saved remotely)
    state.players = playersAfter;
    Object.assign(state.fights, fightsByKey);
    if(markLeft){
      state.leftPlayers = leftAfter;
      if(sb){ const list = [...leftAfter]; bgSync(() => remoteSaveLeftPlayers(clan, list)); }
    }
    saveData();
    const first = chosen[0].e;
    if(typeof tableYear === "number"){ tableYear = first.y; tableMonth = first.m; }
    if(typeof calYear === "number"){ calYear = first.y; calMonth = first.m; }
    closeModal();
    renderCalendar();
    renderTables();
  }

  // ----- wiring -----
  const importBtn = $("importTableBtn");
  if(!importBtn) return;
  importBtn.addEventListener("click", openModal);
  $("tiClose").addEventListener("click", closeModal);
  $("tiCancel").addEventListener("click", closeModal);
  $("tiApply").addEventListener("click", applyImport);
  $("tiReadPaste").addEventListener("click", readPasted);
  $("tiPaste").addEventListener("paste", () => setTimeout(readPasted, 50));
  $("tiYear").addEventListener("change", rebuildPlan);
  $("tiMode").addEventListener("change", rebuildPlan);
  $("tiImgInput").addEventListener("change", e => { const f = Array.from(e.target.files || []); e.target.value = ""; readImages(f); });
  const zone = $("tiDropZone");
  ["dragenter", "dragover"].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add("drag-over"); }));
  ["dragleave", "dragend"].forEach(ev => zone.addEventListener(ev, () => zone.classList.remove("drag-over")));
  zone.addEventListener("drop", e => {
    e.preventDefault(); zone.classList.remove("drag-over");
    const dt = e.dataTransfer;
    const files = Array.from(dt.files || []).filter(f => f.type.startsWith("image/"));
    if(files.length){ readImages(files); return; }
    // link-only drop (e.g. dragged out of Discord): collect the links, press Fetch to read them
    const urls = extractUrlsFromDataTransfer(dt);
    if(!urls.length) return;
    const inp = $("tiUrlInput");
    inp.value = [...parseUrlList(inp.value), ...urls].join(", ");
    setStatus(`${parseUrlList(inp.value).length} link(s) ready — press Fetch.`);
  });
  $("tiUrlBtn").addEventListener("click", async () => {
    const inp = $("tiUrlInput"), urls = parseUrlList(inp.value);
    if(!urls.length) return;
    setStatus(`Fetching ${urls.length} image(s) from link(s)...`);
    try{
      const blobs = await Promise.all(urls.map(urlToImageBlob));
      inp.value = "";
      await readImages(blobs);
    }catch(err){ setStatus("Error: " + err.message); }
  });
  // Ctrl+V of a screenshot anywhere in the open dialog
  document.addEventListener("paste", e => {
    if($("tableImportModal").classList.contains("hidden")) return;
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter(f => f.type.startsWith("image/"));
    if(files.length){ e.preventDefault(); readImages(files); }
  });
})();