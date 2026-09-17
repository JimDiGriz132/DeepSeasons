/* ===========================================================
   Carp Diem — Clan War Tracker
   Static, client-side (GitHub Pages friendly).
   All data lives in localStorage. Images are OCR'd in-browser
   with Tesseract.js as a best-effort autofill; user always
   reviews/edits before saving.
=========================================================== */

const STORAGE_KEY = "cd_tracker_v1";
const HR_MONTHS = ["Siječanj","Veljača","Ožujak","Travanj","Svibanj","Lipanj",
                    "Srpanj","Kolovoz","Rujan","Listopad","Studeni","Prosinac"];
const HR_DAYLABELS = ["Pon","Uto","Sri","Čet","Pet","Sub","Ned"];

// ---------------------------------------------------------
// Data layer
// ---------------------------------------------------------
function loadData(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){ console.warn("Could not parse stored data", e); }
  return { ourClanName: "Carp Diem", players: [], fights: {} };
}
function saveData(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
let state = loadData();

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
  document.getElementById("calMonthLabel").textContent = `${HR_MONTHS[calMonth]} ${calYear}.`;
  const grid = document.getElementById("calendarGrid");
  grid.innerHTML = "";
  HR_DAYLABELS.forEach(l=>{
    const el = document.createElement("div");
    el.className = "cal-daylabel";
    el.textContent = l;
    grid.appendChild(el);
  });

  const firstDay = new Date(calYear, calMonth, 1);
  // JS getDay: 0=Sun..6=Sat -> convert to Mon-first index
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
  renderCalendar._done = true;
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
  document.getElementById("tableMonthLabel").textContent = `${HR_MONTHS[tableMonth]} ${tableYear}.`;
  const container = document.getElementById("tablesContainer");
  container.innerHTML = "";

  const daysInMonth = new Date(tableYear, tableMonth+1, 0).getDate();
  const half1 = []; // days 1-14
  const half2 = []; // days 15-end
  for(let d=1; d<=daysInMonth; d++){
    const key = dateKey(tableYear, tableMonth, d);
    if(!state.fights[key]) continue;
    if(d<=14) half1.push(d); else half2.push(d);
  }

  if(half1.length===0 && half2.length===0){
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Nema unesenih fightova za ovaj mjesec.";
    container.appendChild(p);
    return;
  }

  if(half1.length) buildTableBlock(container, `1 – 14 ${HR_MONTHS[tableMonth].toUpperCase()} ${tableYear}.`, half1);
  if(half2.length) buildTableBlock(container, `15 – ${daysInMonth} ${HR_MONTHS[tableMonth].toUpperCase()} ${tableYear}.`, half2);
}

function buildTableBlock(container, title, days){
  const wrap = document.createElement("div");
  const h = document.createElement("div");
  h.className = "table-block-title";
  h.textContent = title;
  wrap.appendChild(h);

  const table = document.createElement("table");
  table.className = "tracker-table";

  const dayKeys = days.map(d => dateKey(tableYear, tableMonth, d));
  const fights = dayKeys.map(k => state.fights[k]);

  // Row: result badge
  const rowResult = document.createElement("tr");
  rowResult.className = "row-result";
  rowResult.appendChild(cornerCell(title.split(" ")[0]+" ..."));
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

  // Row: our standing before
  appendPlainRow(table, "row-ourstanding", "", fights.map(f=> fmtStanding(f.ourTrophies,f.ourPosition,f.ourLeague)));
  // Row: date
  appendPlainRow(table, "row-date", "", days.map(d=> formatShortDate(tableYear,tableMonth,d)));
  // Row: opponent name
  appendPlainRow(table, "row-oppname", "", fights.map(f=> f.opponentName || ""));
  // Row: opponent standing before
  appendPlainRow(table, "row-oppstanding", "", fights.map(f=> fmtStanding(f.oppTrophies,f.oppPosition,f.oppLeague)));
  // Row: final score
  appendPlainRow(table, "row-score", "", fights.map(f=>{
    if(f.ourFinalScore==null || f.ourFinalScore==="" ) return "";
    return `${f.ourFinalScore}--${f.theirFinalScore}`;
  }));

  // Player rows
  const sortedPlayers = [...state.players].sort((a,b)=> a.localeCompare(b));
  sortedPlayers.forEach(player=>{
    // find first date (overall, not just this block) this player appears
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
        td.textContent = ""; // not a member yet
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
  th.textContent = "";
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
function fmtStanding(trophies, position, league){
  if(trophies==null || trophies==="" ) return "";
  return `${trophies},${position}(${league||""})`;
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
        alert("Podaci uvezeni.");
      } else {
        alert("Neispravna JSON datoteka.");
      }
    }catch(err){
      alert("Greška pri čitanju datoteke: "+err.message);
    }
  };
  reader.readAsText(file);
});

