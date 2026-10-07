/* ===========================================================
   Carp Diem — Clan War Tracker (AI Vision OCR: Gemini / OpenAI / Anthropic / OpenRouter)
   Static, client-side (GitHub Pages friendly).
   All data lives in localStorage. Images are processed via the AI provider you pick in Settings.
=========================================================== */

// ---------------------------------------------------------
// SUPABASE CONFIG — paste your project URL + anon (public) key here.
// (Supabase dashboard → Project Settings → API.) The anon key is meant to
// be public; what protects the data is Row Level Security (see
// supabase_setup.sql): everyone can READ, only the admin user can WRITE.
// AI API keys (Gemini, OpenAI, …) are NEVER sent to Supabase — they stay in this browser.
// Leave the placeholders as they are to run in local-only mode (old behaviour).
// ---------------------------------------------------------
const SUPABASE_URL = "https://qkdijflbuvsztoaxaljt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_lbqtPmtDI1dBws388aNgcA_5oC7FaxE";

const ADMIN_EMAIL = "admin@deepsessions.local";

const SUPABASE_CONFIGURED = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(SUPABASE_URL) &&
  !SUPABASE_URL.includes("YOUR-PROJECT") && !SUPABASE_ANON_KEY.startsWith("YOUR-");
if(SUPABASE_CONFIGURED && !window.supabase){
  console.warn("supabase-js failed to load (blocked CDN?) — running in local-only mode.");
}
const sb = (SUPABASE_CONFIGURED && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
// Local-only mode (no Supabase) = everything editable, like before.
let isAdmin = !sb;
document.body.classList.toggle("is-admin", isAdmin);

const STORAGE_KEY = "cd_tracker_v2";
const BACKUP_KEY = "cd_tracker_v2_pre_supabase";
const MONTHS = ["January","February","March","April","May","June",
                    "July","August","September","October","November","December"];
const DAYLABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

// ---------------------------------------------------------
// Data layer — multiple clans, each with its own players/fights.
// Persisted shape: { activeClan, geminiApiKey, clans: { name: {players, fights} } }
// Older single-clan saves (no "clans" key) are migrated in automatically.
// ---------------------------------------------------------
function loadClanStore(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      if(parsed && parsed.clans && typeof parsed.clans === "object"){
        return parsed;
      }
      if(parsed && parsed.fights){
        // Old single-clan format — migrate into the new multi-clan store,
        // keeping all existing data under the clan name that was active.
        const clanName = (parsed.ourClanName || "Carp Diem").trim() || "Carp Diem";
        return {
          activeClan: clanName,
          geminiApiKey: parsed.geminiApiKey || "",
          clans: { [clanName]: { players: parsed.players || [], fights: parsed.fights || {} } }
        };
      }
    }
  }catch(e){ console.warn("Could not parse stored data", e); }
  return { activeClan: "Carp Diem", geminiApiKey: "", clans: { "Carp Diem": { players: [], fights: {} } } };
}

let clanStore = loadClanStore();
if(!clanStore.clans[clanStore.activeClan]){
  clanStore.activeClan = Object.keys(clanStore.clans)[0] || "Carp Diem";
  if(!clanStore.clans[clanStore.activeClan]) clanStore.clans[clanStore.activeClan] = { players: [], fights: {} };
}

// `state` mirrors the ACTIVE clan's data, in the same shape the rest of the
// app already expects (state.players / state.fights). Switching clans swaps
// these references out; saveData() writes the active clan back into the store.
let state = {
  ourClanName: clanStore.activeClan,
  // AI settings (local only): keys per provider, chosen provider, model overrides
  aiProvider: clanStore.aiProvider || "gemini",
  aiKeys: Object.assign({}, clanStore.aiKeys || {}, (clanStore.aiKeys && clanStore.aiKeys.gemini) ? {} : { gemini: clanStore.geminiApiKey || "" }),
  aiModels: Object.assign({}, clanStore.aiModels || {}),
  aiFallback: clanStore.aiFallback !== false,
  players: clanStore.clans[clanStore.activeClan].players,
  fights: clanStore.clans[clanStore.activeClan].fights
};

function saveData(){
  clanStore.activeClan = state.ourClanName;
  clanStore.geminiApiKey = state.aiKeys.gemini || ""; // kept for older saves
  clanStore.aiProvider = state.aiProvider;
  clanStore.aiKeys = state.aiKeys;
  clanStore.aiModels = state.aiModels;
  clanStore.aiFallback = state.aiFallback;
  clanStore.clans[state.ourClanName] = { players: state.players, fights: state.fights };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(clanStore));
}


// ---------------------------------------------------------
// SUPABASE layer. Tables: cw_clans(name, players jsonb), cw_fights(clan, date_key, data jsonb).
// localStorage stays as an offline cache of whatever was last loaded.
// ---------------------------------------------------------
function setSyncStatus(msg, isErr){
  const el = document.getElementById("syncStatus");
  if(!el) return;
  el.textContent = msg || "";
  el.classList.toggle("err", !!isErr);
}
function requireAdminRemote(){
  if(!sb) return false;
  if(!isAdmin) throw new Error("Not logged in as admin.");
  return true;
}
async function remoteLoadAll(){
  const clansRes = await sb.from("cw_clans").select("name,players");
  if(clansRes.error) throw clansRes.error;
  const clans = {};
  (clansRes.data || []).forEach(r => {
    clans[r.name] = { players: Array.isArray(r.players) ? r.players : [], fights: {} };
  });
  // PostgREST returns max 1000 rows per request, so page through.
  const PAGE = 1000;
  for(let from = 0; ; from += PAGE){
    const res = await sb.from("cw_fights").select("clan,date_key,data")
      .order("clan").order("date_key").range(from, from + PAGE - 1);
    if(res.error) throw res.error;
    (res.data || []).forEach(r => {
      if(!clans[r.clan]) clans[r.clan] = { players: [], fights: {} };
      clans[r.clan].fights[r.date_key] = r.data;
    });
    if(!res.data || res.data.length < PAGE) break;
  }
  return clans;
}
async function remoteUpsertFights(clan, fightsByKey){
  if(!requireAdminRemote()) return;
  const now = new Date().toISOString();
  const rows = Object.entries(fightsByKey).map(([date_key, data]) => ({ clan, date_key, data, updated_at: now }));
  for(let i = 0; i < rows.length; i += 200){
    const { error } = await sb.from("cw_fights").upsert(rows.slice(i, i + 200), { onConflict: "clan,date_key" });
    if(error) throw error;
  }
}
async function remoteDeleteFight(clan, dateKey){
  if(!requireAdminRemote()) return;
  const { error } = await sb.from("cw_fights").delete().eq("clan", clan).eq("date_key", dateKey);
  if(error) throw error;
}
async function remoteSavePlayers(clan, players){
  if(!requireAdminRemote()) return;
  const { error } = await sb.from("cw_clans").upsert({ name: clan, players }, { onConflict: "name" });
  if(error) throw error;
}
async function remoteAddClan(name){
  if(!requireAdminRemote()) return;
  const { error } = await sb.from("cw_clans").upsert({ name, players: [] }, { onConflict: "name", ignoreDuplicates: true });
  if(error) throw error;
}
async function remoteDeleteClan(name){
  if(!requireAdminRemote()) return;
  const { error } = await sb.from("cw_clans").delete().eq("name", name); // fights cascade
  if(error) throw error;
}
// Pushes one clan completely. prune=true also removes remote fights that no
// longer exist locally (used for "Delete All Data").
async function remoteSyncClan(clan, data, { prune = false } = {}){
  if(!requireAdminRemote()) return;
  await remoteSavePlayers(clan, data.players);
  await remoteUpsertFights(clan, data.fights);
  if(prune){
    const { data: remoteKeys, error } = await sb.from("cw_fights").select("date_key").eq("clan", clan);
    if(error) throw error;
    const stale = (remoteKeys || []).map(r => r.date_key).filter(k => !(k in data.fights));
    for(let i = 0; i < stale.length; i += 100){
      const del = await sb.from("cw_fights").delete().eq("clan", clan).in("date_key", stale.slice(i, i + 100));
      if(del.error) throw del.error;
    }
  }
}
// Background write for non-critical edits (players list etc.): shows a
// small status in the top bar instead of blocking the UI.
let syncStatusTimer = null;
async function bgSync(fn){
  if(!sb || !isAdmin) return;
  setSyncStatus("Syncing…");
  try{
    await fn();
    setSyncStatus("Synced ✓");
    clearTimeout(syncStatusTimer);
    syncStatusTimer = setTimeout(()=>{
      const el = document.getElementById("syncStatus");
      if(el && el.textContent === "Synced ✓") setSyncStatus("");
    }, 2500);
  }catch(err){
    console.error(err);
    setSyncStatus("⚠ Sync failed: " + (err.message || err) + " — change is only saved locally.", true);
  }
}

