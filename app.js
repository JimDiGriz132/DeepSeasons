/* ===========================================================
   Carp Diem — Clan War Tracker (Gemini AI Vision OCR)
   Static, client-side (GitHub Pages friendly).
   All data lives in localStorage. Images are processed via Gemini AI.
=========================================================== */

const STORAGE_KEY = "cd_tracker_v2";
const MONTHS = ["January","February","March","April","May","June",
                    "July","August","September","October","November","December"];
const DAYLABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

// ---------------------------------------------------------
// Data layer
// ---------------------------------------------------------
function loadData(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){ console.warn("Could not parse stored data", e); }
  return { ourClanName: "Carp Diem", geminiApiKey: "", players: [], fights: {} };
}
function saveData(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
let state = loadData();
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
    cell.addEventListener("click", ()=> openEditor(calYear, calMonth, d));
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

function buildTableBlock(container, title, days){
  const wrap = document.createElement("div");
  wrap.className = "table-block-wrap";

  const table = document.createElement("table");
  table.className = "tracker-table";

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
    const firstAppearance = findFirstAppearance(player);
    const tr = document.createElement("tr");
    const nameTd = document.createElement("td");
    nameTd.className = "player-name";
    nameTd.textContent = player;
    tr.appendChild(nameTd);
    fights.forEach((f,i)=>{
      const td = document.createElement("td");
      const key = dayKeys[i];
      if(firstAppearance && key < firstAppearance){
        td.textContent = ""; 
      } else if(f.playerRanks && Object.prototype.hasOwnProperty.call(f.playerRanks, player)){
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
function findFirstAppearance(player){
  const keys = Object.keys(state.fights).sort();
  for(const k of keys){
    const f = state.fights[k];
    if(f.playerRanks && Object.prototype.hasOwnProperty.call(f.playerRanks, player)){
      return k;
    }
  }
  return null;
}

// ---------------------------------------------------------
// EXPORT / IMPORT
// ---------------------------------------------------------
document.getElementById("exportBtn").addEventListener("click", ()=>{
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "carp-diem-tracker-data.json";
  a.click();
  URL.revokeObjectURL(url);
});
document.getElementById("exportPngBtn").addEventListener("click", async ()=>{
  const container = document.getElementById("tablesContainer");
  if(!container || !container.querySelector(".tracker-table")){
    alert("No table to export for this month.");
    return;
  }
  const btn = document.getElementById("exportPngBtn");
  const originalLabel = btn.textContent;
  btn.textContent = "Exporting…";
  btn.disabled = true;
  try{
    const canvas = await html2canvas(container, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true
    });
    const link = document.createElement("a");
    link.download = `carp-diem-${MONTHS[tableMonth]}-${tableYear}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }catch(err){
    alert("PNG export failed: " + err.message);
  }finally{
    btn.textContent = originalLabel;
    btn.disabled = false;
  }
});
document.getElementById("importFile").addEventListener("change", (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const imported = JSON.parse(reader.result);
      if(imported && imported.fights){
        state = imported;
        saveData();
        renderTables();
        renderCalendar();
        alert("Data imported.");
      } else {
        alert("Invalid JSON file.");
      }
    }catch(err){
      alert("Error reading file: "+err.message);
    }
  };
  reader.readAsText(file);
});

// ---------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------
document.getElementById("ourClanName").value = state.ourClanName || "Carp Diem";
const apiKeyInput = document.getElementById("geminiApiKey");
if(apiKeyInput) apiKeyInput.value = state.geminiApiKey || "";

document.getElementById("saveSettingsBtn").addEventListener("click", ()=>{
  state.ourClanName = document.getElementById("ourClanName").value.trim() || "Carp Diem";
  if(apiKeyInput) state.geminiApiKey = apiKeyInput.value.trim();
  saveData();
  document.getElementById("clanNameLabel").textContent = state.ourClanName;
  alert("Saved.");
});
document.getElementById("clanNameLabel").textContent = state.ourClanName || "Carp Diem";

document.getElementById("wipeBtn").addEventListener("click", ()=>{
  if(confirm("Are you sure you want to delete ALL data? This cannot be undone.")){
    state = { ourClanName: state.ourClanName, geminiApiKey: state.geminiApiKey, players: [], fights: {} };
    saveData();
    renderCalendar();
    renderTables();
    renderPlayersManageList();
    alert("All data deleted.");
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
    input.addEventListener("change", ()=> renamePlayer(name, input.value));

    const delBtn = document.createElement("button");
    delBtn.className = "row-del";
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

  Object.values(state.fights).forEach(f=>{
    if(f.playerRanks && Object.prototype.hasOwnProperty.call(f.playerRanks, oldName)){
      const rank = f.playerRanks[oldName];
      delete f.playerRanks[oldName];
      if(!(targetName in f.playerRanks)){
        f.playerRanks[targetName] = rank;
      }
    }
  });

  saveData();
  renderPlayersManageList();
  renderTables();
}

function deletePlayer(name){
  if(!confirm(`Remove "${name}" from the known players list?\n\nTheir already-saved per-day results stay in your data, but their row will disappear from the Table view unless you add them back with the exact same name.`)) return;
  state.players = state.players.filter(p => p !== name);
  saveData();
  renderPlayersManageList();
  renderTables();
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

function openEditor(y, m, d){
  editorKey = dateKey(y,m,d);
  const existing = state.fights[editorKey];
  editorFight = existing ? JSON.parse(JSON.stringify(existing)) : {
    opponentName:"", ourTrophies:"", ourPosition:"", ourLeague:"Warm-up",
    oppTrophies:"", oppPosition:"", oppLeague:"Warm-up",
    ourFinalScore:"", theirFinalScore:"",
    playerRanks:{}
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
  document.getElementById("ourFinalScore").value = editorFight.ourFinalScore || "";
  document.getElementById("theirFinalScore").value = editorFight.theirFinalScore || "";
  
  document.getElementById("beforeOcrStatus").textContent = "";
  document.getElementById("afterOcrStatus").textContent = "";

  renderPlayerRows();
  updateResultPreview();

  document.getElementById("editorModal").classList.remove("hidden");
}
document.getElementById("closeEditor").addEventListener("click", ()=>{
  document.getElementById("editorModal").classList.add("hidden");
});

function renderPlayerRows(){
  const tbody = document.getElementById("playerRows");
  tbody.innerHTML = "";
  const entries = Object.entries(editorFight.playerRanks || {})
    .sort((a,b)=> (Number(a[1])||999) - (Number(b[1])||999));
  entries.forEach(([name, rank])=> addPlayerRow(name, rank));
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
  tr.querySelector(".row-del").addEventListener("click", ()=> tr.remove());
  tbody.appendChild(tr);
}
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
    return;
  }
  const win = Number(our) >= Number(their);
  el.textContent = win ? "WIN" : "LOSS";
  el.className = "badge " + (win ? "win" : "loss");
}

document.getElementById("saveFightBtn").addEventListener("click", ()=>{
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
    playerRanks: {}
  };
  document.querySelectorAll("#playerRows tr").forEach(tr=>{
    const rawName = tr.querySelector(".nameInput").value.trim();
    const rank = tr.querySelector(".rankInput").value;
    if(rawName && rank!==""){
      const name = canonicalPlayerName(rawName);
      fight.playerRanks[name] = Number(rank);
      ensurePlayer(name);
    }
  });
  state.fights[editorKey] = fight;
  saveData();
  document.getElementById("editorModal").classList.add("hidden");
  renderCalendar();
  renderTables();
});
document.getElementById("deleteFightBtn").addEventListener("click", ()=>{
  if(confirm("Delete data for this day?")){
    delete state.fights[editorKey];
    saveData();
    document.getElementById("editorModal").classList.add("hidden");
    renderCalendar();
    renderTables();
  }
});

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

// Reads Google's suggested wait time out of a 429 error response, if present
// (error.details contains a RetryInfo object with a "retryDelay" like "33s").
function getRetryDelayMs(error) {
  try {
    const details = error.details || [];
    const retryInfo = details.find(d => String(d["@type"] || "").includes("RetryInfo"));
    if (retryInfo && retryInfo.retryDelay) {
      const seconds = parseFloat(String(retryInfo.retryDelay).replace("s", ""));
      if (!isNaN(seconds)) return Math.ceil(seconds * 1000) + 500; // small buffer
    }
  } catch (e) { /* ignore, fall back to default backoff */ }
  return null;
}

async function callGeminiVision(file, promptText, { retries = 5, onStatus = null } = {}) {
  const apiKeyInput = document.getElementById("geminiApiKey");
  const apiKey = (apiKeyInput ? apiKeyInput.value.trim() : "") || state.geminiApiKey;

  if (!apiKey) {
    throw new Error("API key is missing! Enter your Google Gemini API key in Settings.");
  }
  
  const base64Data = await fileToBase64(file);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${apiKey}`;

  let delay = 2000;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: promptText },
              { inline_data: { mime_type: file.type || "image/jpeg", data: base64Data } }
            ]
          }],
          generationConfig: {
            temperature: 0
          }
        })
      });

      const data = await response.json();
      
      if (data.error) {
        const msg = data.error.message || "";
        const isRetryable = data.error.code === 429 ||
          data.error.status === "RESOURCE_EXHAUSTED" ||
          data.error.status === "UNAVAILABLE" ||
          msg.includes("high demand") || msg.includes("quota");

        if (isRetryable && attempt < retries) {
          const waitMs = getRetryDelayMs(data.error) || delay;
          console.warn(`Gemini busy/rate-limited (attempt ${attempt}/${retries}). Waiting ${(waitMs/1000).toFixed(1)}s...`);
          if (onStatus) onStatus(`Gemini is rate-limited — retrying in ${Math.ceil(waitMs/1000)}s (attempt ${attempt}/${retries})...`);
          await new Promise(res => setTimeout(res, waitMs));
          delay *= 2;
          continue;
        }
        throw new Error(msg || "Gemini API error.");
      }
      
      if (!data.candidates || !data.candidates[0].content) {
        throw new Error("Gemini returned an invalid response.");
      }
      
      return data.candidates[0].content.parts[0].text;

    } catch (err) {
      if (attempt === retries) throw err;
      if (onStatus) onStatus(`Error contacting Gemini — retrying (attempt ${attempt}/${retries})...`);
      await new Promise(res => setTimeout(res, delay));
      delay *= 2;
    }
  }
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
document.getElementById("beforeImgInput").addEventListener("change", async (e)=>{
  const files = Array.from(e.target.files || []);
  if(!files.length) return;
  const statusEl = document.getElementById("beforeOcrStatus");
  statusEl.textContent = `Analyzing ${files.length} image(s) (before fight)...`;
  
  try {
    for(let i = 0; i < files.length; i++){
      const file = files[i];
      statusEl.textContent = `Analyzing image ${i+1} of ${files.length}...`;
      
      const ourName = (state.ourClanName || "our clan").trim();
      const prompt = `These are pre-fight screenshot(s) from Creatures of the Deep clan war. Our clan's name is literally "${ourName}".

      There are two different kinds of clan info you'll see, and you must tell them apart like this:
      1. Our OWN status header — a small block, usually near the top of the screen, showing a league name (e.g. "bronze league"), a position number with "#" (e.g. "#4"), and a trophy count shown ONLY as a number next to a trophy/cup icon with NO text label (e.g. "91 🏆"). This header has NO clan name or logo printed directly on it — it doesn't need one, because it is inherently the player's own status bar (i.e. it always belongs to "${ourName}"). Do not skip its trophy number just because there's no text label next to it or no clan name attached to it — treat this unlabeled header as ours by default.
      2. A specific clan's card — a block that DOES explicitly show a clan name and/or logo (e.g. a card titled "bass heads", or a "Clan Challenge" comparison widget with both clan names/logos side by side). Whatever league/position/trophy numbers appear on such a named card belong to THAT specific clan. If the name matches "${ourName}", those numbers reinforce/replace the "our" fields; if it's a different name, those numbers are the opponent's ("opp" fields) and that name is "opponentName".

      Analyze the image(s) and return EXCLUSIVELY a valid JSON object in the following format (without markdown code fences):
      {
        "ourTrophies": 137,
        "ourPosition": 6,
        "opponentName": "example clan name",
        "oppTrophies": 72,
        "oppPosition": 21
      }
      These numbers above are just a FORMAT example — they are not related to the actual image in any way, so don't let them influence what you read. Read the real numbers fresh from the image(s), even if by coincidence they end up matching this example.
      If any data is genuinely not visible anywhere in the image(s), leave that field as an empty string or null — but double-check you didn't miss an unlabeled trophy-icon number before giving up, especially for our own header. Do not invent leagues, focus only on exact trophy numbers and positions.`;
      
      const jsonStr = await callGeminiVision(file, prompt, {
        onStatus: (msg) => { statusEl.textContent = msg; }
      });
      const cleanJson = jsonStr.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleanJson);

      if(parsed.ourTrophies != null && parsed.ourTrophies !== "") {
        document.getElementById("ourTrophies").value = parsed.ourTrophies;
        document.getElementById("ourLeague").value = determineLeagueByTrophies(parsed.ourTrophies);
      }
      if(parsed.ourPosition != null && parsed.ourPosition !== "") {
        document.getElementById("ourPosition").value = parsed.ourPosition;
      }
      if(parsed.opponentName) {
        document.getElementById("opponentName").value = parsed.opponentName;
      }
      if(parsed.oppTrophies != null && parsed.oppTrophies !== "") {
        document.getElementById("oppTrophies").value = parsed.oppTrophies;
        document.getElementById("oppLeague").value = determineLeagueByTrophies(parsed.oppTrophies);
      }
      if(parsed.oppPosition != null && parsed.oppPosition !== "") {
        document.getElementById("oppPosition").value = parsed.oppPosition;
      }
    }
    
    statusEl.textContent = "Done — data and leagues successfully synced!";
  } catch(err) {
    statusEl.textContent = "Error: " + err.message;
  }
});