// ---------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------
document.getElementById("ourClanName").value = state.ourClanName || "Carp Diem";
document.getElementById("saveSettingsBtn").addEventListener("click", ()=>{
  state.ourClanName = document.getElementById("ourClanName").value.trim() || "Carp Diem";
  saveData();
  document.getElementById("clanNameLabel").textContent = state.ourClanName;
  alert("Spremljeno.");
});
document.getElementById("clanNameLabel").textContent = state.ourClanName || "Carp Diem";
document.getElementById("wipeBtn").addEventListener("click", ()=>{
  if(confirm("Sigurno želiš obrisati SVE podatke? Ovo se ne može poništiti.")){
    state = { ourClanName: state.ourClanName, players: [], fights: {} };
    saveData();
    renderCalendar();
    renderTables();
    alert("Svi podaci obrisani.");
  }
});

// ---------------------------------------------------------
// EDITOR MODAL
// ---------------------------------------------------------
let editorKey = null; // "YYYY-MM-DD"
let editorFight = null;

function openEditor(y, m, d){
  editorKey = dateKey(y,m,d);
  const existing = state.fights[editorKey];
  editorFight = existing ? JSON.parse(JSON.stringify(existing)) : {
    opponentName:"", ourTrophies:"", ourPosition:"", ourLeague:"S",
    oppTrophies:"", oppPosition:"", oppLeague:"S",
    ourFinalScore:"", theirFinalScore:"",
    playerRanks:{}
  };

  document.getElementById("editorDateLabel").textContent =
    `${d}. ${HR_MONTHS[m].toLowerCase()} ${y}.`;

  document.getElementById("ourTrophies").value = editorFight.ourTrophies || "";
  document.getElementById("ourPosition").value = editorFight.ourPosition || "";
  document.getElementById("ourLeague").value = editorFight.ourLeague || "S";
  document.getElementById("opponentName").value = editorFight.opponentName || "";
  document.getElementById("oppTrophies").value = editorFight.oppTrophies || "";
  document.getElementById("oppPosition").value = editorFight.oppPosition || "";
  document.getElementById("oppLeague").value = editorFight.oppLeague || "S";
  document.getElementById("ourFinalScore").value = editorFight.ourFinalScore || "";
  document.getElementById("theirFinalScore").value = editorFight.theirFinalScore || "";
  document.getElementById("beforeOcrRaw").textContent = "";
  document.getElementById("afterOcrRaw").textContent = "";
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
    <td><input type="number" class="rankInput" value="${rank}"></td>
    <td><input type="text" class="nameInput" value="${escapeHtml(name)}" placeholder="Ime igrača"></td>
    <td><input type="number" class="scoreInput" value="${score}" placeholder="score"></td>
    <td><button class="row-del" title="Obriši red">✕</button></td>
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

// ---- Save / delete ----
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
    const name = tr.querySelector(".nameInput").value.trim();
    const rank = tr.querySelector(".rankInput").value;
    if(name && rank!==""){
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
  if(confirm("Obrisati podatke za ovaj dan?")){
    delete state.fights[editorKey];
    saveData();
    document.getElementById("editorModal").classList.add("hidden");
    renderCalendar();
    renderTables();
  }
});

// ---------------------------------------------------------
// OCR — before fight
// ---------------------------------------------------------
document.getElementById("beforeImgInput").addEventListener("change", async (e)=>{
  const files = Array.from(e.target.files || []);
  if(!files.length) return;
  const statusEl = document.getElementById("beforeOcrStatus");
  statusEl.textContent = "Čitam sliku(e)...";
  let allText = "";
  try{
    for(const file of files){
      const { data } = await Tesseract.recognize(file, "eng");
      allText += data.text + "\n----\n";
    }
  }catch(err){
    statusEl.textContent = "OCR nije uspio: " + err.message;
    return;
  }
  document.getElementById("beforeOcrRaw").textContent = allText;
  applyBeforeOcrGuesses(allText);
  statusEl.textContent = "Gotovo — provjeri polja ispod (OCR nije 100% pouzdan).";
});