// Loads everything from Supabase into the in-memory store (+ local cache).
async function loadFromRemote(){
  if(!sb) return;
  setSyncStatus("Loading…");
  try{
    const remoteClans = await remoteLoadAll();
    const names = Object.keys(remoteClans);
    if(!names.length){
      const hasLocal = Object.values(clanStore.clans).some(c => c.players.length || Object.keys(c.fights).length);
      setSyncStatus(hasLocal
        ? "Database is empty — showing local data. Admin: Settings → “Push local data to Supabase”."
        : "Database is empty.");
      return;
    }
    // One-time safety copy of the old local-only data before we replace it.
    try{
      if(!localStorage.getItem(BACKUP_KEY)){
        const raw = localStorage.getItem(STORAGE_KEY);
        if(raw) localStorage.setItem(BACKUP_KEY, raw);
      }
    }catch(e){}
    const prevActive = state.ourClanName;
    clanStore.clans = remoteClans;
    const active = remoteClans[prevActive] ? prevActive : names.sort((a,b)=> a.localeCompare(b))[0];
    state.ourClanName = active;
    state.players = remoteClans[active].players;
    state.fights = remoteClans[active].fights;
    normalizePlayerCasing();
    saveData();
    document.getElementById("clanNameLabel").textContent = state.ourClanName;
    renderClanSelect();
    renderCalendar();
    renderTables();
    renderPlayersManageList();
    setSyncStatus("");
  }catch(err){
    console.error(err);
    setSyncStatus("⚠ Couldn't reach the database (" + (err.message || err) + ") — showing cached data.", true);
  }
}

// Admin session handling -----------------------------------
async function refreshAdmin(){
  if(!sb){ isAdmin = true; applyAdminUi(); return; }
  let email = "";
  let ok = false;
  try{
    const { data } = await sb.auth.getSession();
    const session = data && data.session;
    if(session){
      email = session.user.email || "";
      const res = await sb.rpc("cw_is_admin");
      ok = !res.error && res.data === true;
    }
  }catch(err){ console.warn("Admin check failed", err); }
  isAdmin = ok;
  applyAdminUi(email);
}
function applyAdminUi(email){
  document.body.classList.toggle("is-admin", isAdmin);
  const btn = document.getElementById("loginBtn");
  if(btn){
    btn.style.display = sb ? "" : "none";
    btn.textContent = isAdmin ? "Logout" : "🔑 Admin login";
  }
  if(typeof renderPlayersManageList === "function") renderPlayersManageList();
}

// Switches the active clan: persists whatever's currently loaded, then
// swaps state.players/state.fights over to the target clan's own dataset.
function switchClan(name){
  if(!clanStore.clans[name] || name === state.ourClanName) return;
  saveData();
  state.ourClanName = name;
  state.players = clanStore.clans[name].players;
  state.fights = clanStore.clans[name].fights;
  normalizePlayerCasing();
  saveData();
  document.getElementById("clanNameLabel").textContent = state.ourClanName;
  renderClanSelect();
  renderCalendar();
  renderTables();
  renderPlayersManageList();
}

// Creates a brand-new, empty clan dataset (or just switches to it if a
// clan with that name — case-insensitively — already exists).
async function addClan(nameRaw){
  const name = (nameRaw || "").trim();
  if(!name) return;
  const existing = Object.keys(clanStore.clans).find(c => c.toLowerCase() === name.toLowerCase());
  if(existing){
    switchClan(existing);
    return;
  }
  if(sb){
    try{ await remoteAddClan(name); }
    catch(err){ alert("Couldn't create the clan in the database: " + (err.message || err)); return; }
  }
  clanStore.clans[name] = { players: [], fights: {} };
  switchClan(name);
}

// Permanently removes a clan (and all its players/fights) from the store.
// Refuses to delete the last remaining clan — there always has to be one.
async function deleteClan(name){
  if(!clanStore.clans[name]) return;
  const names = Object.keys(clanStore.clans);
  if(names.length <= 1) {
    alert("Can't delete the only remaining clan.");
    return;
  }
  if(sb){
    try{ await remoteDeleteClan(name); }
    catch(err){ alert("Couldn't delete the clan in the database: " + (err.message || err)); return; }
  }
  const wasActive = name === state.ourClanName;
  delete clanStore.clans[name];
  if(wasActive){
    const nextName = Object.keys(clanStore.clans).sort((a,b)=> a.localeCompare(b))[0];
    state.ourClanName = nextName;
    state.players = clanStore.clans[nextName].players;
    state.fights = clanStore.clans[nextName].fights;
    document.getElementById("clanNameLabel").textContent = state.ourClanName;
    normalizePlayerCasing();
  }
  saveData();
  renderClanSelect();
  renderCalendar();
  renderTables();
  renderPlayersManageList();
}

function renderClanSelect(){
  const sel = document.getElementById("clanSelect");
  if(!sel) return;
  sel.innerHTML = "";
  Object.keys(clanStore.clans).sort((a,b)=> a.localeCompare(b)).forEach(name=>{
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if(name === state.ourClanName) opt.selected = true;
    sel.appendChild(opt);
  });
}

normalizePlayerCasing();

// One-time (runs safely every load, but only writes if something actually
// changed) cleanup that merges player-name casing variants that can happen
// because the AI OCR isn't 100% consistent between calls (e.g. "MAIIKOL" vs
// "Maiikol"). Without this, older saved fights can end up with a rank stored
// under a differently-cased key than the one shown in the players list,
// which makes the table show "-" for a day that actually has data.
function normalizePlayerCasing(){
  const canonicalByLower = {};
  state.players.forEach(p=>{
    const key = p.toLowerCase();
    if(!(key in canonicalByLower)) canonicalByLower[key] = p;
  });
  Object.values(state.fights).forEach(f=>{
    if(!f.playerRanks) return;
    Object.keys(f.playerRanks).forEach(name=>{
      const key = name.toLowerCase();
      if(!(key in canonicalByLower)) canonicalByLower[key] = name;
    });
  });

  let changed = false;

  const seen = new Set();
  const newPlayers = [];
  state.players.forEach(p=>{
    const key = p.toLowerCase();
    if(!seen.has(key)){
      seen.add(key);
      newPlayers.push(canonicalByLower[key]);
    }
  });
  Object.values(canonicalByLower).forEach(p=>{
    const key = p.toLowerCase();
    if(!seen.has(key)){
      seen.add(key);
      newPlayers.push(p);
    }
  });
  if(JSON.stringify(newPlayers) !== JSON.stringify(state.players)){
    state.players = newPlayers;
    changed = true;
  }

  Object.values(state.fights).forEach(f=>{
    if(!f.playerRanks) return;
    const rebuilt = {};
    Object.entries(f.playerRanks).forEach(([name, rank])=>{
      const canon = canonicalByLower[name.toLowerCase()] || name;
      if(!(canon in rebuilt)) rebuilt[canon] = rank;
      if(canon !== name) changed = true;
    });
    f.playerRanks = rebuilt;
    if(f.playerScores){
      const rebuiltScores = {};
      Object.entries(f.playerScores).forEach(([name, sc])=>{
        const canon = canonicalByLower[name.toLowerCase()] || name;
        if(!(canon in rebuiltScores)) rebuiltScores[canon] = sc;
      });
      f.playerScores = rebuiltScores;
    }
  });

  if(changed) saveData();
}