// ---------------------------------------------------------
// AI — after fight image processing
// ---------------------------------------------------------
document.getElementById("afterImgInput").addEventListener("change", async (e)=>{
  const files = Array.from(e.target.files || []);
  if(!files.length) return;
  const statusEl = document.getElementById("afterOcrStatus");
  statusEl.textContent = `Analyzing ${files.length} image(s) with Gemini AI...`;

  try {
    for(let i = 0; i < files.length; i++){
      const file = files[i];
      statusEl.textContent = `Analyzing image ${i+1} of${files.length}...`;
      
      const knownPlayers = state.players.length
        ? `Known player names from this clan (use these EXACT spellings/capitalizations if a name in the image matches one of these, even approximately — do not "correct" or re-capitalize a name that's already on this list): ${state.players.join(", ")}.`
        : "";

      const prompt = `This is a leaderboard screenshot from the game with player results.
      ${knownPlayers}
      Analyze the image and return EXCLUSIVELY a valid JSON object in the following format (without markdown code fences):
      {
        "ourFinalScore": 1234,
        "theirFinalScore": 1000,
        "rows": [
          {"rank": 1, "name": "PlayerName", "score": 500}
        ]
      }`;
      
      const jsonStr = await callGeminiVision(file, prompt, {
        onStatus: (msg) => { statusEl.textContent = msg; }
      });
      const cleanJson = jsonStr.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleanJson);

      if(parsed.ourFinalScore && !document.getElementById("ourFinalScore").value){
        document.getElementById("ourFinalScore").value = parsed.ourFinalScore;
      }
      if(parsed.theirFinalScore && !document.getElementById("theirFinalScore").value){
        document.getElementById("theirFinalScore").value = parsed.theirFinalScore;
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
            addPlayerRow(canonicalPlayerName(r.name), r.rank, r.score || "");
          }
        });
      }
    }
    statusEl.textContent = "Done — AI successfully processed all images!";
  } catch(err) {
    statusEl.textContent = "Error: " + err.message;
  }
});

// ---------------------------------------------------------
// Init
// ---------------------------------------------------------
renderCalendar();
renderTables();
renderPlayersManageList();