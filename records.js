// =====================================================================
// RECORDS BY SEASON (OOS) — personal-best records per set, split by which
// fish of the set are out of season (OOS) in the month of the fight.
// Source of truth for fish / rarity / OOS months: data.json (loaded here).
// Scenario = number of OOS common/rare/epic fish in that month (e.g. "1C",
// "1C + 1R"); records are only compared inside the same scenario.
// "All clans" checkbox (#recAllClans): off (default) = only the active clan's fights, on = fights of every clan.
// Uses globals from app.js: anCollectRaw, parseScoreVal, escapeHtml,
// anFmtDate, anFmtN, anOpenFight, renderAnalyticsIfActive.
// =====================================================================
(function(){
  let DATA = null;           // { byNorm:Map, maps:Map, caps:{}, fishes:[], sets:[] }
  let LOAD_ERR = "";
  const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  function init(d){
    const byNorm = new Map();
    (d.fishes || []).forEach(f => {
      byNorm.set(norm(f.name), f);
      byNorm.set(norm(String(f.id).replace(/^f_/, "")), f);
    });
    const maps = new Map((d.maps || []).map(m => [m.id, m.name]));
    DATA = { byNorm, maps, fishes: d.fishes || [], sets: d.sets || [] };
    const sel = document.getElementById("recMap");
    if(sel) sel.innerHTML = '<option value="">All maps</option>' + [...maps.values()].map(m => `<option>${escapeHtml(m)}</option>`).join("");
  }
  fetch("data.json").then(r => r.json()).then(d => { init(d); renderAnalyticsIfActive(); if(typeof renderCalendar === "function") renderCalendar(); })
    .catch(e => { LOAD_ERR = "Could not load data.json (" + e.message + ")"; renderAnalyticsIfActive(); });

  // "Spot-Fin Porcupinefish" / "Porcupinefish" / "Black-Saddled Coral Grouper" all resolve to one fish
  function findFish(name){
    const n = norm(name);
    if(DATA.byNorm.has(n)) return DATA.byNorm.get(n);
    if(n.length < 6) return null;
    for(const [k, f] of DATA.byNorm) if(k.length >= 6 && (n.includes(k) || k.includes(n))) return f;
    return null;
  }
  function info(name){
    const f = findFish(name);
    return f ? { id: f.id, name: f.name, rarity: f.rarity || "common", oos: f.oos || [] }
             : { id: "?" + norm(name), name, rarity: "common", oos: [] };
  }
  // ---- Shared catalog (used by app.js: pre-fight AI translation + manual set autofill) ----
  const mapIdOf = name => {
    const n = norm(name); if(!n || !DATA) return "";
    for(const [id, nm] of DATA.maps) if(norm(nm) === n) return id;
    for(const [id, nm] of DATA.maps) if(n.length >= 4 && (norm(nm).includes(n) || n.includes(norm(nm)))) return id;
    return "";
  };
  const fishById = id => DATA.fishes.find(f => f.id === id) || { name: id };
  window.FishCatalog = {
    ready: () => !!DATA,
    mapNames: () => DATA ? [...DATA.maps.values()] : [],
    fishNames: () => DATA ? DATA.fishes.map(f => f.name) : [],
    // exact (case/punctuation-insensitive) match only -> official English spelling, or ""
    canonFish: name => { const f = DATA && DATA.byNorm.get(norm(name)); return f ? f.name : ""; },
    // fish names that exist on the given map (empty list if the map is unknown)
    fishForMap: mapName => {
      const id = mapIdOf(mapName); if(!DATA || !id) return [];
      const out = new Set();
      DATA.sets.filter(s => s.map_id === id).forEach(s => s.fishes.forEach(f => out.add(fishById(f).name)));
      return [...out];
    },
    canonMap: name => { const id = mapIdOf(name); return id ? DATA.maps.get(id) : ""; },
    // compact list of all known sets for the AI prompt
    promptList: () => DATA ? DATA.sets.map(s => `${s.id} | ${DATA.maps.get(s.map_id) || ""} | ${s.fishes.map(id => fishById(id).name).join(", ")}`).join("\n") : "",
    // names read from a (possibly non-English) screenshot -> the real set from data.json
    resolve: (names, mapName, aiSetId) => {
      if(!DATA) return null;
      const ids = new Set((names || []).map(findFish).filter(Boolean).map(f => f.id));
      const mapId = mapIdOf(mapName);
      let best = null, bestN = 0, tie = false;
      DATA.sets.forEach(s => {
        if(mapId && s.map_id !== mapId) return;
        const n = s.fishes.filter(id => ids.has(id)).length;
        if(n > bestN){ best = s; bestN = n; tie = false; } else if(n === bestN && n > 0) tie = true;
      });
      let set = (best && bestN >= 3 && !tie) ? best : null, how = set ? "names" : "";
      if(!set && aiSetId){
        const s = DATA.sets.find(x => x.id === aiSetId);
        if(s && (!mapId || s.map_id === mapId)){ set = s; how = "ai"; }
      }
      return set ? { set, how, map: DATA.maps.get(set.map_id) || "", names: set.fishes.map(id => fishById(id).name) } : null;
    },
    // sets that contain ALL the given fish (and are on the given map, if it is known)
    setsWithFish: (names, mapName) => {
      if(!DATA) return [];
      const ids = [];
      for(const n of names){ const f = findFish(n); if(!f) return []; ids.push(f.id); }
      if(!ids.length) return [];
      const mapId = mapIdOf(mapName);
      const hit = s => ids.every(id => s.fishes.includes(id));
      return DATA.sets.filter(s => hit(s) && (!mapId || s.map_id === mapId))
        .map(s => ({ id: s.id, map: DATA.maps.get(s.map_id) || "", names: s.fishes.map(id => fishById(id).name) }));
    }
  };
  const allClansOn = () => !!(document.getElementById("recAllClans") || {}).checked;
  const entKey = infos => infos.map(i => i.id).sort().join("|");
  const fightInfos = x => x.setLabel.split(" · ").map(info);

  function scenario(infos, month){
    const c = { common: 0, rare: 0, epic: 0 };
    infos.forEach(i => { if(i.oos.includes(month)) c[i.rarity === "rare" || i.rarity === "epic" ? i.rarity : "common"]++; });
    const parts = [];
    if(c.common) parts.push(c.common + "C");
    if(c.rare) parts.push(c.rare + "R");
    if(c.epic) parts.push(c.epic + "E");
    return { key: `${c.common}${c.rare}${c.epic}`, label: parts.join(" + ") || "No OOS", n: c.common + c.rare + c.epic };
  }

  // every set from data.json + any set seen in fights that is not in data.json
  function buildEntities(raw){
    const ents = new Map();
    DATA.sets.forEach((s, i) => {
      const infos = s.fishes.map(id => info((DATA.fishes.find(f => f.id === id) || {}).name || id));
      ents.set(entKey(infos), { key: entKey(infos), map: DATA.maps.get(s.map_id) || "", label: infos.map(x => x.name).join(" · "), infos, order: i });
    });
    raw.forEach(x => {
      if(!x.setKey || !x.setLabel) return;
      const infos = fightInfos(x), k = entKey(infos);
      if(!ents.has(k)) ents.set(k, { key: k, map: x.map || "", label: x.setLabel, infos, order: 1000 + ents.size });
    });
    return ents;
  }

  // entKey -> scenKey -> player -> best {score, date, key, opp}   (only fights passing keep())
  function collect(raw, ents, keep, perClan){
    const out = new Map();
    raw.forEach(x => {
      if(!x.setKey || !keep(x)) return;
      const k = entKey(fightInfos(x)), e = ents.get(k);
      if(!e) return;
      const sc = scenario(e.infos, x.date.getMonth() + 1).key;
      Object.entries(x.playerScores || {}).forEach(([name, v]) => {
        const s = parseScoreVal(v);
        if(s == null) return;
        const byScen = out.get(k) || out.set(k, new Map()).get(k);
        const byPl = byScen.get(sc) || byScen.set(sc, new Map()).get(sc);
        const pk = perClan ? x.clan + "\u0000" + name : name;
        const cur = byPl.get(pk);
        if(!cur || s > cur.score || (s === cur.score && x.date < cur.date)) byPl.set(pk, { name, clan: x.clan, score: s, date: x.date, key: x.key, opp: x.opp });
      });
    });
    return out;
  }
  const top3 = byPl => byPl ? [...byPl.values()].sort((a, b) => b.score - a.score || a.date - b.date).slice(0, 3) : [];

  // month -> scenario rows for a set, like the sheet ("1C (3/4/5/8/10)")
  function scenarioRows(ent){
    const m = new Map();
    for(let mo = 1; mo <= 12; mo++){
      const s = scenario(ent.infos, mo);
      if(!m.has(s.key)) m.set(s.key, Object.assign({ months: [] }, s));
      m.get(s.key).months.push(mo);
    }
    return [...m.values()].sort((a, b) => a.n - b.n || a.key.localeCompare(b.key));
  }

  // ---- Analytics section ---------------------------------------------
  window.recRender = function(){
    const el = document.getElementById("anRecords");
    if(!el) return;
    if(!DATA){ el.innerHTML = `<p class="hint">${escapeHtml(LOAD_ERR || "Loading data.json…")}</p>`; return; }
    const all = allClansOn();
    const raw = anCollectRaw(all), ents = buildEntities(raw);
    const recs = collect(raw, ents, () => true, all);
    const mapF = (document.getElementById("recMap") || {}).value || "";
    const unknown = new Set();
    raw.forEach(x => (x.setLabel || "").split(" · ").filter(Boolean).forEach(n => { if(!findFish(n)) unknown.add(n); }));

    let html = "", lastMap = null;
    [...ents.values()].filter(e => !mapF || e.map === mapF).sort((a, b) => a.order - b.order).forEach(e => {
      const rows = scenarioRows(e), sc = recs.get(e.key) || new Map();
      if(e.map !== lastMap){ html += `<tr class="rec-map"><td colspan="6">${escapeHtml(e.map || "(no map)")}</td></tr>`; lastMap = e.map; }
      rows.forEach((r, i) => {
        const t = top3(sc.get(r.key)), cls = ["gold", "silver", "bronze"];
        const cells = [0, 1, 2].map(j => t[j]
          ? `<td class="rec-${cls[j]} clickable-cell" data-ts="${t[j].date.getTime()}" data-clan="${escapeHtml(t[j].clan || "")}" title="Open this fight${t[j].opp ? " (vs " + escapeHtml(t[j].opp) + ")" : ""}"><b>${escapeHtml(t[j].name)}</b> ${anFmtN(t[j].score)}<div class="rec-date">${anFmtDate(t[j].date)}${all && t[j].clan ? " · " + escapeHtml(t[j].clan) : ""}</div></td>`
          : `<td class="rec-${cls[j]} rec-empty"></td>`).join("");
        const months = r.n === 0 && r.months.length === 12 ? "all year" : r.months.join("/");
        html += `<tr>${i === 0 ? `<td class="left rec-set" rowspan="${rows.length}">${escapeHtml(e.label)}</td>` : ""}` +
          `<td class="rec-oos">${escapeHtml(r.label)}</td><td class="rec-months">${months}</td>${cells}</tr>`;
      });
    });
    el.innerHTML = `<div class="an-table-scroll"><table class="an-table rec-table"><thead><tr>
      <th class="left">Set</th><th title="Out-of-season fish: C common, R rare, E epic">OOS</th><th>Months</th><th>1st</th><th>2nd</th><th>3rd</th></tr></thead>
      <tbody>${html}</tbody></table></div>` +
      (unknown.size ? `<p class="hint an-missing">Not found in data.json (treated as in-season): ${[...unknown].map(escapeHtml).join(", ")}</p>` : "") +
      `<p class="hint" style="text-align:left">C/R/E = how many common/rare/epic fish of the set are out of season in those months.</p>`;
    el.querySelectorAll("td[data-ts]").forEach(td => td.addEventListener("click", () => anOpenFight(new Date(+td.dataset.ts), td.dataset.clan)));
  };
  const recSel = document.getElementById("recMap");
  if(recSel) recSel.addEventListener("change", () => window.recRender());
  const recAll = document.getElementById("recAllClans");
  if(recAll) recAll.addEventListener("change", () => window.recRender());

  // ---- Calendar: target score for a planned fight ---------------------------
  // After the pre-fight data (map + 4 fish) is in, show what each player should
  // aim for: the average opponent score seen on the same set in the same OOS
  // scenario (month-dependent), taken at the 75th percentile (we want to win, not to tie the average), split over the players that count, rounded up to 50.
  // weighted percentile of [value, weight] pairs: the goal is always to WIN, so we aim at the
  // upper part of what comparable opponents scored, not at their average
  function wPct(pairs, p){
    const s = [...pairs].sort((a, b) => a[0] - b[0]), tot = s.reduce((t, x) => t + x[1], 0);
    let c = 0;
    for(const [v, w] of s){ c += w; if(c >= p * tot - 1e-9) return v; }
    return s[s.length - 1][0];
  }
  window.recTargets = function(){
    if(!DATA) return () => null;
    const raw = anCollectRaw().filter(x => x.scored && x.setKey);
    const n = typeof SCORE_COUNTING_PLAYERS === "number" ? SCORE_COUNTING_PLAYERS : 5;
    return function(fight, date){
      const names = (fight.fishSet || []).filter(Boolean);
      if(!fight.mapName || names.length < 4) return null;
      const infos = names.map(info), k = entKey(infos);
      const month = date.getMonth() + 1, scn = scenario(infos, month);
      const self = dateKey(date.getFullYear(), date.getMonth(), date.getDate());
      const same = raw.filter(x => entKey(fightInfos(x)) === k && x.key !== self);
      // rest months are not real wars -> leave them out
      // also skip fights where the opponent score is 0 (forfeit / unread score) - not a benchmark
      const live = same.filter(x => !x.isRest && x.their > 0);
      let pool = live.filter(x => scenario(infos, x.date.getMonth() + 1).key === scn.key), approx = false;
      if(!pool.length){ pool = live; approx = true; }
      if(!pool.length) return null;
      // an opponent that scored far below the rest on this set (e.g. 4 763 among ~9 000) was
      // not a real benchmark -> drop scores under 70% of the median
      const srt = pool.map(x => x.their).sort((p, q) => p - q), med = srt[Math.floor((srt.length - 1) / 2)] / 2 + srt[Math.ceil((srt.length - 1) / 2)] / 2;
      const kept = pool.filter(x => x.their >= 0.7 * med), dropped = pool.length - kept.length;
      if(kept.length) pool = kept;
      // weak opponents must not drag the target down: weight each past fight by how close
      // that opponent's trophies were to today's opponent (needs 2+ fights with trophies)
      const t0 = parseScoreVal(fight.oppTrophies), withT = pool.filter(x => x.oppTrophies != null);
      let team, weighted = false, near = "";
      if(t0 && withT.length >= 2){
        const w = x => 1 / (1 + ((x.oppTrophies - t0) / (0.1 * t0)) ** 2);
        team = wPct(withT.map(x => [x.their, w(x)]), 0.75);
        weighted = true;
        near = [...withT].sort((p, q) => Math.abs(p.oppTrophies - t0) - Math.abs(q.oppTrophies - t0)).slice(0, 3)
          .map(x => `${anFmtN(x.oppTrophies)}🏆→${anFmtN(x.their)}`).join(", ");
      } else team = wPct(pool.map(x => [x.their, 1]), 0.75);
      if(!(team > 0)) return null;
      return { per: Math.ceil(team / n / 50) * 50, team: Math.round(team), n: pool.length, scn: scn.label, approx, weighted, near, dropped };
    };
  };

  // ---- Recap: new #1 records set in a given month ---------------
  // Only entries that beat an existing holder count (first fights of a
  // set+scenario are never "records").
  window.recNewRecords = function(monthKey){
    if(!DATA) return [];
    const raw = anCollectRaw(), ents = buildEntities(raw);
    const before = collect(raw, ents, x => x.key < monthKey + "-01");
    const after = collect(raw, ents, x => x.monthKey <= monthKey);
    const gold = [];
    after.forEach((byScen, ek) => byScen.forEach((byPl, sk) => {
      const a = top3(byPl), b = top3(before.get(ek) && before.get(ek).get(sk));
      a.forEach((h, i) => {
        if(h.key.slice(0, 7) !== monthKey || b.length <= i) return;
        const e = ents.get(ek), scn = scenario(e.infos, h.date.getMonth() + 1);
        if(i === 0) gold.push({ rank: i + 1, name: h.name, score: h.score, prev: b[i], set: e.label, scn: scn.n ? scn.label : "" });
      });
    }));
    const out = [];
    gold.sort((x, y) => y.score - x.score).slice(0, 3).forEach(g => out.push({
      k: "records", icon: "🏆", title: "NEW SET RECORD", who: `${g.name} · ${anFmtN(g.score)}`,
      desc: `${g.set}${g.scn ? " (" + g.scn + " OOS)" : ""} — beat ${g.prev.name} ${anFmtN(g.prev.score)}`
    }));
    if(gold.length > 3 && out.length) out[out.length - 1].desc += ` · +${gold.length - 3} more record(s)`;
    return out;
  };
})();