function dateKey(y,m,d){
  return `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}
function formatShortDate(y,m,d){
  return `${d}-${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m]}`;
}
function ensurePlayer(name){
  if(!name) return;
  name = name.trim();
  if(!name) return;
  if(!state.players.some(p => p.toLowerCase() === name.toLowerCase())){
    state.players.push(name);
  }
}
// If a player with the same name (case-insensitive) already exists,
// return that EXACT existing spelling/casing instead of the new one.
// This stops the AI's slightly inconsistent OCR casing between calls
// (e.g. "MAIIKOL" one time, "Maiikol" another) from splitting a single
// player into two different playerRanks keys and showing "-" for days
// that actually have data, just stored under a differently-cased name.
function canonicalPlayerName(name){
  if(!name) return name;
  name = name.trim();
  const existing = state.players.find(p => p.toLowerCase() === name.toLowerCase());
  return existing || name;
}

// ---------------------------------------------------------
// Tab switching
// ---------------------------------------------------------
document.querySelectorAll(".tab-btn").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p=>p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-"+btn.dataset.tab).classList.add("active");
    if(btn.dataset.tab === "table") renderTables();
    if(btn.dataset.tab === "calendar") renderCalendar();
    if(btn.dataset.tab === "settings") renderPlayersManageList();
  });
});

// ---------------------------------------------------------
// CALENDAR
// ---------------------------------------------------------
const today = new Date();
let calYear = today.getFullYear();
let calMonth = today.getMonth();

document.getElementById("prevMonth").addEventListener("click", ()=>{
  calMonth--; if(calMonth<0){calMonth=11;calYear--;}
  renderCalendar();
});
document.getElementById("nextMonth").addEventListener("click", ()=>{
  calMonth++; if(calMonth>11){calMonth=0;calYear++;}
  renderCalendar();
});

function renderCalendar(){
  document.getElementById("calMonthLabel").textContent = `${MONTHS[calMonth]} ${calYear}.`;
  const grid = document.getElementById("calendarGrid");
  grid.innerHTML = "";
  DAYLABELS.forEach(l=>{
    const el = document.createElement("div");
    el.className = "cal-daylabel";
    el.textContent = l;
    grid.appendChild(el);
  });

  const firstDay = new Date(calYear, calMonth, 1);
  let startOffset = firstDay.getDay() - 1;
  if(startOffset < 0) startOffset = 6;
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();

  for(let i=0;i<startOffset;i++){
    const el = document.createElement("div");
    el.className = "cal-day empty";
    grid.appendChild(el);
  }

  for(let d=1; d<=daysInMonth; d++){
    const key = dateKey(calYear, calMonth, d);
    const fight = state.fights[key];
    const cell = document.createElement("div");
    cell.className = "cal-day";
    if(fight){
      const res = computeResult(fight);
      if(res) cell.classList.add(res.toLowerCase());
    }
    const num = document.createElement("div");
    num.className = "cal-daynum";
    num.textContent = d;
    cell.appendChild(num);

    if(fight){
      const res = computeResult(fight);
      if(res){
        const badge = document.createElement("div");
        badge.className = "cal-result-badge";
        badge.textContent = res;
        cell.appendChild(badge);
      }
      if(fight.opponentName){
        const opp = document.createElement("div");
        opp.className = "cal-score";
        opp.textContent = fight.opponentName;
        cell.appendChild(opp);
      }
    }
    cell.addEventListener("click", ()=>{
      if(!isAdmin && !state.fights[key]) return; // viewers can only open days that have data
      openEditor(calYear, calMonth, d);
    });
    grid.appendChild(cell);
  }
}

function computeResult(fight){
  if(fight.ourFinalScore != null && fight.theirFinalScore != null &&
     fight.ourFinalScore !== "" && fight.theirFinalScore !== ""){
    return Number(fight.ourFinalScore) >= Number(fight.theirFinalScore) ? "WIN" : "LOSS";
  }
  return null;
}

// ---------------------------------------------------------
// TABLE VIEW
// ---------------------------------------------------------
let tableYear = today.getFullYear();
let tableMonth = today.getMonth();

document.getElementById("prevMonthTable").addEventListener("click", ()=>{
  tableMonth--; if(tableMonth<0){tableMonth=11;tableYear--;}
  renderTables();
});
document.getElementById("nextMonthTable").addEventListener("click", ()=>{
  tableMonth++; if(tableMonth>11){tableMonth=0;tableYear++;}
  renderTables();
});

function renderTables(){
  document.getElementById("tableMonthLabel").textContent = `${MONTHS[tableMonth]} ${tableYear}.`;
  const container = document.getElementById("tablesContainer");
  container.innerHTML = "";

  const daysInMonth = new Date(tableYear, tableMonth+1, 0).getDate();
  const half1 = []; 
  const half2 = []; 
  for(let d=1; d<=daysInMonth; d++){
    const key = dateKey(tableYear, tableMonth, d);
    if(!state.fights[key]) continue;
    if(d<=14) half1.push(d); else half2.push(d);
  }

  if(half1.length===0 && half2.length===0){
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "No fights entered for this month.";
    container.appendChild(p);
    return;
  }

  if(half1.length) buildTableBlock(container, `1 - 14 ${MONTHS[tableMonth].toUpperCase()} ${tableYear}`, half1);
  if(half2.length){
    // Second half's end label reflects the LAST DAY THAT ACTUALLY HAS DATA
    // (not the calendar length of the month) — e.g. if the last fight
    // entered this month was on the 28th, the header reads "15 - 28".
    const lastEnteredDay = half2[half2.length - 1];
    buildTableBlock(container, `15 - ${lastEnteredDay} ${MONTHS[tableMonth].toUpperCase()} ${tableYear}`, half2);
  }
}

// Fixed pixel widths for the table columns, shared by every table block so
// that a block with fewer entered days still lines up visually with one
// that has more (columns no longer shrink/grow based on content).
const TABLE_FIRST_COL_WIDTH = 110;
const TABLE_DAY_COL_WIDTH = 60;

function buildTableBlock(container, title, days){
  const wrap = document.createElement("div");
  wrap.className = "table-block-wrap";

  const toolbar = document.createElement("div");
  toolbar.className = "table-block-toolbar";
  const pngBtn = document.createElement("button");
  pngBtn.className = "secondary";
  pngBtn.textContent = "Export PNG";
  toolbar.appendChild(pngBtn);
  wrap.appendChild(toolbar);

  const table = document.createElement("table");
  table.className = "tracker-table";

  const colgroup = document.createElement("colgroup");
  const firstCol = document.createElement("col");
  firstCol.style.width = TABLE_FIRST_COL_WIDTH + "px";
  colgroup.appendChild(firstCol);
  days.forEach(()=>{
    const col = document.createElement("col");
    col.style.width = TABLE_DAY_COL_WIDTH + "px";
    colgroup.appendChild(col);
  });
  table.appendChild(colgroup);

  const dayKeys = days.map(d => dateKey(tableYear, tableMonth, d));
  const fights = dayKeys.map(k => state.fights[k]);

  // Row 1: blank corner + WIN/LOSS badges
  const rowResult = document.createElement("tr");
  rowResult.className = "row-result";
  rowResult.appendChild(cornerCell(""));
  fights.forEach((f,i)=>{
    const res = computeResult(f);
    const td = document.createElement("td");
    td.className = "clickable " + (res==="WIN"?"result-win":res==="LOSS"?"result-loss":"");
    td.textContent = res || "—";
    td.addEventListener("click", ()=>{
      const [y,m,d] = dayKeys[i].split("-").map(Number);
      openEditor(y, m-1, d);
    });
    rowResult.appendChild(td);
  });
  table.appendChild(rowResult);

  // Row 2: title cell (rowspan 4, covers our-standing / date / opp-name /
  // opp-standing rows — matches the reference tables) + our standing
  const rowOurStanding = document.createElement("tr");
  rowOurStanding.className = "row-ourstanding";
  const titleTd = document.createElement("td");
  titleTd.className = "table-block-title";
  titleTd.rowSpan = 4;
  titleTd.textContent = title;
  rowOurStanding.appendChild(titleTd);
  fights.forEach(f=>{
    const td = document.createElement("td");
    td.textContent = fmtStanding(f.ourTrophies, f.ourPosition, f.ourLeague);
    rowOurStanding.appendChild(td);
  });
  table.appendChild(rowOurStanding);

  // Rows 3-5: date / opponent name / opponent standing — no first cell,
  // since the title cell's rowspan already covers that column here.
  appendRowNoFirstCell(table, "row-date", days.map(d=> formatShortDate(tableYear,tableMonth,d)));
  appendRowNoFirstCell(table, "row-oppname", fights.map(f=> f.opponentName || ""));
  appendRowNoFirstCell(table, "row-oppstanding", fights.map(f=> fmtStanding(f.oppTrophies,f.oppPosition,f.oppLeague)));

  // Row 6: final score, blank first cell, bold with divider below
  appendPlainRow(table, "row-score", "", fights.map(f=>{
    if(f.ourFinalScore==null || f.ourFinalScore==="" ) return "";
    return `${f.ourFinalScore}--${f.theirFinalScore}`;
  }));

  const sortedPlayers = [...state.players].sort((a,b)=> a.localeCompare(b));
  sortedPlayers.forEach(player=>{
    const tr = document.createElement("tr");
    const nameTd = document.createElement("td");
    nameTd.className = "player-name";
    nameTd.textContent = player;
    tr.appendChild(nameTd);
    fights.forEach((f)=>{
      const td = document.createElement("td");
      if(f.playerRanks && Object.prototype.hasOwnProperty.call(f.playerRanks, player)){
        td.textContent = f.playerRanks[player];
      } else {
        td.textContent = "-";
      }
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });

  wrap.appendChild(table);
  container.appendChild(wrap);

  pngBtn.addEventListener("click", async ()=>{
    const originalLabel = pngBtn.textContent;
    pngBtn.textContent = "Exporting…";
    pngBtn.disabled = true;
    try{
      const canvas = await html2canvas(table, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true
      });
      const safeTitle = title.replace(/\s+/g, "_");
      const link = document.createElement("a");
      link.download = `carp-diem-${MONTHS[tableMonth]}-${tableYear}-${safeTitle}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    }catch(err){
      alert("PNG export failed: " + err.message);
    }finally{
      pngBtn.textContent = originalLabel;
      pngBtn.disabled = false;
    }
  });
}

function cornerCell(text){
  const th = document.createElement("th");
  th.className = "corner";
  th.textContent = text;
  return th;
}
function appendPlainRow(table, cls, firstLabel, values){
  const tr = document.createElement("tr");
  tr.className = cls;
  const first = document.createElement("td");
  first.className = "player-name";
  first.textContent = firstLabel;
  tr.appendChild(first);
  values.forEach(v=>{
    const td = document.createElement("td");
    td.textContent = v;
    tr.appendChild(td);
  });
  table.appendChild(tr);
}
// Same as appendPlainRow, but skips the first (label) cell entirely —
// used for rows that sit underneath the rowspan-ed title cell.
function appendRowNoFirstCell(table, cls, values){
  const tr = document.createElement("tr");
  tr.className = cls;
  values.forEach(v=>{
    const td = document.createElement("td");
    td.textContent = v;
    tr.appendChild(td);
  });
  table.appendChild(tr);
}
function leagueInitial(league){
  if(!league) return "";
  return league.charAt(0).toUpperCase(); // Warm-up→W, Novice→N, Bronze→B, Silver→S, Gold→G
}
function fmtStanding(trophies, position, league){
  if(trophies==null || trophies==="" ) return "";
  return `${trophies},${position}(${leagueInitial(league)})`;
}