function applyBeforeOcrGuesses(text){
  const leagueMap = {bronze:"B", silver:"S", gold:"G", platinum:"P", diamond:"D", legend:"L", master:"D"};
  const lower = text.toLowerCase();

  // League keyword
  for(const [word, letter] of Object.entries(leagueMap)){
    if(lower.includes(word)){
      if(!document.getElementById("ourLeague").value) document.getElementById("ourLeague").value = letter;
      break;
    }
  }

  // position like "#4"
  const posMatch = text.match(/#\s?(\d{1,4})/);
  if(posMatch && !document.getElementById("ourPosition").value){
    document.getElementById("ourPosition").value = posMatch[1];
  }

  // standalone plausible trophy count (2-4 digit number, not the position number)
  const numbers = (text.match(/\b\d{2,5}\b/g) || []).map(Number);
  if(numbers.length && !document.getElementById("ourTrophies").value){
    // pick a number different from the position match, in a "trophy-like" range
    const posNum = posMatch ? Number(posMatch[1]) : null;
    const candidate = numbers.find(n => n !== posNum && n < 100000);
    if(candidate!=null) document.getElementById("ourTrophies").value = candidate;
  }

  // opponent name / win ratio / rank patterns for the second screenshot are highly
  // UI-specific — left for manual entry / copy from the raw OCR text below.
}

// ---------------------------------------------------------
// OCR — after fight (leaderboard screenshots)
// ---------------------------------------------------------
document.getElementById("afterImgInput").addEventListener("change", async (e)=>{
  const files = Array.from(e.target.files || []);
  if(!files.length) return;
  const statusEl = document.getElementById("afterOcrStatus");
  statusEl.textContent = "Čitam sliku(e)...";
  let allText = "";
  const parsedRows = []; // {rank, name, score}
  try{
    for(const file of files){
      const { data } = await Tesseract.recognize(file, "eng");
      allText += data.text + "\n----\n";
      parseLeaderboardText(data.text, parsedRows);
    }
  }catch(err){
    statusEl.textContent = "OCR nije uspio: " + err.message;
    return;
  }
  document.getElementById("afterOcrRaw").textContent = allText;

  // Try to find the two big totals (our score / their score) — usually the
  // two largest standalone numbers near the top of the first screenshot.
  const totals = (allText.match(/\b\d{3,6}\b/g) || []).map(Number);
  if(totals.length >= 2){
    if(!document.getElementById("ourFinalScore").value) document.getElementById("ourFinalScore").value = totals[0];
    if(!document.getElementById("theirFinalScore").value) document.getElementById("theirFinalScore").value = totals[1];
    updateResultPreview();
  }

  // Merge parsed rows into editor, de-duplicating by rank (overlapping
  // screenshots showing the same row twice should not create duplicates).
  const byRank = {};
  parsedRows.forEach(r => { byRank[r.rank] = r; });
  Object.values(byRank)
    .sort((a,b)=>a.rank-b.rank)
    .forEach(r => {
      // avoid duplicating rows already present with same rank
      const exists = Array.from(document.querySelectorAll("#playerRows tr")).some(tr=>{
        return tr.querySelector(".rankInput").value == r.rank;
      });
      if(!exists) addPlayerRow(r.name, r.rank, r.score);
    });

  statusEl.textContent = `Gotovo — pronađeno ${Object.keys(byRank).length} redova, provjeri tablicu ispod (OCR nije 100% pouzdan).`;
});

function parseLeaderboardText(text, outRows){
  const lines = text.split("\n").map(l=>l.trim()).filter(Boolean);
  // Expect lines roughly like: "6. jw0w 1896"  or  "20 jw0w 1896" (level+name+score)
  const lineRe = /^(\d{1,2})[.\s]+.*?([A-Za-zÀ-ſ][A-Za-z0-9À-ſ!.'’\-_ ]{1,24}?)\s+(\d{2,6})\s*$/;
  for(const line of lines){
    const m = line.match(lineRe);
    if(m){
      const rank = Number(m[1]);
      let name = m[2].trim();
      const score = Number(m[3]);
      // guard against absurd ranks (level numbers misread as rank)
      if(rank>=1 && rank<=50 && name.length>=2 && score>0){
        outRows.push({rank, name, score});
      }
    }
  }
}

// ---------------------------------------------------------
// Init
// ---------------------------------------------------------
renderCalendar();
renderTables();