// ---------------------------------------------------------
// EXPORT / IMPORT
// ---------------------------------------------------------
document.getElementById("exportBtn").addEventListener("click", ()=>{
  const exportObj = {
    ourClanName: state.ourClanName,
    players: state.players,
    fights: state.fights
  };
  const blob = new Blob([JSON.stringify(exportObj, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `carp-diem-${state.ourClanName || "tracker"}-data.json`;
  a.click();
  URL.revokeObjectURL(url);
});
document.getElementById("importFile").addEventListener("change", (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async ()=>{
    try{
      const imported = JSON.parse(reader.result);
      const unionPlayers = (a, b)=>{
        const out = [...a];
        b.forEach(n=>{ if(!out.some(x => x.toLowerCase() === String(n).toLowerCase())) out.push(n); });
        return out;
      };
      if(imported && imported.clans && typeof imported.clans === "object"){
        if(sb){
          // Database mode: import MERGES into the database (never wipes it).
          if(!isAdmin){ alert("Log in as admin to import."); return; }
          setSyncStatus("Importing…");
          for(const [name, c] of Object.entries(imported.clans)){
            const cur = clanStore.clans[name];
            const data = {
              players: unionPlayers(cur ? cur.players : [], c.players || []),
              fights: Object.assign({}, cur ? cur.fights : {}, c.fights || {})
            };
            await remoteSyncClan(name, data);
          }
          await loadFromRemote();
          alert("Data imported (merged) into the database.");
          return;
        }
        // Local-only: replace the whole store.
        clanStore = imported;
        if(!clanStore.clans[clanStore.activeClan]) clanStore.activeClan = Object.keys(clanStore.clans)[0];
        state.ourClanName = clanStore.activeClan;
        state.players = clanStore.clans[state.ourClanName].players;
        state.fights = clanStore.clans[state.ourClanName].fights;
        normalizePlayerCasing();
        saveData();
        renderClanSelect();
        document.getElementById("clanNameLabel").textContent = state.ourClanName;
        renderTables();
        renderCalendar();
        renderPlayersManageList();
        alert("Data imported.");
      } else if(imported && imported.fights){
        if(sb){
          if(!isAdmin){ alert("Log in as admin to import."); return; }
          state.players = unionPlayers(state.players, imported.players || []);
          state.fights = Object.assign({}, state.fights, imported.fights || {});
          normalizePlayerCasing();
          saveData();
          setSyncStatus("Importing…");
          await remoteSyncClan(state.ourClanName, { players: state.players, fights: state.fights });
          await loadFromRemote();
          alert(`Data merged into "${state.ourClanName}" in the database.`);
          return;
        }
        // Single-clan export — imports into the CURRENTLY active clan.
        state.players = imported.players || [];
        state.fights = imported.fights || {};
        normalizePlayerCasing();
        saveData();
        renderTables();
        renderCalendar();
        renderPlayersManageList();
        alert(`Data imported into "${state.ourClanName}".`);
      } else {
        alert("Invalid JSON file.");
      }
    }catch(err){
      setSyncStatus("⚠ Import failed: " + (err.message || err), true);
      alert("Error importing file: "+(err.message || err));
    }
  };
  reader.readAsText(file);
});

// ---------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------
document.getElementById("clanSelect").addEventListener("change", (e)=>{
  switchClan(e.target.value);
});
document.getElementById("deleteClanBtn").addEventListener("click", ()=>{
  const name = document.getElementById("clanSelect").value;
  if(!name) return;
  if(confirm(`Delete clan "${name}" and all its players/fight history? This cannot be undone.`)){
    deleteClan(name);
  }
});
document.getElementById("addClanBtn").addEventListener("click", ()=>{
  const input = document.getElementById("newClanNameInput");
  addClan(input.value);
  input.value = "";
});
document.getElementById("newClanNameInput").addEventListener("keydown", (e)=>{
  if(e.key === "Enter"){
    e.preventDefault();
    document.getElementById("addClanBtn").click();
  }
});
renderClanSelect();

// ---- AI provider settings (everything here stays in this browser) ----
const aiProviderSel = document.getElementById("aiProvider");
const aiKeyInput = document.getElementById("aiApiKey");
const aiModelInput = document.getElementById("aiModel");
const aiFallbackChk = document.getElementById("aiFallback");
function renderAiSettings(){
  const prov = state.aiProvider;
  const info = AI_PROVIDERS[prov];
  aiProviderSel.value = prov;
  aiKeyInput.value = state.aiKeys[prov] || "";
  aiModelInput.value = state.aiModels[prov] || "";
  aiModelInput.placeholder = info.defaultModel;
  aiFallbackChk.checked = state.aiFallback;
  document.getElementById("aiKeyLabel").textContent = `${info.label} API key:`;
  document.getElementById("aiKeyHint").textContent = info.hint;
}
aiProviderSel.addEventListener("change", ()=>{ state.aiProvider = aiProviderSel.value; renderAiSettings(); });
// Live-apply (so OCR works even if you forget to press Save); "Save Settings" persists.
aiKeyInput.addEventListener("input", ()=>{ state.aiKeys[state.aiProvider] = aiKeyInput.value.trim(); });
aiModelInput.addEventListener("input", ()=>{ state.aiModels[state.aiProvider] = aiModelInput.value.trim(); });
aiFallbackChk.addEventListener("change", ()=>{ state.aiFallback = aiFallbackChk.checked; });

document.getElementById("saveSettingsBtn").addEventListener("click", ()=>{
  state.aiKeys[state.aiProvider] = aiKeyInput.value.trim();
  state.aiModels[state.aiProvider] = aiModelInput.value.trim();
  state.aiFallback = aiFallbackChk.checked;
  saveData();
  alert("Saved.");
});
document.getElementById("clanNameLabel").textContent = state.ourClanName || "Carp Diem";

document.getElementById("wipeBtn").addEventListener("click", ()=>{
  if(confirm(`Are you sure you want to delete ALL data for "${state.ourClanName}"? This cannot be undone.`)){
    const clanName = state.ourClanName;
    state.players = [];
    state.fights = {};
    saveData();
    renderCalendar();
    renderTables();
    renderPlayersManageList();
    bgSync(()=> remoteSyncClan(clanName, { players: [], fights: {} }, { prune: true }));
    alert("All data deleted.");
  }
});

// One-time migration: push data that only lives in this browser (from the
// old localStorage-only version) up to Supabase.
function readLocalBackupClans(){
  try{
    const raw = localStorage.getItem(BACKUP_KEY);
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    if(parsed && parsed.clans) return parsed.clans;
    if(parsed && parsed.fights){
      const n = (parsed.ourClanName || "Carp Diem").trim() || "Carp Diem";
      return { [n]: { players: parsed.players || [], fights: parsed.fights || {} } };
    }
  }catch(e){}
  return null;
}
document.getElementById("pushLocalBtn").addEventListener("click", async ()=>{
  if(!sb || !isAdmin){ alert("Log in as admin first."); return; }
  const src = readLocalBackupClans() || clanStore.clans;
  const names = Object.keys(src);
  const fightCount = names.reduce((n, c)=> n + Object.keys(src[c].fights || {}).length, 0);
  if(!names.length || !fightCount && !names.some(c => (src[c].players||[]).length)){
    alert("There's no local data to push.");
    return;
  }
  if(!confirm(`Push ${names.length} clan(s) / ${fightCount} fight day(s) from this browser to the database?\n\nDays that already exist in the database with the same date get overwritten by this browser's version.`)) return;
  setSyncStatus("Pushing…");
  try{
    for(const name of names){
      await remoteSyncClan(name, { players: src[name].players || [], fights: src[name].fights || {} });
    }
    await loadFromRemote();
    alert("Local data pushed to the database.");
  }catch(err){
    setSyncStatus("⚠ Push failed: " + (err.message || err), true);
    alert("Push failed: " + (err.message || err));
  }
});

// ---------------------------------------------------------
// KNOWN PLAYERS management (Settings tab)
// ---------------------------------------------------------
function renderPlayersManageList(){
  const container = document.getElementById("playersManageList");
  if(!container) return;
  container.innerHTML = "";
  const sorted = [...state.players].sort((a,b)=> a.localeCompare(b));
  if(sorted.length === 0){
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "No players yet — they'll appear here automatically once you save a fight, or add one manually below.";
    container.appendChild(p);
    return;
  }
  sorted.forEach(name=>{
    const row = document.createElement("div");
    row.className = "player-manage-row";

    const input = document.createElement("input");
    input.type = "text";
    input.value = name;
    input.disabled = !isAdmin;
    input.addEventListener("change", ()=> renamePlayer(name, input.value));

    const delBtn = document.createElement("button");
    delBtn.className = "row-del admin-only";
    delBtn.title = "Remove player";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", ()=> deletePlayer(name));

    row.appendChild(input);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
}

// Renames a player everywhere: the roster AND every saved fight's
// playerRanks key. If the new name matches (case-insensitively) a
// DIFFERENT existing player, the two are merged instead of creating
// a duplicate entry.
function renamePlayer(oldName, newNameRaw){
  const newName = (newNameRaw || "").trim();
  if(!newName || newName === oldName){
    renderPlayersManageList();
    return;
  }

  const collision = state.players.find(p => p.toLowerCase() === newName.toLowerCase() && p !== oldName);
  const targetName = collision || newName;

  state.players = state.players.filter(p => p !== oldName);
  if(!state.players.some(p => p.toLowerCase() === targetName.toLowerCase())){
    state.players.push(targetName);
  }

  const changedKeys = [];
  Object.entries(state.fights).forEach(([key, f])=>{
    let touched = false;
    if(f.playerRanks && Object.prototype.hasOwnProperty.call(f.playerRanks, oldName)){
      const rank = f.playerRanks[oldName];
      delete f.playerRanks[oldName];
      if(!(targetName in f.playerRanks)){
        f.playerRanks[targetName] = rank;
      }
      touched = true;
    }
    if(f.playerScores && Object.prototype.hasOwnProperty.call(f.playerScores, oldName)){
      const sc = f.playerScores[oldName];
      delete f.playerScores[oldName];
      if(!(targetName in f.playerScores)) f.playerScores[targetName] = sc;
      touched = true;
    }
    if(touched) changedKeys.push(key);
  });

  saveData();
  renderPlayersManageList();
  renderTables();

  const clan = state.ourClanName, players = [...state.players], changed = {};
  changedKeys.forEach(k => { changed[k] = state.fights[k]; });
  bgSync(async ()=>{
    await remoteSavePlayers(clan, players);
    await remoteUpsertFights(clan, changed);
  });
}

function deletePlayer(name){
  if(!confirm(`Remove "${name}" from the known players list?\n\nTheir already-saved per-day results stay in your data, but their row will disappear from the Table view unless you add them back with the exact same name.`)) return;
  state.players = state.players.filter(p => p !== name);
  saveData();
  renderPlayersManageList();
  renderTables();
  const clan = state.ourClanName, players = [...state.players];
  bgSync(()=> remoteSavePlayers(clan, players));
}

document.getElementById("addKnownPlayerBtn").addEventListener("click", ()=>{
  const input = document.getElementById("newPlayerNameInput");
  const name = input.value.trim();
  if(!name) return;
  ensurePlayer(name);
  saveData();
  input.value = "";
  renderPlayersManageList();
  renderTables();
  const clan = state.ourClanName, players = [...state.players];
  bgSync(()=> remoteSavePlayers(clan, players));
});
document.getElementById("newPlayerNameInput").addEventListener("keydown", (e)=>{
  if(e.key === "Enter"){
    e.preventDefault();
    document.getElementById("addKnownPlayerBtn").click();
  }
});

// ---------------------------------------------------------
// EDITOR MODAL
// ---------------------------------------------------------
let editorKey = null; 
let editorFight = null;

// Every AI job belongs to the "session" of the currently open day. Closing
// or switching the day cancels the session: in-flight requests are aborted,
// retry countdowns stop, and late results are ignored.
let aiSessionId = 0;
let aiAbortController = new AbortController();
function cancelAiSession(){
  aiSessionId++;
  aiAbortController.abort();
  aiAbortController = new AbortController();
}

// Tracks how many AI calls are currently in flight for the open
// day, so the Save button stays disabled with a spinner until every
// upload has actually finished being read — prevents saving over an
// in-progress OCR result.
let aiProcessingCount = 0;
function setSaveButtonBusy(busy, reset=false){
  const btn = document.getElementById("saveFightBtn");
  if(!btn) return;
  if(reset){
    aiProcessingCount = 0;
  } else if(busy){
    aiProcessingCount++;
  } else {
    aiProcessingCount = Math.max(0, aiProcessingCount - 1);
  }
  const isBusy = aiProcessingCount > 0;
  btn.disabled = isBusy;
  btn.classList.toggle("is-loading", isBusy);
}

function openEditor(y, m, d){
  cancelAiSession();
  editorKey = dateKey(y,m,d);
  const existing = state.fights[editorKey];
  editorFight = existing ? JSON.parse(JSON.stringify(existing)) : {
    opponentName:"", ourTrophies:"", ourPosition:"", ourLeague:"Warm-up",
    oppTrophies:"", oppPosition:"", oppLeague:"Warm-up",
    ourFinalScore:"", theirFinalScore:"",
    playerRanks:{}, playerScores:{}
  };

  document.getElementById("editorDateLabel").textContent =
    `${d}. ${MONTHS[m]} ${y}.`;

  document.getElementById("ourTrophies").value = editorFight.ourTrophies || "";
  document.getElementById("ourPosition").value = editorFight.ourPosition || "";
  document.getElementById("ourLeague").value = editorFight.ourLeague || "Warm-up";
  document.getElementById("opponentName").value = editorFight.opponentName || "";
  document.getElementById("oppTrophies").value = editorFight.oppTrophies || "";
  document.getElementById("oppPosition").value = editorFight.oppPosition || "";
  document.getElementById("oppLeague").value = editorFight.oppLeague || "Warm-up";
  document.getElementById("ourFinalScore").value = editorFight.ourFinalScore ?? "";
  document.getElementById("theirFinalScore").value = editorFight.theirFinalScore ?? "";
  
  document.getElementById("beforeOcrStatus").textContent = "";
  document.getElementById("afterOcrStatus").textContent = "";

  renderPlayerRows();
  updateResultPreview();
  setSaveButtonBusy(false, true); // reset to idle for this fresh open

  // Viewers (not logged in as admin) get a read-only view.
  const readOnly = !isAdmin;
  document.querySelectorAll("#editorModal .modal-body input, #editorModal .modal-body select, #editorModal .modal-body button")
    .forEach(el => { el.disabled = readOnly; });

  document.getElementById("editorModal").classList.remove("hidden");
}
function closeEditorModal(){
  cancelAiSession();
  setSaveButtonBusy(false, true);
  document.getElementById("beforeOcrStatus").textContent = "";
  document.getElementById("afterOcrStatus").textContent = "";
  document.getElementById("editorModal").classList.add("hidden");
}
document.getElementById("closeEditor").addEventListener("click", closeEditorModal);

function renderPlayerRows(){
  const tbody = document.getElementById("playerRows");
  tbody.innerHTML = "";
  const entries = Object.entries(editorFight.playerRanks || {})
    .sort((a,b)=> (Number(a[1])||999) - (Number(b[1])||999));
  const scores = editorFight.playerScores || {};
  entries.forEach(([name, rank])=> addPlayerRow(name, rank, scores[name] ?? ""));
  updateScoreCheck();
}
function addPlayerRow(name="", rank="", score=""){
  const tbody = document.getElementById("playerRows");
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" inputmode="numeric" class="rankInput" value="${rank}"></td>
    <td><input type="text" class="nameInput" value="${escapeHtml(name)}" placeholder="Player name"></td>
    <td><input type="text" inputmode="numeric" class="scoreInput" value="${score}" placeholder="score"></td>
    <td><button class="row-del" title="Delete row">✕</button></td>
  `;
  tr.querySelector(".row-del").addEventListener("click", ()=>{ tr.remove(); updateScoreCheck(); });
  tbody.appendChild(tr);
  updateScoreCheck();
}
document.getElementById("playerRows").addEventListener("input", updateScoreCheck);
document.getElementById("addPlayerRow").addEventListener("click", ()=> addPlayerRow());

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

["ourFinalScore","theirFinalScore"].forEach(id=>{
  document.getElementById(id).addEventListener("input", updateResultPreview);
});
function updateResultPreview(){
  const our = document.getElementById("ourFinalScore").value;
  const their = document.getElementById("theirFinalScore").value;
  const el = document.getElementById("resultPreview");
  if(our==="" || their===""){
    el.textContent = "—";
    el.className = "badge";
  } else {
    const win = Number(our) >= Number(their);
    el.textContent = win ? "WIN" : "LOSS";
    el.className = "badge " + (win ? "win" : "loss");
  }
  updateScoreCheck();
}

// "8 290" / "8,290" / "1.744" -> 8290 / 1744. Returns null if empty/invalid.
function parseScoreVal(v){
  if(v === null || v === undefined) return null;
  const t = String(v).replace(/[\s\u00a0,.]/g, "");
  if(t === "" || !/^-?\d+$/.test(t)) return null;
  return Number(t);
}
// Only the TOP 5 players (by rank) count towards the clan's final score,
// so the check adds up just those and compares with the AI-read final score.
const SCORE_COUNTING_PLAYERS = 5;
function updateScoreCheck(){
  const el = document.getElementById("scoreCheck");
  if(!el) return;
  const rows = Array.from(document.querySelectorAll("#playerRows tr")).map(tr => ({
    rank: parseScoreVal(tr.querySelector(".rankInput").value),
    score: parseScoreVal(tr.querySelector(".scoreInput").value)
  }));
  // top N by rank (rows without a rank go last)
  const top = rows
    .filter(r => r.rank !== null && r.rank <= SCORE_COUNTING_PLAYERS)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, SCORE_COUNTING_PLAYERS);
  const withScore = top.filter(r => r.score !== null);
  if(!withScore.length){
    el.textContent = "";
    el.className = "score-check";
    return;
  }
  const sum = withScore.reduce((n, r) => n + r.score, 0);
  const fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const ourFinal = parseScoreVal(document.getElementById("ourFinalScore").value);
  const label = `Σ top ${withScore.length} players`;
  let msg, cls;
  if(ourFinal === null){
    msg = `${label} = ${fmt(sum)} — enter our final score to compare.`;
    cls = "score-check warn";
  } else if(sum === ourFinal){
    msg = `✅ ${label} = ${fmt(sum)} matches our final score ${fmt(ourFinal)} — OCR looks consistent.`;
    cls = "score-check ok";
  } else {
    const diff = ourFinal - sum;
    const hint = diff > 0
      ? "a player is probably missing or a score was read too low."
      : "a score was probably read too high, or the final score was read wrong.";
    msg = `⚠️ ${label} = ${fmt(sum)} but our final score is ${fmt(ourFinal)} (difference ${diff > 0 ? "+" : "−"}${fmt(Math.abs(diff))}) — ${hint}`;
    cls = "score-check bad";
  }
  el.textContent = msg;
  el.className = cls;
}

document.getElementById("saveFightBtn").addEventListener("click", async ()=>{
  if(!isAdmin) return;
  const btn = document.getElementById("saveFightBtn");
  const clan = state.ourClanName;
  const key = editorKey;
  const fight = {
    opponentName: document.getElementById("opponentName").value.trim(), 
    ourTrophies: document.getElementById("ourTrophies").value,
    ourPosition: document.getElementById("ourPosition").value,
    ourLeague: document.getElementById("ourLeague").value,
    oppTrophies: document.getElementById("oppTrophies").value,
    oppPosition: document.getElementById("oppPosition").value,
    oppLeague: document.getElementById("oppLeague").value,
    ourFinalScore: document.getElementById("ourFinalScore").value,
    theirFinalScore: document.getElementById("theirFinalScore").value,
    playerRanks: {},
    playerScores: {}
  };
  const playersAfter = [...state.players];
  document.querySelectorAll("#playerRows tr").forEach(tr=>{
    const rawName = tr.querySelector(".nameInput").value.trim();
    const rank = tr.querySelector(".rankInput").value;
    if(rawName && rank!==""){
      const name = playersAfter.find(p => p.toLowerCase() === rawName.toLowerCase()) || rawName;
      fight.playerRanks[name] = Number(rank);
      const sc = parseScoreVal(tr.querySelector(".scoreInput").value);
      if(sc !== null) fight.playerScores[name] = sc;
      if(!playersAfter.some(p => p.toLowerCase() === name.toLowerCase())) playersAfter.push(name);
    }
  });

  // Database first: if it fails the modal stays open and nothing is lost.
  if(sb){
    btn.disabled = true;
    try{
      await remoteUpsertFights(clan, { [key]: fight });
      await remoteSavePlayers(clan, playersAfter);
    }catch(err){
      console.error(err);
      alert("Couldn't save to the database: " + (err.message || err) + "\n\nNothing was changed — try again (are you still logged in?).");
      btn.disabled = aiProcessingCount > 0;
      return;
    }
    btn.disabled = aiProcessingCount > 0;
  }
  if(clan !== state.ourClanName) return; // clan was switched meanwhile (data is saved remotely)
  state.players = playersAfter;
  state.fights[key] = fight;
  saveData();
  closeEditorModal();
  renderCalendar();
  renderTables();
});
document.getElementById("deleteFightBtn").addEventListener("click", async ()=>{
  if(!isAdmin) return;
  if(!confirm("Delete data for this day?")) return;
  const clan = state.ourClanName, key = editorKey;
  if(sb){
    try{ await remoteDeleteFight(clan, key); }
    catch(err){ alert("Couldn't delete in the database: " + (err.message || err)); return; }
  }
  if(clan !== state.ourClanName) return;
  delete state.fights[key];
  saveData();
  closeEditorModal();
  renderCalendar();
  renderTables();
});

// Fetches an image from a direct URL (e.g. a Discord CDN attachment link)
// and returns it as a Blob, usable anywhere a File is used below.
// Note: only works for direct image links (ending in the image itself,
// like a Discord "Copy Image Address" link) — not a link to a Discord
// message/channel. Also requires the host to allow cross-origin fetches;
// Discord's CDN does, but not every image host will.
async function urlToImageBlob(url) {
  let response;
  try {
    response = await fetch(url, { mode: "cors" });
  } catch (err) {
    throw new Error(`Couldn't fetch image from link (blocked or invalid URL): ${url}`);
  }
  if (!response.ok) {
    throw new Error(`Couldn't fetch image from link (HTTP ${response.status}): ${url}`);
  }
  const blob = await response.blob();
  if (!blob.type || !blob.type.startsWith("image/")) {
    throw new Error(`Link didn't return an image file: ${url}`);
  }
  return blob;
}

// Parses a comma/newline separated list of URLs typed into one of the
// "paste image link(s)" boxes into a clean array of non-empty strings.
function parseUrlList(raw) {
  return raw
    .split(/[\n,]/)
    .map(s => s.trim())
    .filter(Boolean);
}

// Extracts image URL(s) out of a drag-and-drop event. Dragging an image
// straight out of a Discord message (in-browser) doesn't hand over an
// actual file — it hands over the image's URL as text, in one of a few
// possible formats depending on the browser, so we check all of them.
function extractUrlsFromDataTransfer(dt) {
  const urls = [];

  const uriList = dt.getData("text/uri-list");
  if (uriList) {
    uriList.split(/\r?\n/).forEach(l => { if (l && !l.startsWith("#")) urls.push(l.trim()); });
  }

  if (!urls.length) {
    const plain = dt.getData("text/plain");
    if (plain) {
      const matches = plain.match(/https?:\/\/\S+/g);
      if (matches) urls.push(...matches);
    }
  }

  if (!urls.length) {
    const html = dt.getData("text/html");
    if (html) {
      const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (match) urls.push(match[1]);
    }
  }

  // Strip a trailing ">" or quote html sometimes leaves behind.
  return urls.map(u => u.replace(/["'>]+$/, "")).filter(Boolean);
}

// Wires up a drop zone: dropped images from local disk are queued straight
// away; dropped Discord/browser images (URL only, no real file) get their
// link appended into the paired URL input so they go through "Fetch".
function setupDropZone(zoneId, urlInputId, runFn) {
  const zone = document.getElementById(zoneId);
  const urlInput = document.getElementById(urlInputId);

  ["dragenter", "dragover"].forEach(evt => {
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.add("drag-over");
    });
  });
  ["dragleave", "dragend"].forEach(evt => {
    zone.addEventListener(evt, () => zone.classList.remove("drag-over"));
  });

  zone.addEventListener("drop", async (e) => {
    e.preventDefault();
    zone.classList.remove("drag-over");

    const dt = e.dataTransfer;

    // Real image file(s) dropped straight from disk — run OCR immediately.
    const files = Array.from(dt.files || []).filter(f => f.type.startsWith("image/"));
    if (files.length) {
      await runFn(files);
      return;
    }

    // Otherwise it's a link-only drop (e.g. dragged out of Discord) — append
    // it to the URL field so multiple drops just pile up comma-separated.
    const urls = extractUrlsFromDataTransfer(dt);
    if (!urls.length) return;
    const existing = parseUrlList(urlInput.value);
    urlInput.value = [...existing, ...urls].join(", ");
  });
}

// Helper for converting a file to Base64
async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = error => reject(error);
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------
// GEMINI AI API call (with automatic retry on rate limits / server overload)
// ---------------------------------------------------------

function makeAbortError(){
  const e = new Error("Cancelled");
  e.name = "AbortError";
  return e;
}

// Waits `ms` milliseconds, calling onTick once a second with the number of
// whole seconds remaining. Rejects with an AbortError as soon as `signal`
// is aborted (e.g. the day editor was closed), so retries stop immediately.
function waitWithCountdown(ms, onTick, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(makeAbortError()); return; }
    let remaining = Math.round(ms / 1000);
    if (onTick) onTick(remaining);
    if (remaining <= 0) { resolve(); return; }
    let interval = null;
    const onAbort = () => { clearInterval(interval); reject(makeAbortError()); };
    interval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(interval);
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve();
      } else if (onTick) {
        onTick(remaining);
      }
    }, 1000);
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

// ---------------------------------------------------------
// AI providers. All of them are called straight from the browser with the
// user's own key. To add another provider, add an entry here (request
// builder + response parser) and an <option> in index.html.
// ---------------------------------------------------------
const AI_PROVIDERS = {
  gemini: {
    label: "Google Gemini",
    defaultModel: "gemini-flash-lite-latest",
    hint: "Free tier available — create a key at aistudio.google.com/apikey.",
    build(key, model, b64, mime, prompt){
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        headers: { "Content-Type": "application/json" },
        body: { contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }], generationConfig: { temperature: 0 } }
      };
    },
    parse(data){
      const t = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
      return t && t[0] ? t[0].text : null;
    }
  },
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-4o-mini",
    hint: "Paid (needs credit on your account) — platform.openai.com/api-keys. Any vision-capable model works.",
    build(key, model, b64, mime, prompt){
      return {
        url: "https://api.openai.com/v1/chat/completions",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: { model, messages: [{ role: "user", content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }
        ] }] }
      };
    },
    parse(data){ return data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : null; }
  },
  anthropic: {
    label: "Anthropic (Claude)",
    defaultModel: "claude-haiku-4-5-20251001",
    hint: "Paid — console.anthropic.com. Any Claude model with vision works.",
    build(key, model, b64, mime, prompt){
      return {
        url: "https://api.anthropic.com/v1/messages",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: { model, max_tokens: 2000, temperature: 0, messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mime, data: b64 } },
          { type: "text", text: prompt }
        ] }] }
      };
    },
    parse(data){ return data.content && data.content[0] ? data.content[0].text : null; }
  },
  openrouter: {
    label: "OpenRouter",
    defaultModel: "openai/gpt-4o-mini",
    hint: "One key for many models (some free ones, marked “:free”) — openrouter.ai/keys. Put any vision-capable model id in the Model field.",
    build(key, model, b64, mime, prompt){
      return {
        url: "https://openrouter.ai/api/v1/chat/completions",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: { model, temperature: 0, messages: [{ role: "user", content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }
        ] }] }
      };
    },
    parse(data){ return data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : null; }
  }
};

function aiErrorMessage(data){
  if(!data) return "";
  const e = data.error;
  if(!e) return "";
  return typeof e === "string" ? e : (e.message || JSON.stringify(e));
}

// One provider, with retry + countdown on rate limits / overload / network errors.
async function callProvider(providerId, file, promptText, { retries = 5, onStatus = null, signal = null } = {}) {
  const prov = AI_PROVIDERS[providerId];
  const apiKey = (state.aiKeys[providerId] || "").trim();
  if (!apiKey) throw new Error(`${prov.label} API key is missing! Add it in Settings.`);
  const model = (state.aiModels[providerId] || "").trim() || prov.defaultModel;
  const base64Data = await fileToBase64(file);
  const req = prov.build(apiKey, model, base64Data, file.type || "image/jpeg", promptText);

  let delay = 5000; // first retry waits 5s, then 10s, 20s, 40s...

  for (let attempt = 1; attempt <= retries; attempt++) {
    if (signal && signal.aborted) throw makeAbortError();
    try {
      const response = await fetch(req.url, {
        method: "POST",
        headers: req.headers,
        signal,
        body: JSON.stringify(req.body)
      });

      let data = null;
      try { data = await response.json(); } catch (e) { data = null; }
      const msg = aiErrorMessage(data);

      if (!response.ok || msg) {
        const isRetryable = response.status === 429 || response.status === 503 ||
          response.status === 529 || response.status >= 500 ||
          /high demand|quota|overloaded|rate.?limit/i.test(msg);

        if (isRetryable && attempt < retries) {
          console.warn(`${prov.label} busy/rate-limited (attempt ${attempt}/${retries}). Waiting ${(delay/1000).toFixed(0)}s...`);
          await waitWithCountdown(delay, (secLeft) => {
            if (onStatus) onStatus(`${prov.label} is rate-limited — retrying in ${secLeft}s (attempt ${attempt}/${retries})...`);
          }, signal);
          delay *= 2;
          continue;
        }
        // Bad key, bad request, etc. — retrying can't fix these.
        const apiErr = new Error(msg || `${prov.label} error (HTTP ${response.status}).`);
        apiErr.fatal = true;
        throw apiErr;
      }

      const text = prov.parse(data);
      if (!text) throw new Error(`${prov.label} returned an invalid response.`);
      return text;

    } catch (err) {
      if (err.name === "AbortError" || (signal && signal.aborted)) throw makeAbortError();
      if (err.fatal || attempt === retries) throw err;
      await waitWithCountdown(delay, (secLeft) => {
        if (onStatus) onStatus(`Error contacting ${prov.label} (${err.message}) — retrying in ${secLeft}s (attempt ${attempt}/${retries})...`);
      }, signal);
      delay *= 2;
    }
  }
}

// Uses the selected provider; if "fallback" is on and it fails, tries every
// other provider that has a key saved.
async function callAiVision(file, promptText, opts = {}) {
  const hasKey = id => !!(state.aiKeys[id] || "").trim();
  let order = [state.aiProvider];
  if (state.aiFallback) {
    order = order.concat(Object.keys(AI_PROVIDERS).filter(id => id !== state.aiProvider && hasKey(id)));
  }
  if (!hasKey(state.aiProvider) && order.length > 1) order = order.filter(hasKey); // skip providers without a key
  let lastErr = null;
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    const more = i < order.length - 1;
    try {
      return await callProvider(id, file, promptText, { ...opts, retries: more ? 2 : (opts.retries || 5) });
    } catch (err) {
      if (err.name === "AbortError") throw err;
      lastErr = err;
      if (more && opts.onStatus) {
        opts.onStatus(`${AI_PROVIDERS[id].label} failed (${err.message}) — trying ${AI_PROVIDERS[order[i + 1]].label}...`);
        await new Promise(r => setTimeout(r, 1500));
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------
// Helper: automatically determine league based on trophy count
// ---------------------------------------------------------
function determineLeagueByTrophies(trophies) {
  const t = Number(trophies);
  if (isNaN(t)) return "Warm-up";
  if (t >= 200) return "Gold";
  if (t >= 100) return "Silver";
  if (t >= 50) return "Bronze";
  if (t >= 20) return "Novice";
  return "Warm-up";
}

// ---------------------------------------------------------
// AI — before fight image processing
// ---------------------------------------------------------
async function runBeforeOcr(files) {
  if(!files.length) return;
  const statusEl = document.getElementById("beforeOcrStatus");
  statusEl.textContent = `Analyzing ${files.length} image(s) (before fight)...`;
  const sess = aiSessionId;
  const signal = aiAbortController.signal;
  setSaveButtonBusy(true);

  try {
    let anyRejectedTrophies = false;
    let anyRejectedName = false;
    for(let i = 0; i < files.length; i++){
      const file = files[i];
      statusEl.textContent = `Analyzing image ${i+1} of ${files.length}...`;
      
      const ourName = (state.ourClanName || "our clan").trim();
      const prompt = `These are pre-fight screenshot(s) from Creatures of the Deep clan war. Our clan's name is literally "${ourName}".

      TWO kinds of info blocks appear:
      1. Our OWN status header: unlabeled (no clan name/logo), just a league name, "#position", and a trophy number next to a cup icon. Always belongs to "${ourName}".
      2. A clan card/popup (e.g. opened by tapping a clan): has that clan's short name and logo. If the name matches "${ourName}" it's ours; otherwise it's the opponent's — read "opponentName" from it.

      For "opponentName", use ONLY the clan's actual short name/title printed right next to its logo (usually just a few characters/words, e.g. "Turtle Town", "猪猪熊"). NEVER use a long description/bio/slogan/rules text box, and NEVER include any numeric IDs, member counts, or "group:"-style numbers you see elsewhere on the card — those are not the name.

      Trophies: use ONLY the number next to a PURPLE/LILAC trophy-cup icon. Ignore any number next to a PINK/MAGENTA diamond/gem icon — that's a different currency, not trophies. Sanity check: trophies here never reach 4 digits (max ~a few hundred); if your number is 1000+, you picked the wrong one — find the smaller purple-icon number instead.

      Return EXCLUSIVELY this JSON (no markdown fences), with real values from the image(s):
      {
        "ourTrophies": 137,
        "ourPosition": 6,
        "opponentName": "example clan name",
        "opponentNameLatin": "",
        "oppTrophies": 72,
        "oppPosition": 21
      }
      "opponentNameLatin": only if "opponentName" has Japanese/Korean/Chinese/other non-Latin script — give a romanization or short translation; otherwise leave "".
      Leave a field empty/null only if genuinely not visible. Don't invent leagues.`;
      
      const jsonStr = await callAiVision(file, prompt, {
        signal,
        onStatus: (msg) => { if(sess === aiSessionId) statusEl.textContent = msg; }
      });
      if(sess !== aiSessionId) return; // day was closed/switched meanwhile
      const cleanJson = jsonStr.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleanJson);

      // Sanity check: trophy counts in this game never realistically reach
      // 4 digits. If the AI still grabbed the pink gem/currency number
      // instead of the purple trophy number, it'll be way past this — so we
      // refuse to write it into the field rather than silently saving junk.
      const MAX_PLAUSIBLE_TROPHIES = 999;
      const isPlausibleTrophies = (v) => {
        const n = Number(String(v).replace(/[,.\s]/g, ""));
        return !isNaN(n) && n <= MAX_PLAUSIBLE_TROPHIES;
      };
      // A real clan name is short and has no long digit runs (IDs, group
      // numbers, member counts). If it looks like that, the AI likely
      // grabbed a description/bio box instead of the actual name.
      const isPlausibleClanName = (name) => {
        if (!name) return false;
        const trimmed = name.trim();
        if (trimmed.length > 30) return false;
        if (/\d{5,}/.test(trimmed)) return false;
        return true;
      };
      let rejectedTrophies = false;
      let rejectedName = false;

      if(parsed.ourTrophies != null && parsed.ourTrophies !== "") {
        if(isPlausibleTrophies(parsed.ourTrophies)) {
          document.getElementById("ourTrophies").value = parsed.ourTrophies;
          document.getElementById("ourLeague").value = determineLeagueByTrophies(parsed.ourTrophies);
        } else {
          rejectedTrophies = true;
        }
      }
      if(parsed.ourPosition != null && parsed.ourPosition !== "") {
        document.getElementById("ourPosition").value = parsed.ourPosition;
      }
      if(parsed.opponentName) {
        let oppName = parsed.opponentName.trim();
        if(isPlausibleClanName(oppName)) {
          const latin = (parsed.opponentNameLatin || "").trim();
          if(latin && latin.toLowerCase() !== oppName.toLowerCase()) {
            oppName = `${oppName} (${latin})`;
          }
          document.getElementById("opponentName").value = oppName;
        } else {
          rejectedName = true;
        }
      }
      if(parsed.oppTrophies != null && parsed.oppTrophies !== "") {
        if(isPlausibleTrophies(parsed.oppTrophies)) {
          document.getElementById("oppTrophies").value = parsed.oppTrophies;
          document.getElementById("oppLeague").value = determineLeagueByTrophies(parsed.oppTrophies);
        } else {
          rejectedTrophies = true;
        }
      }
      if(parsed.oppPosition != null && parsed.oppPosition !== "") {
        document.getElementById("oppPosition").value = parsed.oppPosition;
      }
      if(rejectedTrophies) anyRejectedTrophies = true;
      if(rejectedName) anyRejectedName = true;
    }
    
    const warnings = [];
    if(anyRejectedTrophies) warnings.push("implausible trophies number");
    if(anyRejectedName) warnings.push("implausible club name (looked like a description/ID, not a name)");
    statusEl.textContent = warnings.length
      ? `⚠️ Done, but AI returned ${warnings.join(" and ")} on at least one image — that field was left blank there, please check and enter it manually.`
      : "Done — data and leagues successfully synced!";
  } catch(err) {
    if(err.name === "AbortError" || sess !== aiSessionId) return;
    statusEl.textContent = "Error: " + err.message;
  } finally {
    if(sess === aiSessionId) setSaveButtonBusy(false);
  }
}

document.getElementById("beforeImgInput").addEventListener("change", async (e)=>{
  const files = Array.from(e.target.files || []);
  e.target.value = "";
  await runBeforeOcr(files);
});

document.getElementById("beforeImgUrlBtn").addEventListener("click", async ()=>{
  const input = document.getElementById("beforeImgUrlInput");
  const statusEl = document.getElementById("beforeOcrStatus");
  const urls = parseUrlList(input.value);
  if(!urls.length) return;
  statusEl.textContent = `Fetching ${urls.length} image(s) from link(s)...`;
  try {
    const sess = aiSessionId;
    const blobs = await Promise.all(urls.map(urlToImageBlob));
    if(sess !== aiSessionId) return;
    input.value = "";
    await runBeforeOcr(blobs);
  } catch(err) {
    statusEl.textContent = "Error: " + err.message;
  }
});

// ---------------------------------------------------------
// AI — after fight image processing
// ---------------------------------------------------------
async function runAfterOcr(files) {
  if(!files.length) return;
  const statusEl = document.getElementById("afterOcrStatus");
  statusEl.textContent = `Analyzing ${files.length} image(s) with AI...`;
  const sess = aiSessionId;
  const signal = aiAbortController.signal;
  setSaveButtonBusy(true);

  try {
    for(let i = 0; i < files.length; i++){
      const file = files[i];
      statusEl.textContent = `Analyzing image ${i+1} of${files.length}...`;
      
      const knownPlayers = state.players.length
        ? `Known player names from this clan (use these EXACT spellings/capitalizations if a name in the image matches one of these, even approximately — do not "correct" or re-capitalize a name that's already on this list): ${state.players.join(", ")}.`
        : "";

      const prompt = `This is a clan-war result screenshot from a mobile game. The purple header shows two clans: OUR clan on the LEFT and the opponent on the RIGHT, with a big total score under each (e.g. "8 290" and "0"). Below it, the LEFT column lists OUR clan's players; the right column is the opponent's (often empty).
      ${knownPlayers}

      Rules:
      - "ourFinalScore" = the big total under the LEFT clan; "theirFinalScore" = the big total under the RIGHT clan. Numbers may be grouped with a space ("8 290" means 8290) — return plain integers. If the opponent total is 0 (they did not play), return 0 — never null or empty.
      - Each player row has: a rank ("1.", "2.", …), a small level number next to the avatar (IGNORE it), a country flag (ignore), the player name, and the score followed by a round "P" coin icon. "score" is ONLY the number next to the P icon.
      - The FIRST row often shows a golden chest icon instead of a rank number — that row is rank 1.
      - The list may be cut off at the top or bottom. Only return rows you can read completely; never invent rows.
      - Only list players from the LEFT (our) column.

      Return EXCLUSIVELY a valid JSON object in this format (no markdown code fences):
      {
        "ourFinalScore": 1234,
        "theirFinalScore": 1000,
        "rows": [
          {"rank": 1, "name": "PlayerName", "score": 500}
        ]
      }`;
      
      const jsonStr = await callAiVision(file, prompt, {
        signal,
        onStatus: (msg) => { if(sess === aiSessionId) statusEl.textContent = msg; }
      });
      if(sess !== aiSessionId) return; // day was closed/switched meanwhile
      const cleanJson = jsonStr.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleanJson);

      // NOTE: 0 is a valid score (opponent didn't play), so don't use a
      // plain truthiness check here — only skip null/undefined/empty string.
      const hasScore = (v) => v !== null && v !== undefined && String(v).trim() !== "";
      const cleanScore = (v) => String(v).replace(/[\s,.]/g, "");
      if(hasScore(parsed.ourFinalScore) && !document.getElementById("ourFinalScore").value){
        document.getElementById("ourFinalScore").value = cleanScore(parsed.ourFinalScore);
      }
      if(hasScore(parsed.theirFinalScore) && !document.getElementById("theirFinalScore").value){
        document.getElementById("theirFinalScore").value = cleanScore(parsed.theirFinalScore);
      }
      updateResultPreview();

      if(parsed.rows && Array.isArray(parsed.rows)){
        parsed.rows.forEach(r => {
          const rows = Array.from(document.querySelectorAll("#playerRows tr"));
          const exists = rows.some(tr => {
            const rVal = tr.querySelector(".rankInput").value;
            const nVal = tr.querySelector(".nameInput").value.trim().toLowerCase();
            return rVal == r.rank || (r.name && nVal === r.name.toLowerCase());
          });
          
          if(!exists && r.name && r.rank != null){
            addPlayerRow(canonicalPlayerName(r.name), r.rank, parseScoreVal(r.score) ?? "");
          }
        });
      }
    }
    updateResultPreview(); // also refreshes the score check below the players table
    statusEl.textContent = "Done — AI processed all images. Check the score verification below the players table.";
  } catch(err) {
    if(err.name === "AbortError" || sess !== aiSessionId) return;
    statusEl.textContent = "Error: " + err.message;
  } finally {
    if(sess === aiSessionId) setSaveButtonBusy(false);
  }
}

document.getElementById("afterImgInput").addEventListener("change", async (e)=>{
  const files = Array.from(e.target.files || []);
  e.target.value = "";
  await runAfterOcr(files);
});

document.getElementById("afterImgUrlBtn").addEventListener("click", async ()=>{
  const input = document.getElementById("afterImgUrlInput");
  const statusEl = document.getElementById("afterOcrStatus");
  const urls = parseUrlList(input.value);
  if(!urls.length) return;
  statusEl.textContent = `Fetching ${urls.length} image(s) from link(s)...`;
  try {
    const sess = aiSessionId;
    const blobs = await Promise.all(urls.map(urlToImageBlob));
    if(sess !== aiSessionId) return;
    input.value = "";
    await runAfterOcr(blobs);
  } catch(err) {
    statusEl.textContent = "Error: " + err.message;
  }
});

// ---------------------------------------------------------
// Init
// ---------------------------------------------------------
setupDropZone("beforeDropZone", "beforeImgUrlInput", runBeforeOcr);
setupDropZone("afterDropZone", "afterImgUrlInput", runAfterOcr);

// ---------------------------------------------------------
// Admin login UI
// ---------------------------------------------------------
(function setupAuthUi(){
  const loginBtn = document.getElementById("loginBtn");
  const modal = document.getElementById("loginModal");
  const form = document.getElementById("loginForm");
  const msg = document.getElementById("loginMsg");
  const closeLogin = () => { modal.classList.add("hidden"); document.getElementById("loginPassword").value = ""; msg.textContent = ""; };
  document.getElementById("closeLogin").addEventListener("click", closeLogin);
  if(!sb){ loginBtn.style.display = "none"; return; }

  loginBtn.addEventListener("click", async ()=>{
    if(isAdmin){
      await sb.auth.signOut();
      await refreshAdmin();
      return;
    }
    modal.classList.remove("hidden");
    document.getElementById("loginPassword").focus();
  });
  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const email = ADMIN_EMAIL;
    const password = document.getElementById("loginPassword").value;
    msg.textContent = "Signing in…";
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if(error){ msg.textContent = /invalid login/i.test(error.message) ? "Wrong password." : error.message; return; }
    await refreshAdmin();
    if(!isAdmin){
      await sb.auth.signOut();
      await refreshAdmin();
      msg.textContent = "This account is not an admin of the clan tracker.";
      return;
    }
    closeLogin();
  });
  // (don't await supabase calls directly inside this callback)
  sb.auth.onAuthStateChange(()=>{ setTimeout(refreshAdmin, 0); });
})();

renderAiSettings(); // (AI_PROVIDERS is defined further up, so this has to run here)
renderCalendar();
renderTables();
renderPlayersManageList();

// Then: check the admin session and pull the real data from Supabase.
(async ()=>{
  await refreshAdmin();
  await loadFromRemote();
})();