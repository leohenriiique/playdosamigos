import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Users, Shuffle, Trophy, ClipboardList, Plus, Trash2, Waves,
  ChevronDown, ChevronUp, RotateCcw, Check, Medal, Sun, ListOrdered,
  Swords, Crown, Coffee, Star, X as XIcon, ArrowLeft, Loader2, AlertCircle, Calendar, Search
} from "lucide-react";
import {
  listTournaments, createTournament, loadTournament,
  saveTournamentData, deleteTournament, fetchAllTournamentsFull, setTournamentStatus,
} from "./lib/tournaments";
import { findOrCreateAthlete, createAthletesBulk, searchAthletes } from "./lib/athletes";
import { signIn, signOut, getSession, onAuthChange } from "./lib/auth";

/* ---------------------------------------------------------------
   HELPERS — geral
----------------------------------------------------------------*/
const uid = () => Math.random().toString(36).slice(2, 10);
const CATEGORIES = ["A", "B", "C", "D"];

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const key2 = (a, b) => [a, b].sort().join("_");

function nameOf(athletes, id) {
  return athletes.find((a) => a.id === id)?.name || "?";
}
function athleteOf(athletes, id) {
  return athletes.find((a) => a.id === id);
}
function nameWithCategory(athletes, id) {
  const a = athleteOf(athletes, id);
  if (!a) return "?";
  return a.category ? `${a.name} (${a.category})` : a.name;
}

const CATEGORY_META = {
  A: { class: "bt-chip-gold" },
  B: { class: "bt-chip-turquoise" },
  C: { class: "bt-chip-coral" },
  D: { class: "bt-chip-neutral" },
};
function CategoryBadge({ category }) {
  if (!category) return null;
  const meta = CATEGORY_META[category] || CATEGORY_META.D;
  return <span className={`bt-chip ${meta.class}`}>{category}</span>;
}

/* ---------------------------------------------------------------
   HELPERS — sorteio de chaves (duplas fixas)
----------------------------------------------------------------*/
function circleRoundRobin(ids) {
  let arr = [...ids];
  if (arr.length % 2 !== 0) arr.push(null);
  const n = arr.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const roundPairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a != null && b != null) roundPairs.push([a, b]);
    }
    rounds.push(roundPairs);
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }
  return rounds;
}

function chunkPairs(ids) {
  const pairs = [];
  for (let i = 0; i < ids.length; i += 2) {
    if (ids[i + 1]) pairs.push([ids[i], ids[i + 1]]);
  }
  return pairs;
}

// Forma duplas evitando juntar dois jogadores da categoria A na mesma dupla.
function formDuplasAvoidingDoubleA(memberIds, athletesMap) {
  const aIds = shuffle(memberIds.filter((id) => athletesMap[id]?.category === "A"));
  const otherIds = shuffle(memberIds.filter((id) => athletesMap[id]?.category !== "A"));
  const pairs = [];
  let ai = 0, oi = 0;
  while (ai < aIds.length && oi < otherIds.length) {
    pairs.push([aIds[ai], otherIds[oi]]);
    ai++; oi++;
  }
  const leftoverA = aIds.slice(ai);
  for (let i = 0; i < leftoverA.length; i += 2) {
    if (leftoverA[i + 1]) pairs.push([leftoverA[i], leftoverA[i + 1]]);
  }
  const leftoverOther = otherIds.slice(oi);
  for (let i = 0; i < leftoverOther.length; i += 2) {
    if (leftoverOther[i + 1]) pairs.push([leftoverOther[i], leftoverOther[i + 1]]);
  }
  return pairs;
}

// Distribui entidades (duplas ou jogadores) pelas chaves, espalhando primeiro
// as entidades "cabeça de chave" (categoria A) para evitar concentração.
// Calcula o tamanho de cada chave a partir do total disponível, distribuindo o
// mais igualmente possível — quando não divide exato, as primeiras chaves ficam
// com 1 a mais em vez de deixar gente de fora.
function computeGroupSizes(total, numGroups) {
  if (numGroups <= 0) return [];
  const base = Math.floor(total / numGroups);
  const remainder = total % numGroups;
  return Array.from({ length: numGroups }, (_, i) => base + (i < remainder ? 1 : 0));
}

function distributeWithSeeding(entities, numGroups, isSeed) {
  const capacities = computeGroupSizes(entities.length, numGroups);
  const groups = Array.from({ length: numGroups }, () => []);
  const seeds = shuffle(entities.filter(isSeed));
  const rest = shuffle(entities.filter((e) => !isSeed(e)));
  let gi = 0;
  const place = (item) => {
    let attempts = 0;
    while (groups[gi % numGroups].length >= capacities[gi % numGroups] && attempts < numGroups) {
      gi++; attempts++;
    }
    groups[gi % numGroups].push(item);
    gi++;
  };
  seeds.forEach(place);
  rest.forEach(place);
  return groups;
}

/* ---------------------------------------------------------------
   HELPERS — sorteio de chaves (rotativo / todos contra todos)
----------------------------------------------------------------*/
function tryMatchPartners(players, usedPairs, callBudget) {
  function backtrack(list, budget) {
    if (budget.n <= 0) return null;
    budget.n -= 1;
    if (list.length === 0) return [];
    const [first, ...rest] = list;
    for (let i = 0; i < rest.length; i++) {
      const partner = rest[i];
      if (usedPairs.has(key2(first, partner))) continue;
      const remaining = rest.filter((_, idx) => idx !== i);
      const sub = backtrack(remaining, budget);
      if (sub !== null) return [[first, partner], ...sub];
    }
    return null;
  }
  return backtrack(shuffle(players), callBudget);
}

function generateRotationSchedule(playerIds) {
  const N = playerIds.length;
  if (N < 4) return [];
  const active = 4 * Math.floor(N / 4);
  const byesPerRound = N - active;
  const totalPairsNeeded = (N * (N - 1)) / 2;
  const pairsPerRound = 2 * Math.floor(N / 4);
  const estRounds = Math.ceil(totalPairsNeeded / pairsPerRound);
  const safetyRounds = estRounds + 30;

  const usedPairs = new Set();
  const byeCount = {};
  playerIds.forEach((id) => (byeCount[id] = 0));
  const rounds = [];
  let remainingPairs = totalPairsNeeded;

  while (remainingPairs > 0 && rounds.length < safetyRounds) {
    let matched = null;
    let byeSet = [];
    let tries = 0;

    while (matched === null && tries < 50) {
      const ordered = shuffle(playerIds).sort((a, b) => byeCount[a] - byeCount[b]);
      byeSet = byesPerRound > 0 ? ordered.slice(0, byesPerRound) : [];
      const activePlayers = playerIds.filter((id) => !byeSet.includes(id));
      matched = tryMatchPartners(activePlayers, usedPairs, { n: 400 });
      tries++;
    }

    if (matched === null) break;

    byeSet.forEach((id) => (byeCount[id] += 1));
    matched.forEach(([a, b]) => usedPairs.add(key2(a, b)));
    remainingPairs -= matched.length;

    const shuffledDuplas = shuffle(matched);
    const matches = [];
    for (let i = 0; i < shuffledDuplas.length; i += 2) {
      matches.push({ side1: shuffledDuplas[i], side2: shuffledDuplas[i + 1] });
    }
    rounds.push({ matches, byes: byeSet });
  }

  return rounds;
}

function estimateRotationRounds(n) {
  if (n < 4) return 0;
  const totalPairsNeeded = (n * (n - 1)) / 2;
  const pairsPerRound = 2 * Math.floor(n / 4);
  return Math.ceil(totalPairsNeeded / pairsPerRound);
}

/* ---------------------------------------------------------------
   HELPERS — estatísticas e classificação
----------------------------------------------------------------*/
function computeStandings(athletes, groups) {
  const stats = {};
  athletes.forEach((a) => {
    stats[a.id] = { id: a.id, name: a.name, gamesWon: 0, gamesLost: 0, matches: 0, wins: 0 };
  });
  groups.forEach((g) => {
    (g.matches || []).forEach((m) => {
      if (!m.played) return;
      const g1 = Number(m.games1), g2 = Number(m.games2);
      m.side1Ids.forEach((pid) => {
        if (!stats[pid]) return;
        stats[pid].gamesWon += g1;
        stats[pid].gamesLost += g2;
        stats[pid].matches += 1;
        if (g1 > g2) stats[pid].wins += 1;
      });
      m.side2Ids.forEach((pid) => {
        if (!stats[pid]) return;
        stats[pid].gamesWon += g2;
        stats[pid].gamesLost += g1;
        stats[pid].matches += 1;
        if (g2 > g1) stats[pid].wins += 1;
      });
    });
  });
  return stats;
}

function metricValue(entry, key) {
  if (key === "saldo") return entry.gamesWon - entry.gamesLost;
  if (key === "wins") return entry.wins;
  return entry.gamesWon; // "gamesWon" (soma de games) — padrão
}

// Ordem de critérios: o escolhido (sortBy) primeiro, os outros dois como desempate,
// nessa ordem fixa de prioridade.
function criteriaOrder(sortBy) {
  const all = ["gamesWon", "saldo", "wins"];
  return [sortBy, ...all.filter((k) => k !== sortBy)];
}

// Tie-break por confronto direto — só se aplica quando dá pra identificar exatamente
// os dois lados de uma partida já jogada entre as duas duplas empatadas (modo "duplas
// fixas"). No modo rotativo os parceiros mudam a cada jogo, então não existe um
// "confronto direto" único entre dois jogadores — nesse caso o empate vai pro critério
// alfabético mesmo.
function headToHeadCompare(a, b, matches) {
  if (!matches || !a.playerIds || !b.playerIds) return 0;
  const sameSide = (ids, side) => ids.length === side.length && ids.every((id) => side.includes(id));
  const match = matches.find((m) => {
    if (!m.played) return false;
    const s1 = m.side1Ids || [];
    const s2 = m.side2Ids || [];
    return (sameSide(a.playerIds, s1) && sameSide(b.playerIds, s2)) || (sameSide(a.playerIds, s2) && sameSide(b.playerIds, s1));
  });
  if (!match) return 0;
  const aIsSide1 = sameSide(a.playerIds, match.side1Ids || []);
  const g1 = Number(match.games1), g2 = Number(match.games2);
  const aGames = aIsSide1 ? g1 : g2;
  const bGames = aIsSide1 ? g2 : g1;
  return bGames - aGames;
}

function rankPlayers(list, sortBy = "gamesWon", matches = null) {
  const order = criteriaOrder(sortBy);
  return [...list].sort((a, b) => {
    for (const key of order) {
      const diff = metricValue(b, key) - metricValue(a, key);
      if (diff !== 0) return diff;
    }
    const h2h = headToHeadCompare(a, b, matches);
    if (h2h !== 0) return h2h;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

const SORT_LABELS = { gamesWon: "Soma de games", saldo: "Saldo de games", wins: "Vitórias" };

/* ---------------------------------------------------------------
   HELPERS — ranking geral (soma resultados de todos os campeonatos,
   por id global do atleta — ver src/lib/athletes.js)
----------------------------------------------------------------*/
function computeGlobalRanking(tournamentsFull) {
  const stats = {};

  const bump = (pid, name, gamesFor, gamesAgainst, tournamentId) => {
    if (!pid) return;
    if (!stats[pid]) {
      stats[pid] = { id: pid, name: name || "—", gamesWon: 0, gamesLost: 0, matches: 0, wins: 0, tournamentIds: new Set() };
    }
    if (name) stats[pid].name = name;
    stats[pid].gamesWon += gamesFor;
    stats[pid].gamesLost += gamesAgainst;
    stats[pid].matches += 1;
    if (gamesFor > gamesAgainst) stats[pid].wins += 1;
    stats[pid].tournamentIds.add(tournamentId);
  };

  tournamentsFull.forEach((t) => {
    const d = t.data || {};
    const athletesById = Object.fromEntries((d.athletes || []).map((a) => [a.id, a]));

    (d.groups || []).forEach((g) => {
      (g.matches || []).forEach((m) => {
        if (!m.played) return;
        const g1 = Number(m.games1), g2 = Number(m.games2);
        (m.side1Ids || []).forEach((pid) => bump(pid, athletesById[pid]?.name, g1, g2, t.id));
        (m.side2Ids || []).forEach((pid) => bump(pid, athletesById[pid]?.name, g2, g1, t.id));
      });
    });

    (d.playoff?.rounds || []).forEach((round) => {
      (round.matches || []).forEach((m) => {
        if (!m.played || m.isBye) return;
        const g1 = Number(m.games1), g2 = Number(m.games2);
        (m.side1?.playerIds || []).forEach((pid) => bump(pid, athletesById[pid]?.name, g1, g2, t.id));
        (m.side2?.playerIds || []).forEach((pid) => bump(pid, athletesById[pid]?.name, g2, g1, t.id));
      });
    });
  });

  return Object.values(stats).map((s) => ({
    ...s,
    saldo: s.gamesWon - s.gamesLost,
    tournamentsPlayed: s.tournamentIds.size,
  }));
}

function rankDuplasInGroup(group, stats, athletes, sortBy = "gamesWon") {
  const list = (group.pairs || []).map((p) => {
    const s = stats[p.playerIds[0]] || { gamesWon: 0, gamesLost: 0, wins: 0, matches: 0 };
    return {
      id: p.id,
      name: p.playerIds.map((id) => nameOf(athletes, id)).join(" / "),
      playerIds: p.playerIds,
      gamesWon: s.gamesWon,
      gamesLost: s.gamesLost,
      wins: s.wins,
      matches: s.matches,
    };
  });
  return rankPlayers(list, sortBy, group.matches);
}

function computeQualifiers(athletes, groups, classConfig) {
  const stats = computeStandings(athletes, groups);
  const sortBy = classConfig.sortBy || "gamesWon";
  const groupRankings = groups.map((g) => {
    const ranked =
      g.mode === "fixed"
        ? rankDuplasInGroup(g, stats, athletes, sortBy)
        : rankPlayers(g.memberAthleteIds.map((id) => stats[id]).filter(Boolean), sortBy, g.matches);
    return { group: g, ranked };
  });

  // Ranking geral: todos os inscritos (ou duplas) juntos, numa lista só, ignorando
  // a fronteira de chave — usado tanto pra exibir quanto, se escolhido, pra extrair
  // os classificados.
  const allWithGroupInfo = groupRankings.flatMap(({ group, ranked }) =>
    ranked.map((p, i) => ({ ...p, groupName: group.name, groupPosition: i + 1 }))
  );
  const overallRanking = rankPlayers(allWithGroupInfo, sortBy);

  let direct = [];
  let extras = [];

  if (classConfig.source === "geral") {
    const n = Math.max(0, classConfig.geralCount || 0);
    direct = overallRanking.slice(0, n).map((p) => ({ ...p, position: p.groupPosition }));
  } else if (classConfig.source === "top2_terceiro") {
    // Os 2 melhores do ranking geral classificam direto; nas chaves de onde eles
    // saíram, o 3º colocado daquela chave também classifica.
    direct = overallRanking.slice(0, 2).map((p) => ({ ...p, position: p.groupPosition }));
    const sourceGroupNames = [...new Set(direct.map((p) => p.groupName))];
    const bonusThirds = [];
    sourceGroupNames.forEach((gName) => {
      const gr = groupRankings.find(({ group }) => group.name === gName);
      if (gr && gr.ranked[2]) {
        bonusThirds.push({ ...gr.ranked[2], groupName: gName, position: 3 });
      }
    });
    extras = rankPlayers(bonusThirds, sortBy);
  } else {
    const topN = classConfig.topPerGroup;
    const tiers = [];
    for (let pos = 0; pos < topN; pos++) {
      const tierEntries = [];
      groupRankings.forEach(({ group, ranked }) => {
        if (ranked[pos]) tierEntries.push({ ...ranked[pos], groupName: group.name, position: pos + 1 });
      });
      tiers.push(rankPlayers(tierEntries, sortBy));
    }
    direct = tiers.flat();

    const posIdx = classConfig.extraPosition - 1;
    if (classConfig.extraPosition > topN && classConfig.extraCount > 0) {
      const candidates = groupRankings
        .map(({ group, ranked }) =>
          ranked[posIdx] ? { ...ranked[posIdx], groupName: group.name, position: posIdx + 1 } : null
        )
        .filter(Boolean);
      extras = rankPlayers(candidates, sortBy).slice(0, classConfig.extraCount);
    }
  }

  return { direct, extras, combinedSeeded: [...direct, ...extras], groupRankings, overallRanking };
}

/* ---------------------------------------------------------------
   HELPERS — fase eliminatória (mata-mata)
----------------------------------------------------------------*/
function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function seedOrder(size) {
  if (size <= 1) return [1];
  let seeds = [1, 2];
  while (seeds.length < size) {
    const s = seeds.length * 2 + 1;
    const next = [];
    seeds.forEach((sd) => {
      next.push(sd);
      next.push(s - sd);
    });
    seeds = next;
  }
  return seeds;
}

function roundNameFor(playersRemaining) {
  switch (playersRemaining) {
    case 2: return "Final";
    case 4: return "Semifinal";
    case 8: return "Quartas de final";
    case 16: return "Oitavas de final";
    case 32: return "16-avos de final";
    case 64: return "32-avos de final";
    default: return `Rodada de ${playersRemaining}`;
  }
}

function formPlayoffEntries(combinedSeeded, mode, rotationPairing) {
  if (mode === "fixed") {
    return { entries: combinedSeeded.map((d) => ({ id: d.id, name: d.name, playerIds: d.playerIds })), odd: null, unpaired: [] };
  }

  const pairMode = rotationPairing?.pairMode || "seed";

  if (pairMode === "manual") {
    const manualPairs = rotationPairing?.manualPairs || [];
    const byId = new Map(combinedSeeded.map((p) => [p.id, p]));
    const entries = [];
    const usedIds = new Set();
    manualPairs.forEach((pair) => {
      const p1 = byId.get(pair.playerIds[0]);
      const p2 = byId.get(pair.playerIds[1]);
      if (p1 && p2) {
        entries.push({ id: pair.id, name: `${p1.name} / ${p2.name}`, playerIds: [p1.id, p2.id] });
        usedIds.add(p1.id);
        usedIds.add(p2.id);
      }
    });
    const unpaired = combinedSeeded.filter((p) => !usedIds.has(p.id));
    return { entries, odd: unpaired.length === 1 ? unpaired[0] : null, unpaired };
  }

  let ordered = combinedSeeded;
  if (pairMode === "draw") {
    const order = rotationPairing?.drawOrder;
    const valid = order && order.length === combinedSeeded.length && order.every((id) => combinedSeeded.some((p) => p.id === id));
    if (valid) {
      const byId = new Map(combinedSeeded.map((p) => [p.id, p]));
      ordered = order.map((id) => byId.get(id));
    }
  }

  const entries = [];
  let odd = null;
  for (let i = 0; i < ordered.length; i += 2) {
    if (ordered[i + 1]) {
      entries.push({
        id: uid(),
        name: `${ordered[i].name} / ${ordered[i + 1].name}`,
        playerIds: [ordered[i].id, ordered[i + 1].id],
      });
    } else {
      odd = ordered[i];
    }
  }
  return { entries, odd, unpaired: odd ? [odd] : [] };
}

function buildPlayoffBracket(entries) {
  const M = entries.length;
  if (M < 2) return null;
  const size = nextPow2(M);
  const order = seedOrder(size);
  const slots = order.map((seedNum) => entries[seedNum - 1] || null);
  const matches = [];
  for (let i = 0; i < slots.length; i += 2) {
    const p1 = slots[i], p2 = slots[i + 1];
    let winnerId = null, played = false, isBye = false;
    if (p1 && !p2) { winnerId = p1.id; played = true; isBye = true; }
    if (p2 && !p1) { winnerId = p2.id; played = true; isBye = true; }
    matches.push({ id: uid(), side1: p1, side2: p2, games1: "", games2: "", played, winnerId, isBye });
  }
  return { size, rounds: [{ name: roundNameFor(size), matches }] };
}

// Monta a 1ª rodada a partir de confrontos escolhidos manualmente pelo organizador
// (quem enfrenta quem), em vez da distribuição automática por classificação.
// "manualMatchups" segue o mesmo formato do ManualPairBuilder: [{ id, playerIds: [entryIdA, entryIdB] }]
function buildPlayoffBracketManual(entries, manualMatchups) {
  if (entries.length < 2) return null;
  const byId = new Map(entries.map((e) => [e.id, e]));
  const matches = [];
  const usedIds = new Set();

  (manualMatchups || []).forEach((mm) => {
    const s1 = byId.get(mm.playerIds[0]);
    const s2 = byId.get(mm.playerIds[1]);
    if (!s1 && !s2) return;
    if (s1) usedIds.add(s1.id);
    if (s2) usedIds.add(s2.id);
    let winnerId = null, played = false, isBye = false;
    if (s1 && !s2) { winnerId = s1.id; played = true; isBye = true; }
    if (s2 && !s1) { winnerId = s2.id; played = true; isBye = true; }
    matches.push({ id: uid(), side1: s1 || null, side2: s2 || null, games1: "", games2: "", played, winnerId, isBye });
  });

  // quem ficou de fora dos confrontos definidos avança direto (bye), pra não travar o torneio
  entries.filter((e) => !usedIds.has(e.id)).forEach((e) => {
    matches.push({ id: uid(), side1: e, side2: null, games1: "", games2: "", played: true, winnerId: e.id, isBye: true });
  });

  if (matches.length === 0) return null;
  const size = nextPow2(entries.length);
  return { size, rounds: [{ name: roundNameFor(size), matches }] };
}

/* ---------------------------------------------------------------
   THEME
----------------------------------------------------------------*/
const Theme = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Archivo+Black&family=Inter:wght@400;500;600;700&display=swap');

    .bt-root { font-family: 'Inter', sans-serif; background: var(--sand); color: var(--ink); min-height: 100%; }
    :root {
      --sand: #F2F5F9;
      --sand-deep: #DCE4EE;
      --ocean-deep: #123E72;
      --ocean: #1C57A5;
      --turquoise: #E8952E;
      --coral: #D1451A;
      --ink: #1A2530;
      --white: #FFFFFF;
    }
    .font-display { font-family: 'Space Grotesk', sans-serif; }
    .font-score { font-family: 'Archivo Black', sans-serif; }

    .bt-bg-sand { background: var(--sand); }
    .bt-bg-sand-deep { background: var(--sand-deep); }
    .bt-bg-ocean-deep { background: var(--ocean-deep); }
    .bt-bg-ocean { background: var(--ocean); }
    .bt-bg-turquoise { background: var(--turquoise); }
    .bt-bg-coral { background: var(--coral); }
    .bt-bg-white { background: var(--white); }
    .bt-text-ocean-deep { color: var(--ocean-deep); }
    .bt-text-ocean { color: var(--ocean); }
    .bt-text-coral { color: var(--coral); }
    .bt-text-turquoise { color: var(--turquoise); }
    .bt-text-ink { color: var(--ink); }
    .bt-border-ocean { border-color: var(--ocean); }
    .bt-border-sand-deep { border-color: var(--sand-deep); }

    .bt-card { background: var(--white); border: 1px solid var(--sand-deep); border-radius: 18px; }

    .bt-wave-divider {
      height: 28px; background: var(--ocean-deep);
      -webkit-mask-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 20' preserveAspectRatio='none'><path d='M0 10 C 10 0, 20 0, 30 10 C 40 20, 50 20, 60 10 C 70 0, 80 0, 90 10 C 100 20, 110 20, 120 10 L120 20 L0 20 Z'/></svg>");
      mask-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 20' preserveAspectRatio='none'><path d='M0 10 C 10 0, 20 0, 30 10 C 40 20, 50 20, 60 10 C 70 0, 80 0, 90 10 C 100 20, 110 20, 120 10 L120 20 L0 20 Z'/></svg>");
      -webkit-mask-size: 100% 100%; mask-size: 100% 100%;
    }

    .bt-tab {
      display: flex; align-items: center; gap: 6px; padding: 10px 16px; border-radius: 999px;
      font-weight: 600; font-size: 14px; white-space: nowrap; transition: all .15s ease;
      cursor: pointer; border: 2px solid transparent;
    }
    .bt-tab-active { background: var(--coral); color: var(--white); }
    .bt-tab-inactive { background: var(--white); color: var(--ocean-deep); border-color: var(--sand-deep); }
    .bt-tab-inactive:hover { border-color: var(--turquoise); }

    .bt-input {
      border: 2px solid var(--sand-deep); border-radius: 10px; padding: 8px 12px;
      background: var(--white); color: var(--ink); font-family: 'Inter', sans-serif;
      outline: none; transition: border-color .15s ease;
    }
    .bt-input:focus { border-color: var(--turquoise); }
    .bt-input:disabled { opacity: 0.5; }
    .bt-input[type=number]::-webkit-inner-spin-button,
    .bt-input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
    .bt-input[type=number] { -moz-appearance: textfield; appearance: textfield; }

    .bt-btn {
      display: inline-flex; align-items: center; gap: 8px; justify-content: center;
      padding: 10px 18px; border-radius: 12px; font-weight: 700; font-size: 14px;
      cursor: pointer; transition: transform .1s ease, opacity .15s ease; border: none;
      font-family: 'Space Grotesk', sans-serif;
    }
    .bt-btn:active { transform: scale(0.97); }
    .bt-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .bt-btn-primary { background: var(--ocean-deep); color: var(--white); }
    .bt-btn-primary:hover:not(:disabled) { background: var(--ocean); }
    .bt-btn-coral { background: var(--coral); color: var(--white); }
    .bt-btn-coral:hover:not(:disabled) { opacity: 0.9; }
    .bt-btn-outline { background: transparent; color: var(--ocean-deep); border: 2px solid var(--ocean-deep); }
    .bt-btn-outline:hover:not(:disabled) { background: var(--ocean-deep); color: var(--white); }
    .bt-btn-sm { padding: 6px 12px; font-size: 12px; border-radius: 9px; }

    .bt-chip { display:inline-flex; align-items:center; gap:4px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
    .bt-chip-turquoise { background: rgba(232,149,46,0.18); color: var(--ocean-deep); }
    .bt-chip-coral { background: rgba(209,69,26,0.15); color: var(--coral); }
    .bt-chip-gold { background: rgba(230,180,60,0.22); color: #8a6200; }
    .bt-chip-neutral { background: rgba(26,37,48,0.08); color: var(--ink); }

    .bt-scroll::-webkit-scrollbar { height: 6px; width: 6px; }
    .bt-scroll::-webkit-scrollbar-thumb { background: var(--sand-deep); border-radius: 4px; }

    .bt-dotline { border-top: 2px dotted var(--sand-deep); }

    .bt-qualified { position: relative; }
    .bt-qualified::before {
      content: ""; position: absolute; left: -10px; top: 0; bottom: 0; width: 4px;
      background: var(--turquoise); border-radius: 4px;
    }

    .bt-option-card {
      text-align: left; border-radius: 12px; border: 2px solid transparent; padding: 12px; transition: all .15s ease;
    }
    .bt-option-card-active { border-color: var(--ocean); background: rgba(28,87,165,0.08); }
    .bt-option-card-inactive { background: var(--sand); }
  `}</style>
);

/* ---------------------------------------------------------------
   SMALL UI PARTS
----------------------------------------------------------------*/
function Section({ icon: Icon, title, subtitle, children, right }) {
  return (
    <div className="bt-card p-5 md:p-6 mb-5">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="bt-bg-ocean-deep bt-text-white rounded-xl p-2.5 flex items-center justify-center">
            <Icon size={20} color="white" />
          </div>
          <div>
            <h2 className="font-display text-lg md:text-xl font-bold bt-text-ocean-deep">{title}</h2>
            {subtitle && <p className="text-sm text-stone-500 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function EmptyState({ icon: Icon, text }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center text-stone-400">
      <Icon size={34} className="mb-2 opacity-60" />
      <p className="text-sm max-w-xs">{text}</p>
    </div>
  );
}

/* ---------------------------------------------------------------
   TAB: ATLETAS
----------------------------------------------------------------*/
function AthletesTab({ athletes, setAthletes, groupsExist }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [phone, setPhone] = useState("");
  const [instagram, setInstagram] = useState("");
  const [bulk, setBulk] = useState("");
  const [adding, setAdding] = useState(false);
  const [addingBulk, setAddingBulk] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedGlobalId, setSelectedGlobalId] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    if (selectedGlobalId) return;
    const q = name.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const results = await searchAthletes(q);
        setSuggestions(results.filter((r) => !athletes.some((a) => a.id === r.id)));
      } catch (e) {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [name, selectedGlobalId, athletes]);

  const pickSuggestion = (g) => {
    setName(g.name);
    setPhone(g.phone || "");
    setInstagram(g.instagram || "");
    setSelectedGlobalId(g.id);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const handleNameChange = (v) => {
    setName(v);
    setSelectedGlobalId(null);
    setShowSuggestions(true);
  };

  const addAthlete = async () => {
    const trimmed = name.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    setErrMsg("");
    try {
      const global = selectedGlobalId
        ? { id: selectedGlobalId, name: trimmed, phone: phone || null, instagram: instagram || null }
        : await findOrCreateAthlete({ name: trimmed, phone, instagram });
      if (athletes.some((a) => a.id === global.id)) {
        setErrMsg(`${global.name} já está na lista deste campeonato.`);
        return;
      }
      setAthletes((prev) => [
        ...prev,
        { id: global.id, name: global.name, category: category || null, phone: global.phone, instagram: global.instagram },
      ]);
      setName(""); setPhone(""); setInstagram(""); setSelectedGlobalId(null); setSuggestions([]);
    } catch (e) {
      setErrMsg("Não foi possível cadastrar o atleta agora. Tente de novo.");
    } finally {
      setAdding(false);
    }
  };

  const addBulk = async () => {
    const names = bulk.split("\n").map((n) => n.trim()).filter(Boolean);
    if (names.length === 0 || addingBulk) return;
    setAddingBulk(true);
    setErrMsg("");
    try {
      const created = await createAthletesBulk(names);
      setAthletes((prev) => [
        ...prev,
        ...created.map((g) => ({ id: g.id, name: g.name, category: null, phone: g.phone, instagram: g.instagram })),
      ]);
      setBulk("");
    } catch (e) {
      setErrMsg("Não foi possível cadastrar a lista agora. Tente de novo.");
    } finally {
      setAddingBulk(false);
    }
  };

  const removeAthlete = (id) => {
    if (groupsExist) return;
    setAthletes((prev) => prev.filter((a) => a.id !== id));
  };

  const updateCategory = (id, cat) => {
    setAthletes((prev) => prev.map((a) => (a.id === id ? { ...a, category: cat || null } : a)));
  };

  return (
    <div>
      <Section icon={Users} title="Cadastro de atletas" subtitle="Adicione os jogadores que vão participar do torneio.">
        {groupsExist && (
          <div className="bt-chip bt-chip-coral mb-4">
            Chaves já sorteadas — para editar a lista, reinicie o sorteio na aba "Sorteio".
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-3 mb-2">
          <div className="relative flex-1">
            <input
              className="bt-input w-full"
              placeholder="Nome do atleta"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onKeyDown={(e) => e.key === "Enter" && addAthlete()}
            />
            {selectedGlobalId && (
              <Check size={15} className="bt-text-turquoise absolute right-3 top-1/2 -translate-y-1/2" title="Atleta já cadastrado no ranking geral" />
            )}
            {showSuggestions && !selectedGlobalId && (searching || suggestions.length > 0) && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 bt-card shadow-lg max-h-56 overflow-y-auto">
                {searching ? (
                  <div className="px-3 py-2 text-xs text-stone-400 flex items-center gap-2">
                    <Loader2 size={13} className="animate-spin" /> Buscando…
                  </div>
                ) : (
                  suggestions.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => pickSuggestion(g)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--sand)] flex items-center gap-2"
                    >
                      <Search size={13} className="text-stone-400 shrink-0" />
                      <span className="truncate">{g.name}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <select className="bt-input sm:w-40" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Sem categoria</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>Categoria {c}</option>
            ))}
          </select>
        </div>
        {selectedGlobalId && (
          <p className="text-xs bt-text-turquoise -mt-1 mb-2 flex items-center gap-1">
            <Check size={12} /> Atleta do ranking geral selecionado — os resultados dele neste campeonato vão somar ao cadastro existente.
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <input
            className="bt-input flex-1"
            placeholder="Celular (opcional)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addAthlete()}
          />
          <input
            className="bt-input flex-1"
            placeholder="@instagram (opcional)"
            value={instagram}
            onChange={(e) => setInstagram(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addAthlete()}
          />
          <button className="bt-btn bt-btn-coral shrink-0" onClick={addAthlete} disabled={!name.trim() || adding}>
            {adding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Adicionar
          </button>
        </div>
        <p className="text-xs text-stone-400 -mt-2 mb-3">
          Comece digitando o nome — se o atleta já jogou outro campeonato, ele aparece na lista pra você selecionar (evita cadastro duplicado). Celular ou Instagram também ajudam o app a reconhecer a mesma pessoa em outros campeonatos, pro ranking geral.
        </p>

        {errMsg && (
          <p className="text-xs bt-text-coral mb-3 flex items-center gap-1">
            <AlertCircle size={13} /> {errMsg}
          </p>
        )}

        <details className="mb-2">
          <summary className="cursor-pointer text-sm font-semibold bt-text-ocean select-none">
            Adicionar vários nomes de uma vez
          </summary>
          <div className="mt-3 flex flex-col gap-2">
            <textarea
              className="bt-input w-full h-24 resize-none"
              placeholder={"Um nome por linha\nEx:\nJoão Silva\nMaria Souza"}
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
            />
            <p className="text-xs text-stone-400">
              A categoria pode ser definida depois, individualmente, na lista abaixo. Como não dá pra informar celular/Instagram aqui, cada nome vira um cadastro novo — prefira o campo acima se quiser vincular ao ranking geral de outro campeonato.
            </p>
            <button className="bt-btn bt-btn-outline self-start" onClick={addBulk} disabled={!bulk.trim() || addingBulk}>
              {addingBulk ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Adicionar lista
            </button>
          </div>
        </details>
      </Section>

      <Section icon={ListOrdered} title={`Atletas cadastrados (${athletes.length})`}>
        {athletes.length === 0 ? (
          <EmptyState icon={Users} text="Nenhum atleta cadastrado ainda. Adicione os nomes acima para começar." />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {athletes.map((a, i) => (
              <div key={a.id} className="flex items-center justify-between gap-2 bt-bg-sand rounded-xl px-3 py-2">
                <span className="text-sm font-medium bt-text-ink truncate flex items-center gap-1.5 min-w-0">
                  <span className="bt-text-ocean font-bold shrink-0">{i + 1}.</span>
                  <span className="truncate">{a.name}</span>
                  <CategoryBadge category={a.category} />
                  {(a.phone || a.instagram) && (
                    <Check size={13} className="bt-text-turquoise shrink-0" title="Identificado para o ranking geral" />
                  )}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <select
                    className="bt-input text-xs py-1 px-1.5"
                    value={a.category || ""}
                    onChange={(e) => updateCategory(a.id, e.target.value)}
                    title="Categoria"
                  >
                    <option value="">—</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => removeAthlete(a.id)}
                    disabled={groupsExist}
                    className="bt-text-coral disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-70 p-1"
                    title="Remover atleta"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------------
   Construtor de duplas manuais (modalidade duplas fixas)
----------------------------------------------------------------*/
function ManualPairBuilder({ athletes, manualPairs, setManualPairs, needed }) {
  const pairedIds = useMemo(() => new Set(manualPairs.flatMap((p) => p.playerIds)), [manualPairs]);
  const available = athletes.filter((a) => !pairedIds.has(a.id));
  const [a1, setA1] = useState("");
  const [a2, setA2] = useState("");

  const addPair = () => {
    if (!a1 || !a2 || a1 === a2) return;
    setManualPairs((prev) => [...prev, { id: uid(), playerIds: [a1, a2] }]);
    setA1(""); setA2("");
  };
  const removePair = (id) => setManualPairs((prev) => prev.filter((p) => p.id !== id));
  const clearAll = () => setManualPairs([]);

  return (
    <div className="bt-bg-sand rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="font-bold text-sm bt-text-ocean-deep">
          Duplas definidas: {manualPairs.length}/{needed}
        </p>
        {manualPairs.length > 0 && (
          <button className="text-xs bt-text-coral font-semibold" onClick={clearAll}>Limpar duplas</button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <select className="bt-input flex-1" value={a1} onChange={(e) => setA1(e.target.value)}>
          <option value="">Jogador 1</option>
          {available.filter((a) => a.id !== a2).map((a) => (
            <option key={a.id} value={a.id}>{a.category ? `${a.name} (${a.category})` : a.name}</option>
          ))}
        </select>
        <select className="bt-input flex-1" value={a2} onChange={(e) => setA2(e.target.value)}>
          <option value="">Jogador 2</option>
          {available.filter((a) => a.id !== a1).map((a) => (
            <option key={a.id} value={a.id}>{a.category ? `${a.name} (${a.category})` : a.name}</option>
          ))}
        </select>
        <button className="bt-btn bt-btn-outline shrink-0" onClick={addPair} disabled={!a1 || !a2}>
          <Plus size={16} /> Formar dupla
        </button>
      </div>

      {manualPairs.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {manualPairs.map((p, i) => (
            <div key={p.id} className="flex items-center justify-between bt-bg-white rounded-lg px-3 py-1.5">
              <span className="text-sm">
                <span className="bt-text-coral font-bold mr-1.5">{i + 1}.</span>
                {p.playerIds.map((id) => nameWithCategory(athletes, id)).join(" / ")}
              </span>
              <button onClick={() => removePair(p.id)} className="bt-text-coral hover:opacity-70 p-0.5">
                <XIcon size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {available.length < 2 && manualPairs.length < needed && (
        <p className="text-xs text-stone-400 mt-2">Cadastre mais atletas na aba "Atletas" para formar todas as duplas necessárias.</p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   TAB: SORTEIO
----------------------------------------------------------------*/
function DrawTab({ athletes, config, setConfig, onDraw, groups, onReset, manualPairs, setManualPairs }) {
  const hasCategoryA = athletes.some((a) => a.category === "A");
  const totalDuplasNeeded = config.duplasPerGroup * config.numGroups;
  const perGroupPlayers = config.mode === "fixed" ? config.duplasPerGroup * 2 : config.playersPerGroup;
  const totalNeededPlayers = perGroupPlayers * config.numGroups;

  const enough =
    config.mode === "fixed" && config.pairMode === "manual"
      ? manualPairs.length >= totalDuplasNeeded
      : athletes.length >= totalNeededPlayers;

  // Quantas "unidades" (duplas ou atletas) realmente vão para o sorteio, e como
  // elas ficam distribuídas entre as chaves (uma ou mais chaves ficam com 1 a mais
  // quando não dá pra dividir exatamente igual).
  const unitCount =
    config.mode === "fixed" && config.pairMode === "manual"
      ? manualPairs.length
      : config.mode === "fixed"
      ? Math.floor(athletes.length / 2)
      : athletes.length;
  const oddLeftover = config.mode === "fixed" && config.pairMode !== "manual" ? athletes.length % 2 : 0;
  const groupSizesPreview = enough ? computeGroupSizes(unitCount, config.numGroups) : [];

  const estRounds = config.mode === "rotation" ? estimateRotationRounds(config.playersPerGroup) : null;
  const byesPerRoundPreview =
    config.mode === "rotation" ? config.playersPerGroup - 4 * Math.floor(config.playersPerGroup / 4) : 0;

  return (
    <div>
      <Section icon={Shuffle} title="Configurar sorteio de chaves" subtitle="Defina o formato do torneio antes de sortear os atletas.">
        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <label className="text-sm font-semibold bt-text-ocean-deep block mb-2">Formato das chaves</label>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setConfig((c) => ({ ...c, mode: "fixed" }))}
                className={`bt-option-card ${config.mode === "fixed" ? "bt-option-card-active" : "bt-option-card-inactive"}`}
              >
                <p className="font-bold text-sm bt-text-ocean-deep">Duplas fixas</p>
                <p className="text-xs text-stone-500 mt-0.5">
                  As duplas permanecem as mesmas durante todo o torneio. Pontuação por sets.
                </p>
              </button>
              <button
                onClick={() => setConfig((c) => ({ ...c, mode: "rotation" }))}
                className={`bt-option-card ${config.mode === "rotation" ? "bt-option-card-active" : "bt-option-card-inactive"}`}
              >
                <p className="font-bold text-sm bt-text-ocean-deep">Todos contra todos (rotativo)</p>
                <p className="text-xs text-stone-500 mt-0.5">
                  Os parceiros mudam a cada rodada — todo mundo joga com e contra todo mundo, sem repetir duplas.
                </p>
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <label className="text-sm font-semibold bt-text-ocean-deep block mb-1.5">Quantas chaves?</label>
              <input
                type="number" min={1}
                className="bt-input w-full"
                value={config.numGroups}
                onChange={(e) => setConfig((c) => ({ ...c, numGroups: Math.max(1, Number(e.target.value)) }))}
              />
            </div>

            {config.mode === "fixed" ? (
              <div>
                <label className="text-sm font-semibold bt-text-ocean-deep block mb-1.5">Duplas por chave (mínimo)</label>
                <input
                  type="number" min={2}
                  className="bt-input w-full"
                  value={config.duplasPerGroup}
                  onChange={(e) => setConfig((c) => ({ ...c, duplasPerGroup: Math.max(2, Number(e.target.value)) }))}
                />
              </div>
            ) : (
              <div>
                <label className="text-sm font-semibold bt-text-ocean-deep block mb-1.5">Jogadores por chave (mínimo)</label>
                <input
                  type="number" min={4}
                  className="bt-input w-full"
                  value={config.playersPerGroup}
                  onChange={(e) => setConfig((c) => ({ ...c, playersPerGroup: Math.max(4, Number(e.target.value)) }))}
                />
                <p className="text-xs text-stone-400 mt-1">
                  {estRounds > 0
                    ? `Serão geradas ${estRounds} rodada(s) automaticamente para que todos joguem com todos, sem repetir duplas.`
                    : "Mínimo de 4 jogadores por chave."}
                  {byesPerRoundPreview > 0 && ` A cada rodada, ${byesPerRoundPreview} jogador(es) revezam a folga.`}
                </p>
              </div>
            )}

            {config.numGroups === 1 && (
              <label className="flex items-start gap-2 bt-bg-sand rounded-xl p-3 cursor-pointer">
                <input
                  type="checkbox" className="mt-1"
                  checked={!!config.pointsCorridosSingleGroup}
                  onChange={(e) => setConfig((c) => ({ ...c, pointsCorridosSingleGroup: e.target.checked }))}
                />
                <span className="text-sm">
                  <span className="font-bold bt-text-ocean-deep block">Campeonato de pontos corridos</span>
                  <span className="text-xs text-stone-500">
                    Com apenas uma chave, o campeão é definido direto pela tabela de classificação — sem fase eliminatória.
                  </span>
                </span>
              </label>
            )}

            {hasCategoryA && (
              <label className="flex items-start gap-2 bt-bg-sand rounded-xl p-3 cursor-pointer">
                <input
                  type="checkbox" className="mt-1"
                  checked={!!config.seedCategoryA}
                  onChange={(e) => setConfig((c) => ({ ...c, seedCategoryA: e.target.checked }))}
                />
                <span className="text-sm">
                  <span className="font-bold bt-text-ocean-deep flex items-center gap-1">
                    <Star size={13} className="bt-text-coral" /> Usar categoria A como cabeça de chave
                  </span>
                  <span className="text-xs text-stone-500">
                    Evita que dois jogadores A fiquem na mesma chave ou formem dupla aleatória entre si.
                  </span>
                </span>
              </label>
            )}
          </div>
        </div>

        {config.mode === "fixed" && (
          <div className="mt-5">
            <label className="text-sm font-semibold bt-text-ocean-deep block mb-2">Como formar as duplas?</label>
            <div className="grid sm:grid-cols-2 gap-2 mb-3">
              <button
                onClick={() => setConfig((c) => ({ ...c, pairMode: "auto" }))}
                className={`bt-option-card ${config.pairMode !== "manual" ? "bt-option-card-active" : "bt-option-card-inactive"}`}
              >
                <p className="font-bold text-sm bt-text-ocean-deep">Sortear duplas</p>
                <p className="text-xs text-stone-500 mt-0.5">As duplas são formadas aleatoriamente no sorteio.</p>
              </button>
              <button
                onClick={() => setConfig((c) => ({ ...c, pairMode: "manual" }))}
                className={`bt-option-card ${config.pairMode === "manual" ? "bt-option-card-active" : "bt-option-card-inactive"}`}
              >
                <p className="font-bold text-sm bt-text-ocean-deep">Definir duplas manualmente</p>
                <p className="text-xs text-stone-500 mt-0.5">Você escolhe quem joga com quem; as chaves ainda são sorteadas.</p>
              </button>
            </div>
            {config.pairMode === "manual" && (
              <ManualPairBuilder athletes={athletes} manualPairs={manualPairs} setManualPairs={setManualPairs} needed={totalDuplasNeeded} />
            )}
          </div>
        )}

        <div className="bt-dotline my-5" />

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="text-sm">
            {config.mode === "fixed" && config.pairMode === "manual" ? (
              <p className="bt-text-ink">
                Mínimo: <span className="font-bold">{totalDuplasNeeded}</span> duplas &nbsp;•&nbsp; Definidas:{" "}
                <span className="font-bold">{manualPairs.length}</span>
              </p>
            ) : (
              <p className="bt-text-ink">
                Mínimo: <span className="font-bold">{totalNeededPlayers}</span> atletas &nbsp;•&nbsp; Cadastrados:{" "}
                <span className="font-bold">{athletes.length}</span>
              </p>
            )}
            {!enough && (
              <p className="bt-text-coral font-semibold mt-1">
                {config.mode === "fixed" && config.pairMode === "manual"
                  ? `Faltam ${totalDuplasNeeded - manualPairs.length} dupla(s) para sortear esse formato.`
                  : `Faltam ${totalNeededPlayers - athletes.length} atletas para sortear esse formato.`}
              </p>
            )}
            {enough && groupSizesPreview.length > 0 && (
              <p className="text-stone-500 mt-1">
                As chaves ficarão com {groupSizesPreview.join(" + ")} {config.mode === "fixed" ? "duplas" : "atletas"}
                {new Set(groupSizesPreview).size > 1 && " (uma ou mais chaves com 1 a mais, pra incluir todo mundo)"}.
              </p>
            )}
            {enough && oddLeftover > 0 && (
              <p className="text-stone-500 mt-1">
                Número ímpar de atletas: 1 ficará de fora por não ser possível formar uma dupla completa.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {groups.length > 0 && (
              <button className="bt-btn bt-btn-outline" onClick={onReset}>
                <RotateCcw size={16} /> Reiniciar sorteio
              </button>
            )}
            <button className="bt-btn bt-btn-coral" onClick={onDraw} disabled={!enough}>
              <Shuffle size={16} /> Sortear chaves
            </button>
          </div>
        </div>
      </Section>

      {groups.length > 0 && (
        <Section icon={Waves} title="Chaves sorteadas" subtitle="Confira a distribuição dos atletas.">
          <div className="grid md:grid-cols-2 gap-4">
            {groups.map((g) => (
              <div key={g.id} className="bt-bg-sand rounded-xl p-4">
                <p className="font-display font-bold bt-text-ocean-deep mb-2">
                  {g.name} {g.pointsCorridos && <span className="bt-chip bt-chip-gold ml-1">Pontos corridos</span>}
                </p>
                {g.mode === "fixed" ? (
                  <ul className="space-y-1">
                    {g.pairs.map((p, i) => (
                      <li key={p.id} className="text-sm">
                        <span className="bt-text-coral font-bold mr-1">Dupla {i + 1}:</span>
                        {p.playerIds.map((id) => nameWithCategory(athletes, id)).join(" / ")}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-stone-600">
                    {g.memberAthleteIds.map((id) => nameWithCategory(athletes, id)).join(", ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   TAB: CHAVES / RESULTADOS
----------------------------------------------------------------*/
// Placar simples (usado no modo rotativo)
function SimpleMatchRow({ match, athletes, onChange }) {
  const s1 = match.side1Ids.map((id) => nameOf(athletes, id)).join(" / ");
  const s2 = match.side2Ids.map((id) => nameOf(athletes, id)).join(" / ");

  const update = (field, val) => {
    const next = { ...match, [field]: val };
    next.played = next.games1 !== "" && next.games2 !== "" && !isNaN(next.games1) && !isNaN(next.games2);
    onChange(next);
  };

  const g1 = Number(match.games1), g2 = Number(match.games2);
  const w1 = match.played && g1 > g2;
  const w2 = match.played && g2 > g1;

  return (
    <div className="flex items-center gap-3 py-2.5 px-1 bt-dotline first:border-t-0">
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${w1 ? "font-bold bt-text-ocean-deep" : "text-stone-600"}`}>{s1}</p>
      </div>
      <input type="number" min={0} className="bt-input w-14 text-center font-score text-sm" value={match.games1} onChange={(e) => update("games1", e.target.value)} />
      <span className="text-stone-400 font-bold">×</span>
      <input type="number" min={0} className="bt-input w-14 text-center font-score text-sm" value={match.games2} onChange={(e) => update("games2", e.target.value)} />
      <div className="flex-1 min-w-0 text-right">
        <p className={`text-sm truncate ${w2 ? "font-bold bt-text-ocean-deep" : "text-stone-600"}`}>{s2}</p>
      </div>
      {match.played && <Check size={16} className="bt-text-turquoise shrink-0" />}
    </div>
  );
}

// Placar por sets (usado no modo duplas fixas) — soma os games de todos os
// sets para o total (games ganhos), usado depois no saldo de games.
function SetsMatchRow({ match, athletes, onChange }) {
  const s1 = match.side1Ids.map((id) => nameOf(athletes, id)).join(" / ");
  const s2 = match.side2Ids.map((id) => nameOf(athletes, id)).join(" / ");
  const sets = match.sets && match.sets.length ? match.sets : [{ games1: "", games2: "" }];

  const recompute = (newSets) => {
    let sumG1 = 0, sumG2 = 0, allFilled = true;
    newSets.forEach((s) => {
      if (s.games1 === "" || s.games2 === "" || isNaN(s.games1) || isNaN(s.games2)) { allFilled = false; return; }
      sumG1 += Number(s.games1);
      sumG2 += Number(s.games2);
    });
    onChange({
      ...match,
      sets: newSets,
      games1: allFilled ? sumG1 : "",
      games2: allFilled ? sumG2 : "",
      played: allFilled && newSets.length > 0,
    });
  };

  const updateSet = (idx, field, val) => recompute(sets.map((s, i) => (i === idx ? { ...s, [field]: val } : s)));
  const addSet = () => sets.length < 3 && recompute([...sets, { games1: "", games2: "" }]);
  const removeSet = () => sets.length > 1 && recompute(sets.slice(0, -1));

  const setsWon1 = sets.filter((s) => s.games1 !== "" && s.games2 !== "" && Number(s.games1) > Number(s.games2)).length;
  const setsWon2 = sets.filter((s) => s.games1 !== "" && s.games2 !== "" && Number(s.games2) > Number(s.games1)).length;
  const w1 = match.played && setsWon1 > setsWon2;
  const w2 = match.played && setsWon2 > setsWon1;

  return (
    <div className="py-2.5 px-1 bt-dotline first:border-t-0">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className={`text-sm truncate ${w1 ? "font-bold bt-text-ocean-deep" : "text-stone-600"}`}>{s1}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {sets.map((s, i) => (
            <div key={i} className="flex items-center gap-1">
              <input type="number" min={0} className="bt-input w-12 text-center font-score text-sm px-1" value={s.games1} onChange={(e) => updateSet(i, "games1", e.target.value)} />
              <span className="text-stone-300 text-xs">/</span>
              <input type="number" min={0} className="bt-input w-12 text-center font-score text-sm px-1" value={s.games2} onChange={(e) => updateSet(i, "games2", e.target.value)} />
            </div>
          ))}
        </div>
        <div className="flex-1 min-w-0 text-right">
          <p className={`text-sm truncate ${w2 ? "font-bold bt-text-ocean-deep" : "text-stone-600"}`}>{s2}</p>
        </div>
      </div>
      <div className="flex items-center justify-end gap-3 mt-1">
        {sets.length > 1 && <button className="text-[11px] bt-text-coral font-semibold" onClick={removeSet}>− set</button>}
        {sets.length < 3 && <button className="text-[11px] bt-text-ocean font-semibold" onClick={addSet}>+ set</button>}
        {match.played && <Check size={14} className="bt-text-turquoise" />}
      </div>
    </div>
  );
}

function GroupCard({ group, athletes, onUpdateMatch }) {
  const [open, setOpen] = useState(true);
  const rounds = useMemo(() => {
    const map = {};
    group.matches.forEach((m) => {
      if (!map[m.round]) map[m.round] = [];
      map[m.round].push(m);
    });
    return Object.entries(map).sort((a, b) => Number(a[0]) - Number(b[0]));
  }, [group.matches]);

  const playedCount = group.matches.filter((m) => m.played).length;
  const RowComp = group.mode === "fixed" ? SetsMatchRow : SimpleMatchRow;

  return (
    <div className="bt-bg-white rounded-xl border bt-border-sand-deep overflow-hidden">
      <button className="w-full flex items-center justify-between px-4 py-3 bt-bg-sand-deep" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-display font-bold bt-text-ocean-deep">{group.name}</span>
          <span className="bt-chip bt-chip-turquoise">{group.mode === "fixed" ? "Duplas fixas · sets" : "Rotativo · sem repetir duplas"}</span>
          {group.pointsCorridos && <span className="bt-chip bt-chip-gold">Pontos corridos</span>}
          <span className="text-xs text-stone-500">{playedCount}/{group.matches.length} jogos lançados</span>
        </div>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {open && (
        <div className="p-4">
          {rounds.map(([roundNum, matches]) => {
            const byes = group.roundsMeta?.find((r) => String(r.round) === roundNum)?.byes || [];
            return (
              <div key={roundNum} className="mb-4 last:mb-0">
                <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
                  <p className="text-xs font-bold uppercase tracking-wide bt-text-coral">Rodada {roundNum}</p>
                  {byes.length > 0 && (
                    <p className="text-xs text-stone-400 flex items-center gap-1">
                      <Coffee size={12} /> Folga: {byes.map((id) => nameOf(athletes, id)).join(", ")}
                    </p>
                  )}
                </div>
                <div>
                  {matches.map((m) => (
                    <RowComp key={m.id} match={m} athletes={athletes} onChange={(next) => onUpdateMatch(group.id, next)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GroupsTab({ groups, athletes, setGroups }) {
  const onUpdateMatch = useCallback(
    (groupId, updatedMatch) => {
      setGroups((prev) =>
        prev.map((g) =>
          g.id !== groupId ? g : { ...g, matches: g.matches.map((m) => (m.id === updatedMatch.id ? updatedMatch : m)) }
        )
      );
    },
    [setGroups]
  );

  if (groups.length === 0) {
    return (
      <Section icon={ClipboardList} title="Chaves e resultados">
        <EmptyState icon={Waves} text="Nenhuma chave sorteada ainda. Vá até a aba Sorteio para gerar as chaves." />
      </Section>
    );
  }

  return (
    <Section icon={ClipboardList} title="Chaves e resultados" subtitle="Lance o placar de cada jogo (duplas fixas usam sets; rotativo usa placar único).">
      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <GroupCard key={g.id} group={g} athletes={athletes} onUpdateMatch={onUpdateMatch} />
        ))}
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------
   TAB: CLASSIFICAÇÃO
----------------------------------------------------------------*/
function StandingsTab({ athletes, groups, classConfig, setClassConfig }) {
  const { direct, extras, combinedSeeded, groupRankings, overallRanking } = useMemo(
    () => computeQualifiers(athletes, groups, classConfig),
    [athletes, groups, classConfig]
  );

  const singleGroupPoints = groups.length === 1 && groups[0].pointsCorridos;
  const sortBy = classConfig.sortBy || "gamesWon";

  if (groups.length === 0) {
    return (
      <Section icon={Trophy} title="Classificação">
        <EmptyState icon={Trophy} text="Ainda não há chaves sorteadas. Cadastre atletas e sorteie as chaves para ver a classificação." />
      </Section>
    );
  }

  if (singleGroupPoints) {
    const ranked = groupRankings[0].ranked;
    const podiumLabel = ["Campeão", "Vice-campeão", "3º lugar"];
    return (
      <div>
        <Section icon={Trophy} title="Campeonato de pontos corridos" subtitle="Chave única — a tabela abaixo define o resultado final do torneio.">
          <div className="mb-4">
            <label className="text-sm font-semibold bt-text-ocean-deep block mb-1.5">Ordenar por</label>
            <select className="bt-input" value={sortBy} onChange={(e) => setClassConfig((c) => ({ ...c, sortBy: e.target.value }))}>
              <option value="gamesWon">Soma de games</option>
              <option value="saldo">Saldo de games</option>
              <option value="wins">Vitórias</option>
            </select>
          </div>
          <div className="flex flex-col gap-2 mb-5">
            {ranked.slice(0, 3).map((p, i) => (
              <div key={p.id} className={`flex items-center justify-between rounded-lg pl-4 pr-3 py-2.5 ${i === 0 ? "bt-qualified" : ""}`} style={{ background: i === 0 ? "rgba(209,69,26,0.1)" : "var(--sand)" }}>
                <div className="flex items-center gap-2">
                  {i === 0 ? <Crown size={16} className="bt-text-coral" /> : <Medal size={16} className="bt-text-ocean" />}
                  <span className="font-semibold text-sm">{p.name}</span>
                  <span className="text-xs text-stone-500">{podiumLabel[i]}</span>
                </div>
                <span className="text-sm font-score bt-text-ocean-deep">{p.gamesWon}G</span>
              </div>
            ))}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-stone-500 text-left">
                <th className="pb-1 font-semibold">#</th>
                <th className="pb-1 font-semibold">{groups[0].mode === "fixed" ? "Dupla" : "Jogador"}</th>
                <th className="pb-1 font-semibold text-right">GV</th>
                <th className="pb-1 font-semibold text-right">GP</th>
                <th className="pb-1 font-semibold text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((p, i) => (
                <tr key={p.id} className={i < 3 ? "font-bold" : ""}>
                  <td className="py-1 bt-text-ocean-deep">{i + 1}</td>
                  <td className="py-1">{p.name}</td>
                  <td className="py-1 text-right font-score">{p.gamesWon}</td>
                  <td className="py-1 text-right font-score text-stone-500">{p.gamesLost}</td>
                  <td className="py-1 text-right font-score bt-text-coral">
                    {p.gamesWon - p.gamesLost > 0 ? "+" : ""}{p.gamesWon - p.gamesLost}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    );
  }

  const M = combinedSeeded.length;
  const size = M >= 2 ? nextPow2(M) : 0;
  const stageName = size ? roundNameFor(size) : null;
  const byesCount = size - M;
  const hasFixed = groups.some((g) => g.mode === "fixed");

  return (
    <div>
      <Section
        icon={Trophy}
        title="Critério de classificação"
        subtitle={`Ranking por ${SORT_LABELS[sortBy].toLowerCase()}; empates seguem para os outros dois critérios e, se ainda persistirem (só no modo duplas fixas), para o confronto direto entre as duplas empatadas.`}
      >
        <div className="mb-4">
          <label className="text-sm font-semibold bt-text-ocean-deep block mb-1.5">Ordenar por</label>
          <select className="bt-input" value={sortBy} onChange={(e) => setClassConfig((c) => ({ ...c, sortBy: e.target.value }))}>
            <option value="gamesWon">Soma de games</option>
            <option value="saldo">Saldo de games</option>
            <option value="wins">Vitórias</option>
          </select>
        </div>

        <div className="mb-4">
          <label className="text-sm font-semibold bt-text-ocean-deep block mb-2">De onde tirar os classificados para o mata-mata?</label>
          <div className="grid sm:grid-cols-3 gap-2 max-w-2xl">
            <button
              type="button"
              onClick={() => setClassConfig((c) => ({ ...c, source: "chave" }))}
              className={`bt-option-card text-left ${(classConfig.source || "chave") === "chave" ? "bt-option-card-active" : "bt-option-card-inactive"}`}
            >
              <p className="font-bold text-sm bt-text-ocean-deep">Por chave</p>
              <p className="text-xs text-stone-500 mt-0.5">Os melhores de cada chave, como configurado abaixo.</p>
            </button>
            <button
              type="button"
              onClick={() => setClassConfig((c) => ({ ...c, source: "geral" }))}
              className={`bt-option-card text-left ${classConfig.source === "geral" ? "bt-option-card-active" : "bt-option-card-inactive"}`}
            >
              <p className="font-bold text-sm bt-text-ocean-deep">Ranking geral</p>
              <p className="text-xs text-stone-500 mt-0.5">Os N melhores entre todos os inscritos, sem separar por chave.</p>
            </button>
            <button
              type="button"
              onClick={() => setClassConfig((c) => ({ ...c, source: "top2_terceiro" }))}
              className={`bt-option-card text-left ${classConfig.source === "top2_terceiro" ? "bt-option-card-active" : "bt-option-card-inactive"}`}
            >
              <p className="font-bold text-sm bt-text-ocean-deep">2 melhores + 3º da chave</p>
              <p className="text-xs text-stone-500 mt-0.5">Os 2 melhores do geral classificam direto, e o 3º da(s) chave(s) de onde eles saíram também avança.</p>
            </button>
          </div>
        </div>

        {classConfig.source === "geral" ? (
          <div className="max-w-xs">
            <label className="text-sm font-semibold bt-text-ocean-deep block mb-1.5">Quantos classificam no total</label>
            <input
              type="number" min={0}
              className="bt-input w-full"
              value={classConfig.geralCount ?? 0}
              onChange={(e) => setClassConfig((c) => ({ ...c, geralCount: Math.max(0, Number(e.target.value)) }))}
            />
            <p className="text-xs text-stone-400 mt-1">Ex: 8 = os 8 melhores do ranking geral avançam, não importa a chave.</p>
          </div>
        ) : classConfig.source === "top2_terceiro" ? (
          <div className="bt-bg-sand rounded-xl p-3 text-sm text-stone-600">
            Sem campos pra configurar aqui — a regra já é fixa: os <b>2 melhores do ranking geral</b> classificam direto, e o <b>3º colocado</b> da chave (ou chaves) de onde eles vieram também avança. Se os dois melhores saírem da mesma chave, só o 3º dessa chave entra (não existem dois "3º lugares" na mesma chave).
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-semibold bt-text-ocean-deep block mb-1.5">Classificados direto por chave</label>
                <input
                  type="number" min={0}
                  className="bt-input w-full"
                  value={classConfig.topPerGroup}
                  onChange={(e) => setClassConfig((c) => ({ ...c, topPerGroup: Math.max(0, Number(e.target.value)) }))}
                />
                <p className="text-xs text-stone-400 mt-1">
                  Ex: 2 = os 2 melhores {hasFixed ? "(duplas)" : ""} de cada chave avançam.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-semibold bt-text-ocean-deep block mb-1.5">Posição extra</label>
                  <input
                    type="number" min={1}
                    className="bt-input w-full"
                    value={classConfig.extraPosition}
                    onChange={(e) => setClassConfig((c) => ({ ...c, extraPosition: Math.max(1, Number(e.target.value)) }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold bt-text-ocean-deep block mb-1.5">Quantos melhores</label>
                  <input
                    type="number" min={0}
                    className="bt-input w-full"
                    value={classConfig.extraCount}
                    onChange={(e) => setClassConfig((c) => ({ ...c, extraCount: Math.max(0, Number(e.target.value)) }))}
                  />
                </div>
              </div>
            </div>
            <p className="text-xs text-stone-400 mt-2">
              Ex: posição extra = 3 e quantos melhores = 2 → avançam também os 2 melhores "terceiros colocados" entre todas as chaves.
            </p>
          </>
        )}

        {M >= 2 && (
          <div className="mt-4 bt-bg-sand rounded-xl p-3 text-sm flex items-center gap-2">
            <Swords size={16} className="bt-text-ocean-deep shrink-0" />
            <span>
              <span className="font-bold">{M}</span> classificado(s) → o mata-mata começa {byesCount > 0 ? "com byes " : ""}
              nas <span className="font-bold bt-text-coral">{stageName}</span>
              {byesCount > 0 && ` (${byesCount} avançam direto na 1ª rodada)`}.
            </span>
          </div>
        )}
      </Section>

      <Section icon={Medal} title="Classificados para a próxima fase">
        {direct.length === 0 && extras.length === 0 ? (
          <EmptyState icon={Medal} text="Lance os resultados dos jogos para calcular os classificados." />
        ) : (
          <div className="flex flex-col gap-2">
            {direct.map((p) => (
              <div key={p.id + p.groupName} className="bt-qualified flex items-center justify-between bt-bg-sand rounded-lg pl-4 pr-3 py-2">
                <div>
                  <span className="font-semibold text-sm bt-text-ink">{p.name}</span>
                  <span className="text-xs text-stone-500 ml-2">{p.groupName} · {p.position}º lugar</span>
                </div>
                <span className="text-sm font-score bt-text-ocean-deep">{p.gamesWon}G</span>
              </div>
            ))}
            {extras.map((p) => (
              <div key={p.id + "extra"} className="bt-qualified flex items-center justify-between rounded-lg pl-4 pr-3 py-2" style={{ background: "rgba(209,69,26,0.1)" }}>
                <div>
                  <span className="font-semibold text-sm bt-text-ink">{p.name}</span>
                  <span className="text-xs text-stone-500 ml-2">{p.groupName} · melhor {p.position}º</span>
                </div>
                <span className="text-sm font-score bt-text-coral">{p.gamesWon}G</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section icon={ListOrdered} title="Classificação geral" subtitle="Todos os inscritos, numa lista só, independente da chave.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-stone-500 text-left">
                <th className="pb-1 font-semibold">#</th>
                <th className="pb-1 font-semibold">{hasFixed ? "Dupla" : "Jogador"}</th>
                <th className="pb-1 font-semibold">Chave</th>
                <th className="pb-1 font-semibold text-right">GV</th>
                <th className="pb-1 font-semibold text-right">GP</th>
                <th className="pb-1 font-semibold text-right">Saldo</th>
                <th className="pb-1 font-semibold text-right">Vitórias</th>
              </tr>
            </thead>
            <tbody>
              {overallRanking.map((p, i) => (
                <tr key={p.id} className={i < (classConfig.source === "geral" ? (classConfig.geralCount || 0) : direct.length + extras.length) ? "font-bold" : ""}>
                  <td className="py-1 bt-text-ocean-deep">{i + 1}</td>
                  <td className="py-1 truncate max-w-[160px]">{p.name}</td>
                  <td className="py-1 text-stone-500 text-xs">{p.groupName}</td>
                  <td className="py-1 text-right font-score">{p.gamesWon}</td>
                  <td className="py-1 text-right font-score text-stone-500">{p.gamesLost}</td>
                  <td className="py-1 text-right font-score bt-text-coral">
                    {p.gamesWon - p.gamesLost > 0 ? "+" : ""}{p.gamesWon - p.gamesLost}
                  </td>
                  <td className="py-1 text-right font-score">{p.wins}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section icon={ListOrdered} title="Classificação por chave">
        <div className="grid md:grid-cols-2 gap-4">
          {groupRankings.map(({ group, ranked }) => (
            <div key={group.id} className="bt-bg-sand rounded-xl p-4">
              <p className="font-display font-bold bt-text-ocean-deep mb-2">{group.name}</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-stone-500 text-left">
                    <th className="pb-1 font-semibold">#</th>
                    <th className="pb-1 font-semibold">{group.mode === "fixed" ? "Dupla" : "Jogador"}</th>
                    <th className="pb-1 font-semibold text-right">GV</th>
                    <th className="pb-1 font-semibold text-right">GP</th>
                    <th className="pb-1 font-semibold text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((p, i) => (
                    <tr key={p.id} className={i < classConfig.topPerGroup ? "font-bold" : ""}>
                      <td className="py-1 bt-text-ocean-deep">{i + 1}</td>
                      <td className="py-1 truncate max-w-[140px]">{p.name}</td>
                      <td className="py-1 text-right font-score">{p.gamesWon}</td>
                      <td className="py-1 text-right font-score text-stone-500">{p.gamesLost}</td>
                      <td className="py-1 text-right font-score bt-text-coral">
                        {p.gamesWon - p.gamesLost > 0 ? "+" : ""}{p.gamesWon - p.gamesLost}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------------
   TAB: MATA-MATA
----------------------------------------------------------------*/
function PlayoffMatchRow({ match, editable, onChange }) {
  const nameFor = (side) => (side ? side.name : "BYE");
  const w1 = match.played && match.winnerId === match.side1?.id;
  const w2 = match.played && match.winnerId === match.side2?.id;

  const update = (field, val) => onChange({ ...match, [field]: val });

  return (
    <div className="flex items-center gap-3 py-2.5 px-1 bt-dotline first:border-t-0">
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${w1 ? "font-bold bt-text-ocean-deep" : "text-stone-600"}`}>{nameFor(match.side1)}</p>
      </div>
      {editable && !match.isBye ? (
        <>
          <input type="number" min={0} className="bt-input w-14 text-center font-score text-sm" value={match.games1} onChange={(e) => update("games1", e.target.value)} />
          <span className="text-stone-400 font-bold">×</span>
          <input type="number" min={0} className="bt-input w-14 text-center font-score text-sm" value={match.games2} onChange={(e) => update("games2", e.target.value)} />
        </>
      ) : (
        <span className="font-score text-sm bt-text-ocean-deep px-2">
          {match.isBye ? "BYE" : match.played ? `${match.games1} × ${match.games2}` : "vs"}
        </span>
      )}
      <div className="flex-1 min-w-0 text-right">
        <p className={`text-sm truncate ${w2 ? "font-bold bt-text-ocean-deep" : "text-stone-600"}`}>{nameFor(match.side2)}</p>
      </div>
      {match.played && !match.isBye && <Check size={16} className="bt-text-turquoise shrink-0" />}
    </div>
  );
}

function PlayoffTab({
  athletes, groups, classConfig, config, playoff, setPlayoff,
  playoffPairMode, setPlayoffPairMode, playoffManualPairs, setPlayoffManualPairs, playoffDrawOrder, setPlayoffDrawOrder,
  playoffBracketMode, setPlayoffBracketMode, playoffManualMatchups, setPlayoffManualMatchups,
}) {
  const { combinedSeeded } = useMemo(() => computeQualifiers(athletes, groups, classConfig), [athletes, groups, classConfig]);
  const singleGroupPoints = groups.length === 1 && groups[0]?.pointsCorridos;
  const isRotation = config.mode !== "fixed";
  const rotationPairing = useMemo(
    () => ({ pairMode: playoffPairMode, manualPairs: playoffManualPairs, drawOrder: playoffDrawOrder }),
    [playoffPairMode, playoffManualPairs, playoffDrawOrder]
  );
  const { entries, odd, unpaired } = useMemo(
    () => formPlayoffEntries(combinedSeeded, config.mode, rotationPairing),
    [combinedSeeded, config.mode, rotationPairing]
  );

  const needed = Math.floor(combinedSeeded.length / 2);
  const manualIncomplete = isRotation && playoffPairMode === "manual" && unpaired.length > combinedSeeded.length % 2;

  const matchupsNeeded = Math.floor(entries.length / 2);
  const matchupPool = useMemo(() => entries.map((e) => ({ id: e.id, name: e.name })), [entries]);
  const pairedMatchupIds = useMemo(() => new Set(playoffManualMatchups.flatMap((m) => m.playerIds)), [playoffManualMatchups]);
  const unmatchedEntries = matchupPool.filter((e) => !pairedMatchupIds.has(e.id));
  const matchupsIncomplete = playoffBracketMode === "manual" && unmatchedEntries.length > entries.length % 2;

  const drawPairs = () => {
    setPlayoffDrawOrder(shuffle(combinedSeeded.map((p) => p.id)));
  };

  const generate = () => {
    const bracket = playoffBracketMode === "manual"
      ? buildPlayoffBracketManual(entries, playoffManualMatchups)
      : buildPlayoffBracket(entries);
    setPlayoff(bracket ? { ...bracket, odd } : null);
  };

  const updateMatch = (roundIdx, updatedMatch) => {
    setPlayoff((prev) => {
      if (!prev) return prev;
      let rounds = prev.rounds.map((r, ri) => {
        if (ri !== roundIdx) return r;
        return {
          ...r,
          matches: r.matches.map((m) => {
            if (m.id !== updatedMatch.id) return m;
            const g1 = Number(updatedMatch.games1), g2 = Number(updatedMatch.games2);
            const valid = updatedMatch.games1 !== "" && updatedMatch.games2 !== "" && !isNaN(g1) && !isNaN(g2) && g1 !== g2;
            return {
              ...updatedMatch,
              played: valid,
              winnerId: valid ? (g1 > g2 ? updatedMatch.side1.id : updatedMatch.side2.id) : null,
            };
          }),
        };
      });

      const lastIdx = rounds.length - 1;
      if (roundIdx === lastIdx) {
        const last = rounds[lastIdx];
        const allDone = last.matches.every((m) => m.played && m.winnerId);
        if (allDone && last.matches.length > 1) {
          const winners = last.matches.map((m) => (m.winnerId === m.side1?.id ? m.side1 : m.side2));
          const nextMatches = [];
          for (let i = 0; i < winners.length; i += 2) {
            nextMatches.push({
              id: uid(), side1: winners[i], side2: winners[i + 1],
              games1: "", games2: "", played: false, winnerId: null, isBye: false,
            });
          }
          rounds = [...rounds, { name: roundNameFor(winners.length), matches: nextMatches }];
        }
      }
      return { ...prev, rounds };
    });
  };

  if (singleGroupPoints) {
    return (
      <Section icon={Swords} title="Mata-mata">
        <EmptyState icon={Trophy} text='Este campeonato foi configurado como "pontos corridos" com chave única — o campeão já é definido diretamente na aba Classificação.' />
      </Section>
    );
  }

  if (groups.length === 0) {
    return (
      <Section icon={Swords} title="Mata-mata">
        <EmptyState icon={Waves} text="Sorteie as chaves e finalize a fase de grupos antes de gerar o mata-mata." />
      </Section>
    );
  }

  const champion =
    playoff && playoff.rounds[playoff.rounds.length - 1].matches.length === 1 && playoff.rounds[playoff.rounds.length - 1].matches[0].played
      ? playoff.rounds[playoff.rounds.length - 1].matches[0]
      : null;
  const championSide = champion ? (champion.winnerId === champion.side1?.id ? champion.side1 : champion.side2) : null;

  return (
    <div>
      {isRotation && combinedSeeded.length >= 2 && (
        <Section icon={Shuffle} title="Como formar as duplas do mata-mata?" subtitle="Os classificados jogaram individualmente na fase de grupos — agora escolha como parear em duplas para a fase eliminatória.">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
            <button
              type="button"
              onClick={() => setPlayoffPairMode("seed")}
              className={`bt-option-card text-left ${playoffPairMode === "seed" ? "bt-option-card-active" : "bt-option-card-inactive"}`}
            >
              <p className="font-bold text-sm bt-text-ocean-deep">Por classificação</p>
              <p className="text-xs text-stone-500 mt-0.5">Pareia os melhores colocados entre si, seguindo o ranking geral.</p>
            </button>
            <button
              type="button"
              onClick={() => setPlayoffPairMode("draw")}
              className={`bt-option-card text-left ${playoffPairMode === "draw" ? "bt-option-card-active" : "bt-option-card-inactive"}`}
            >
              <p className="font-bold text-sm bt-text-ocean-deep">Sorteio</p>
              <p className="text-xs text-stone-500 mt-0.5">Duplas formadas aleatoriamente entre os classificados.</p>
            </button>
            <button
              type="button"
              onClick={() => setPlayoffPairMode("manual")}
              className={`bt-option-card text-left ${playoffPairMode === "manual" ? "bt-option-card-active" : "bt-option-card-inactive"}`}
            >
              <p className="font-bold text-sm bt-text-ocean-deep">Definir manualmente</p>
              <p className="text-xs text-stone-500 mt-0.5">Você escolhe cada dupla entre os classificados.</p>
            </button>
          </div>

          {playoffPairMode === "draw" && (
            <div className="bt-bg-sand rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-stone-500">
                  {playoffDrawOrder ? "Duplas sorteadas — confira abaixo." : "Ainda não sorteado. Clique para sortear as duplas."}
                </p>
                <button className="bt-btn bt-btn-outline shrink-0" onClick={drawPairs}>
                  <Shuffle size={16} /> {playoffDrawOrder ? "Sortear novamente" : "Sortear duplas"}
                </button>
              </div>
              {entries.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {entries.map((e, i) => (
                    <div key={e.id} className="flex items-center bt-bg-white rounded-lg px-3 py-1.5">
                      <span className="text-sm">
                        <span className="bt-text-coral font-bold mr-1.5">{i + 1}.</span>
                        {e.name}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {playoffPairMode === "manual" && (
            <ManualPairBuilder athletes={combinedSeeded} manualPairs={playoffManualPairs} setManualPairs={setPlayoffManualPairs} needed={needed} />
          )}

          {odd && playoffPairMode !== "manual" && (
            <p className="text-xs bt-text-coral mt-3">
              Número ímpar de classificados: <b>{odd.name}</b> ficou de fora por não ser possível formar uma dupla completa.
            </p>
          )}
        </Section>
      )}

      {entries.length >= 2 && (
        <Section icon={Swords} title="Confrontos do mata-mata" subtitle="Escolha se o chaveamento monta os confrontos automaticamente pela classificação, ou se você define manualmente quem enfrenta quem na 1ª rodada.">
          <div className="grid grid-cols-2 gap-2 mb-3 max-w-md">
            <button
              type="button"
              onClick={() => setPlayoffBracketMode("seed")}
              className={`bt-option-card text-left ${playoffBracketMode === "seed" ? "bt-option-card-active" : "bt-option-card-inactive"}`}
            >
              <p className="font-bold text-sm bt-text-ocean-deep">Automático</p>
              <p className="text-xs text-stone-500 mt-0.5">Chaveamento por classificação (1º x último, etc.).</p>
            </button>
            <button
              type="button"
              onClick={() => setPlayoffBracketMode("manual")}
              className={`bt-option-card text-left ${playoffBracketMode === "manual" ? "bt-option-card-active" : "bt-option-card-inactive"}`}
            >
              <p className="font-bold text-sm bt-text-ocean-deep">Manual</p>
              <p className="text-xs text-stone-500 mt-0.5">Você escolhe cada confronto da 1ª rodada.</p>
            </button>
          </div>

          {playoffBracketMode === "manual" && (
            <ManualPairBuilder athletes={matchupPool} manualPairs={playoffManualMatchups} setManualPairs={setPlayoffManualMatchups} needed={matchupsNeeded} />
          )}
        </Section>
      )}

      <Section
        icon={Swords}
        title="Fase eliminatória"
        subtitle="Gerada a partir dos classificados definidos na aba Classificação."
        right={
          <button className="bt-btn bt-btn-coral" onClick={generate} disabled={entries.length < 2 || manualIncomplete || matchupsIncomplete}>
            <Shuffle size={16} /> {playoff ? "Gerar novamente" : "Gerar chaveamento"}
          </button>
        }
      >
        <p className="text-sm text-stone-500">
          {entries.length >= 2
            ? `${entries.length} entrada(s) prontas para o chaveamento (${roundNameFor(nextPow2(entries.length))} na 1ª rodada).`
            : "É preciso pelo menos 2 classificados para montar o mata-mata."}
        </p>
        {manualIncomplete && (
          <p className="text-xs bt-text-coral mt-2">
            Ainda faltam {unpaired.length} classificado(s) sem dupla: {unpaired.map((p) => p.name).join(", ")}.
          </p>
        )}
        {matchupsIncomplete && (
          <p className="text-xs bt-text-coral mt-2">
            Ainda faltam {unmatchedEntries.length} entrada(s) sem confronto definido: {unmatchedEntries.map((p) => p.name).join(", ")}.
          </p>
        )}
        {odd && !manualIncomplete && (
          <p className="text-xs bt-text-coral mt-2">
            Número ímpar de classificados: <b>{odd.name}</b> ficou de fora por não ser possível formar uma dupla completa.
          </p>
        )}
      </Section>

      {championSide && (
        <div className="bt-card p-6 mb-5 flex items-center gap-3" style={{ background: "linear-gradient(135deg, rgba(209,69,26,0.12), rgba(232,149,46,0.12))" }}>
          <Crown size={30} className="bt-text-coral shrink-0" />
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-stone-500">Campeão do torneio</p>
            <p className="font-display text-xl font-bold bt-text-ocean-deep">{championSide.name}</p>
          </div>
        </div>
      )}

      {playoff ? (
        <div className="flex flex-col gap-4">
          {playoff.rounds.map((round, ri) => (
            <div key={ri} className="bt-card p-4">
              <p className="font-display font-bold bt-text-ocean-deep mb-1">{round.name}</p>
              <div>
                {round.matches.map((m) => (
                  <PlayoffMatchRow key={m.id} match={m} editable={ri === playoff.rounds.length - 1} onChange={(next) => updateMatch(ri, next)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={Swords} text='Clique em "Gerar chaveamento" para iniciar a fase eliminatória.' />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   APP
----------------------------------------------------------------*/
function TournamentWorkspace({ tournamentId, tournamentName, onExit, isOrganizer }) {
  const [athletes, setAthletes] = useState([]);
  const [groups, setGroups] = useState([]);
  const [manualPairs, setManualPairs] = useState([]);
  const [config, setConfig] = useState({
    mode: "fixed",
    numGroups: 2,
    duplasPerGroup: 3,
    playersPerGroup: 8,
    pointsCorridosSingleGroup: false,
    pairMode: "auto",
    seedCategoryA: true,
  });
  const [classConfig, setClassConfig] = useState({
    topPerGroup: 2, extraPosition: 3, extraCount: 2,
    sortBy: "gamesWon", source: "chave", geralCount: 8,
  });
  const [playoff, setPlayoff] = useState(null);
  const [playoffPairMode, setPlayoffPairMode] = useState("seed"); // "seed" | "draw" | "manual"
  const [playoffManualPairs, setPlayoffManualPairs] = useState([]);
  const [playoffDrawOrder, setPlayoffDrawOrder] = useState(null);
  const [playoffBracketMode, setPlayoffBracketMode] = useState("seed"); // "seed" | "manual"
  const [playoffManualMatchups, setPlayoffManualMatchups] = useState([]);
  const [activeTab, setActiveTab] = useState("atletas");
  const [loaded, setLoaded] = useState(false);
  const [saveErr, setSaveErr] = useState(false);
  const [status, setStatus] = useState("em_andamento");
  const [statusSaving, setStatusSaving] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const row = await loadTournament(tournamentId);
        const parsed = row?.data || {};
        if (row?.status) setStatus(row.status);
        if (parsed.athletes) setAthletes(parsed.athletes);
        if (parsed.groups) setGroups(parsed.groups);
        if (parsed.manualPairs) setManualPairs(parsed.manualPairs);
        if (parsed.config) setConfig((prev) => ({ ...prev, ...parsed.config }));
        if (parsed.classConfig) setClassConfig((prev) => ({ ...prev, ...parsed.classConfig }));
        if (parsed.playoff) setPlayoff(parsed.playoff);
        if (parsed.playoffPairMode) setPlayoffPairMode(parsed.playoffPairMode);
        if (parsed.playoffManualPairs) setPlayoffManualPairs(parsed.playoffManualPairs);
        if (parsed.playoffDrawOrder) setPlayoffDrawOrder(parsed.playoffDrawOrder);
        if (parsed.playoffBracketMode) setPlayoffBracketMode(parsed.playoffBracketMode);
        if (parsed.playoffManualMatchups) setPlayoffManualMatchups(parsed.playoffManualMatchups);
      } catch (e) {
        setSaveErr(true);
      } finally {
        setLoaded(true);
      }
    })();
  }, [tournamentId]);

  const toggleStatus = async () => {
    const next = status === "finalizado" ? "em_andamento" : "finalizado";
    setStatusSaving(true);
    try {
      await setTournamentStatus(tournamentId, next);
      setStatus(next);
    } catch (e) {
      setSaveErr(true);
    } finally {
      setStatusSaving(false);
    }
  };


  useEffect(() => {
    if (!loaded) return;
    // debounce: espera 700ms sem novas mudanças antes de salvar no Supabase
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      (async () => {
        try {
          await saveTournamentData(tournamentId, {
            athletes, groups, manualPairs, config, classConfig, playoff,
            playoffPairMode, playoffManualPairs, playoffDrawOrder,
            playoffBracketMode, playoffManualMatchups,
          });
          setSaveErr(false);
        } catch (e) {
          setSaveErr(true);
        }
      })();
    }, 700);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [tournamentId, athletes, groups, manualPairs, config, classConfig, playoff, playoffPairMode, playoffManualPairs, playoffDrawOrder, playoffBracketMode, playoffManualMatchups, loaded]);

  const handleDraw = () => {
    const { mode, numGroups, duplasPerGroup, playersPerGroup, pointsCorridosSingleGroup, pairMode, seedCategoryA } = config;
    const athletesMap = Object.fromEntries(athletes.map((a) => [a.id, a]));

    let duplasPool = null;
    let playerPool = null;

    if (mode === "fixed") {
      if (pairMode === "manual") {
        const minDuplas = duplasPerGroup * numGroups;
        if (manualPairs.length < minDuplas) return;
        duplasPool = shuffle(manualPairs);
      } else {
        const minPlayers = duplasPerGroup * 2 * numGroups;
        if (athletes.length < minPlayers) return;
        // duplas precisam de número par de atletas — se for ímpar, 1 fica de fora (inevitável)
        const evenCount = athletes.length - (athletes.length % 2);
        const pool = shuffle(athletes.map((a) => a.id)).slice(0, evenCount);
        const rawPairs = seedCategoryA ? formDuplasAvoidingDoubleA(pool, athletesMap) : chunkPairs(pool);
        duplasPool = rawPairs.map(([a, b]) => ({ id: uid(), playerIds: [a, b] }));
      }
    } else {
      const minPlayers = playersPerGroup * numGroups;
      if (athletes.length < minPlayers) return;
      playerPool = shuffle(athletes.map((a) => a.id));
    }

    const groupedEntities =
      mode === "fixed"
        ? distributeWithSeeding(
            duplasPool, numGroups,
            seedCategoryA ? (d) => d.playerIds.some((id) => athletesMap[id]?.category === "A") : () => false
          )
        : distributeWithSeeding(
            playerPool, numGroups,
            seedCategoryA ? (id) => athletesMap[id]?.category === "A" : () => false
          );

    const newGroups = groupedEntities.map((entityList, i) => {
      let pairs = [], matches = [], roundsMeta = [], memberIds;
      if (mode === "fixed") {
        pairs = entityList;
        memberIds = pairs.flatMap((p) => p.playerIds);
        const rounds = circleRoundRobin(pairs.map((p) => p.id));
        rounds.forEach((roundPairs, rIdx) => {
          roundPairs.forEach(([pairIdA, pairIdB]) => {
            const teamA = pairs.find((p) => p.id === pairIdA);
            const teamB = pairs.find((p) => p.id === pairIdB);
            matches.push({
              id: uid(), round: rIdx + 1,
              side1Ids: teamA.playerIds, side2Ids: teamB.playerIds,
              sets: [{ games1: "", games2: "" }],
              games1: "", games2: "", played: false,
            });
          });
        });
      } else {
        memberIds = entityList;
        const schedule = generateRotationSchedule(memberIds);
        schedule.forEach((roundObj, rIdx) => {
          roundsMeta.push({ round: rIdx + 1, byes: roundObj.byes });
          roundObj.matches.forEach((m) => {
            matches.push({
              id: uid(), round: rIdx + 1,
              side1Ids: m.side1, side2Ids: m.side2,
              games1: "", games2: "", played: false,
            });
          });
        });
      }
      return {
        id: uid(),
        name: `Chave ${String.fromCharCode(65 + i)}`,
        mode,
        pointsCorridos: numGroups === 1 && !!pointsCorridosSingleGroup,
        memberAthleteIds: memberIds,
        pairs, matches, roundsMeta,
      };
    });

    setGroups(newGroups);
    setPlayoff(null);
    setActiveTab("chaves");
  };

  const handleReset = () => {
    setGroups([]);
    setPlayoff(null);
  };

  if (!loaded) {
    return (
      <div className="bt-root min-h-screen flex items-center justify-center">
        <Theme />
        <div className="flex flex-col items-center gap-3 text-stone-400">
          <Loader2 size={28} className="animate-spin" />
          <p className="text-sm">Carregando campeonato…</p>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: "atletas", label: "Atletas", icon: Users },
    { id: "sorteio", label: "Sorteio", icon: Shuffle },
    { id: "chaves", label: "Chaves", icon: ClipboardList },
    { id: "classificacao", label: "Classificação", icon: Trophy },
    { id: "matamata", label: "Mata-mata", icon: Swords },
  ];

  return (
    <div className="bt-root">
      <Theme />
      <div className="bt-bg-ocean-deep px-5 md:px-8 pt-6 pb-8">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <button
              onClick={onExit}
              className="flex items-center gap-1 text-xs font-semibold hover:opacity-80"
              style={{ color: "rgba(255,255,255,0.75)" }}
            >
              <ArrowLeft size={14} /> Meus campeonatos
            </button>
            {isOrganizer && (
              <button
                className="bt-btn bt-btn-outline text-xs py-1.5"
                style={{ background: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.4)", color: "white" }}
                onClick={toggleStatus}
                disabled={statusSaving}
              >
                {statusSaving ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : status === "finalizado" ? (
                  <RotateCcw size={14} />
                ) : (
                  <Check size={14} />
                )}
                {status === "finalizado" ? "Reabrir campeonato" : "Finalizar campeonato"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-white rounded-2xl p-1.5 flex items-center justify-center shrink-0">
              <img src="/logo.jpg" alt="Play dos Amigos" className="w-10 h-10 md:w-11 md:h-11 object-contain rounded-xl" />
            </div>
            <div>
              <h1 className="font-display text-2xl md:text-3xl font-bold bt-text-white flex items-center gap-2">
                {tournamentName || "Play dos Amigos"}
                {status === "finalizado" && <span className="bt-chip bt-chip-turquoise">Finalizado</span>}
              </h1>
              <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.7)" }}>
                Cadastro, sorteio de chaves, classificação e mata-mata do seu torneio
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="bt-wave-divider" />

      <div className="max-w-5xl mx-auto px-4 md:px-8 -mt-1 pb-16">
        <div className="flex gap-2 overflow-x-auto bt-scroll py-4 mb-1">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} className={`bt-tab ${activeTab === t.id ? "bt-tab-active" : "bt-tab-inactive"}`}>
              <t.icon size={16} /> {t.label}
              {t.id === "chaves" && groups.length > 0 && (
                <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5" style={{ background: activeTab === t.id ? "rgba(255,255,255,0.25)" : "var(--sand-deep)" }}>
                  {groups.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {!isOrganizer && (
          <div className="bt-chip bt-chip-turquoise mb-3">
            Modo visitante — você pode ver tudo, mas só o organizador logado pode editar.
          </div>
        )}

        <fieldset disabled={!isOrganizer} className="contents">
          {activeTab === "atletas" && <AthletesTab athletes={athletes} setAthletes={setAthletes} groupsExist={groups.length > 0} />}
          {activeTab === "sorteio" && (
            <DrawTab
              athletes={athletes} config={config} setConfig={setConfig} onDraw={handleDraw}
              groups={groups} onReset={handleReset} manualPairs={manualPairs} setManualPairs={setManualPairs}
            />
          )}
          {activeTab === "chaves" && <GroupsTab groups={groups} athletes={athletes} setGroups={setGroups} />}
          {activeTab === "classificacao" && (
            <StandingsTab athletes={athletes} groups={groups} classConfig={classConfig} setClassConfig={setClassConfig} />
          )}
          {activeTab === "matamata" && (
            <PlayoffTab
              athletes={athletes}
              groups={groups}
              classConfig={classConfig}
              config={config}
              playoff={playoff}
              setPlayoff={setPlayoff}
              playoffPairMode={playoffPairMode}
              setPlayoffPairMode={setPlayoffPairMode}
              playoffManualPairs={playoffManualPairs}
              setPlayoffManualPairs={setPlayoffManualPairs}
              playoffDrawOrder={playoffDrawOrder}
              setPlayoffDrawOrder={setPlayoffDrawOrder}
              playoffBracketMode={playoffBracketMode}
              setPlayoffBracketMode={setPlayoffBracketMode}
              playoffManualMatchups={playoffManualMatchups}
              setPlayoffManualMatchups={setPlayoffManualMatchups}
            />
          )}
        </fieldset>

        {saveErr && (
          <p className="text-xs text-center text-stone-400 mt-4">
            Não foi possível salvar no banco agora — verifique sua conexão. As alterações continuam aqui na tela, mas tente novamente em instantes.
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   TELA: LOGIN DO ORGANIZADOR
----------------------------------------------------------------*/
function LoginScreen({ onBack, onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!email.trim() || !password || loading) return;
    setLoading(true);
    setErr("");
    try {
      await signIn(email.trim(), password);
      onSuccess();
    } catch (e) {
      setErr("Email ou senha incorretos.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bt-root min-h-screen flex items-center justify-center px-4">
      <Theme />
      <div className="bt-card p-6 md:p-8 w-full max-w-sm">
        <button onClick={onBack} className="flex items-center gap-1 text-xs font-semibold mb-4 text-stone-400 hover:opacity-70">
          <ArrowLeft size={14} /> Voltar
        </button>
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-white border rounded-2xl p-1.5 flex items-center justify-center shrink-0" style={{ borderColor: "var(--sand-deep)" }}>
            <img src="/logo.jpg" alt="Play dos Amigos" className="w-9 h-9 object-contain rounded-xl" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold bt-text-ocean-deep">Entrar como organizador</h1>
            <p className="text-xs text-stone-500 mt-0.5">Só o organizador pode criar e editar campeonatos.</p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <input
            className="bt-input"
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <input
            className="bt-input"
            placeholder="Senha"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          {err && (
            <p className="text-xs bt-text-coral flex items-center gap-1">
              <AlertCircle size={13} /> {err}
            </p>
          )}
          <button className="bt-btn bt-btn-coral justify-center" onClick={submit} disabled={!email.trim() || !password || loading}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : null} Entrar
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   TELA: MEUS CAMPEONATOS
----------------------------------------------------------------*/
function TournamentsHome({ tournaments, loading, error, onCreate, onOpen, onDelete, creating, onShowRanking, isOrganizer, organizerEmail, onLoginClick, onLogout }) {
  const [newName, setNewName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const submitCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onCreate(name);
    setNewName("");
  };

  const formatDate = (iso) => {
    try {
      return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
    } catch (e) {
      return "";
    }
  };

  return (
    <div className="bt-root min-h-screen">
      <Theme />
      <div className="bt-bg-ocean-deep px-5 md:px-8 pt-6 pb-8">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="bg-white rounded-2xl p-1.5 flex items-center justify-center shrink-0">
              <img src="/logo.jpg" alt="Play dos Amigos" className="w-10 h-10 md:w-11 md:h-11 object-contain rounded-xl" />
            </div>
            <div>
              <h1 className="font-display text-2xl md:text-3xl font-bold bt-text-white">Play dos Amigos</h1>
              <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.7)" }}>Seus campeonatos</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="bt-btn bt-btn-outline" style={{ background: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.4)", color: "white" }} onClick={onShowRanking}>
              <Trophy size={16} /> Ranking geral
            </button>
            {isOrganizer ? (
              <button
                className="bt-btn bt-btn-outline"
                style={{ background: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.4)", color: "white" }}
                onClick={onLogout}
                title={organizerEmail}
              >
                Sair
              </button>
            ) : (
              <button
                className="bt-btn bt-btn-outline"
                style={{ background: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.4)", color: "white" }}
                onClick={onLoginClick}
              >
                Entrar
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="bt-wave-divider" />

      <div className="max-w-3xl mx-auto px-4 md:px-8 -mt-1 pb-16">
        {isOrganizer ? (
          <Section icon={Plus} title="Novo campeonato" subtitle="Dê um nome ao torneio para começar (ex: data + local).">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                className="bt-input flex-1"
                placeholder="Ex: Play dos Amigos — 10/08"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitCreate()}
              />
              <button className="bt-btn bt-btn-coral shrink-0" onClick={submitCreate} disabled={!newName.trim() || creating}>
                {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Criar campeonato
              </button>
            </div>
          </Section>
        ) : (
          <div className="bt-chip bt-chip-turquoise mb-5">
            Modo visitante — você pode ver ranking, chaves e resultados. Para criar ou editar campeonatos, entre como organizador.
          </div>
        )}

        <Section icon={Trophy} title="Campeonatos salvos" subtitle="Todos os torneios ficam salvos aqui — abra qualquer um para continuar de onde parou.">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-stone-400 gap-2">
              <Loader2 size={20} className="animate-spin" /> Carregando campeonatos…
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 py-6 text-sm bt-text-coral">
              <AlertCircle size={18} /> Não foi possível carregar os campeonatos. Confira sua conexão e tente recarregar a página.
            </div>
          ) : tournaments.length === 0 ? (
            <EmptyState icon={Trophy} text="Nenhum campeonato criado ainda. Crie o primeiro acima." />
          ) : (
            <div className="flex flex-col gap-2">
              {tournaments.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 bt-bg-sand rounded-xl px-4 py-3">
                  <button className="flex-1 min-w-0 text-left" onClick={() => onOpen(t.id)}>
                    <p className="font-bold text-sm bt-text-ocean-deep truncate">{t.name}</p>
                    <p className="text-xs text-stone-500 flex items-center gap-1 mt-0.5">
                      <Calendar size={12} /> Atualizado em {formatDate(t.updated_at)}
                      {t.status === "finalizado" && (
                        <span className="bt-chip bt-chip-turquoise ml-2">Finalizado</span>
                      )}
                    </p>
                  </button>
                  {isOrganizer && (confirmDeleteId === t.id ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button className="text-xs font-semibold bt-text-coral" onClick={() => onDelete(t.id)}>Confirmar exclusão</button>
                      <button className="text-xs text-stone-400" onClick={() => setConfirmDeleteId(null)}>Cancelar</button>
                    </div>
                  ) : (
                    <button className="bt-text-coral hover:opacity-70 p-1 shrink-0" title="Excluir campeonato" onClick={() => setConfirmDeleteId(t.id)}>
                      <Trash2 size={16} />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   TELA: RANKING GERAL
----------------------------------------------------------------*/
function RankingScreen({ onBack }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rows, setRows] = useState([]);
  const [sortBy, setSortBy] = useState("saldo"); // "saldo" | "gamesWon" | "wins"

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const tournamentsFull = await fetchAllTournamentsFull();
        setRows(computeGlobalRanking(tournamentsFull));
        setError(false);
      } catch (e) {
        setError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sortBy === "gamesWon") return b.gamesWon - a.gamesWon || b.saldo - a.saldo;
      if (sortBy === "wins") return b.wins - a.wins || b.saldo - a.saldo;
      return b.saldo - a.saldo || b.gamesWon - a.gamesWon;
    });
    return copy;
  }, [rows, sortBy]);

  return (
    <div className="bt-root min-h-screen">
      <Theme />
      <div className="bt-bg-ocean-deep px-5 md:px-8 pt-6 pb-8">
        <div className="max-w-4xl mx-auto">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-xs font-semibold mb-3 hover:opacity-80"
            style={{ color: "rgba(255,255,255,0.75)" }}
          >
            <ArrowLeft size={14} /> Meus campeonatos
          </button>
          <div className="flex items-center gap-3">
            <div className="bg-white rounded-2xl p-1.5 flex items-center justify-center shrink-0">
              <img src="/logo.jpg" alt="Play dos Amigos" className="w-10 h-10 md:w-11 md:h-11 object-contain rounded-xl" />
            </div>
            <div>
              <h1 className="font-display text-2xl md:text-3xl font-bold bt-text-white">Ranking geral</h1>
              <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.7)" }}>Somando os resultados de todos os campeonatos.</p>
            </div>
          </div>
        </div>
      </div>
      <div className="bt-wave-divider" />

      <div className="max-w-4xl mx-auto px-4 md:px-8 -mt-1 pb-16">
        <Section
          icon={Trophy}
          title="Classificação geral"
          subtitle="Soma os games e jogos de cada atleta em todos os campeonatos (identificado por celular/Instagram no cadastro)."
        >
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <label className="text-sm font-semibold bt-text-ocean-deep">Ordenar por:</label>
            <select className="bt-input" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="saldo">Saldo de games</option>
              <option value="gamesWon">Games ganhos</option>
              <option value="wins">Jogos ganhos</option>
            </select>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8 text-stone-400 gap-2">
              <Loader2 size={20} className="animate-spin" /> Calculando ranking…
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 py-6 text-sm bt-text-coral">
              <AlertCircle size={18} /> Não foi possível carregar o ranking agora. Tente recarregar a página.
            </div>
          ) : sorted.length === 0 ? (
            <EmptyState icon={Trophy} text="Ainda não há resultados suficientes para montar um ranking. Jogue partidas em algum campeonato para vê-lo aqui." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-stone-400 text-xs uppercase tracking-wide">
                    <th className="pb-2 font-semibold">#</th>
                    <th className="pb-2 font-semibold">Atleta</th>
                    <th className="pb-2 font-semibold text-center">Campeonatos</th>
                    <th className="pb-2 font-semibold text-center">Jogos</th>
                    <th className="pb-2 font-semibold text-center">Vitórias</th>
                    <th className="pb-2 font-semibold text-center">Games ganhos</th>
                    <th className="pb-2 font-semibold text-center">Games perdidos</th>
                    <th className="pb-2 font-semibold text-center">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => (
                    <tr key={r.id} className="bt-dotline">
                      <td className="py-2 font-bold bt-text-ocean-deep">{i + 1}</td>
                      <td className="py-2 font-medium">{r.name}</td>
                      <td className="py-2 text-center">{r.tournamentsPlayed}</td>
                      <td className="py-2 text-center">{r.matches}</td>
                      <td className="py-2 text-center font-bold bt-text-turquoise">{r.wins}</td>
                      <td className="py-2 text-center">{r.gamesWon}</td>
                      <td className="py-2 text-center">{r.gamesLost}</td>
                      <td className="py-2 text-center font-bold">{r.saldo > 0 ? `+${r.saldo}` : r.saldo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   APP RAIZ
----------------------------------------------------------------*/
export default function App() {
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [activeTournamentId, setActiveTournamentId] = useState(null);
  const [showRanking, setShowRanking] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    getSession().then((s) => {
      setSession(s);
      setAuthReady(true);
    });
    const unsubscribe = onAuthChange((s) => setSession(s));
    return unsubscribe;
  }, []);

  const isOrganizer = !!session;

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (e) {
      // sessão local já limpa pelo listener mesmo se a chamada falhar
    }
  };

  const refreshList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listTournaments();
      setTournaments(data);
      setError(false);
    } catch (e) {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  const handleCreate = async (name) => {
    setCreating(true);
    try {
      const t = await createTournament(name);
      setTournaments((prev) => [t, ...prev]);
      setActiveTournamentId(t.id);
    } catch (e) {
      setError(true);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteTournament(id);
      setTournaments((prev) => prev.filter((t) => t.id !== id));
    } catch (e) {
      // mantém a lista como está; usuário pode tentar de novo
    }
  };

  const handleExit = () => {
    setActiveTournamentId(null);
    refreshList();
  };

  if (!authReady) {
    return (
      <div className="bt-root min-h-screen flex items-center justify-center">
        <Theme />
        <Loader2 size={28} className="animate-spin text-stone-400" />
      </div>
    );
  }

  if (showLogin) {
    return <LoginScreen onBack={() => setShowLogin(false)} onSuccess={() => setShowLogin(false)} />;
  }

  if (activeTournamentId) {
    const active = tournaments.find((t) => t.id === activeTournamentId);
    return (
      <TournamentWorkspace
        tournamentId={activeTournamentId}
        tournamentName={active?.name}
        onExit={handleExit}
        isOrganizer={isOrganizer}
      />
    );
  }

  if (showRanking) {
    return <RankingScreen onBack={() => setShowRanking(false)} />;
  }

  return (
    <TournamentsHome
      tournaments={tournaments}
      loading={loading}
      error={error}
      creating={creating}
      onCreate={handleCreate}
      onOpen={setActiveTournamentId}
      onDelete={handleDelete}
      onShowRanking={() => setShowRanking(true)}
      isOrganizer={isOrganizer}
      organizerEmail={session?.user?.email}
      onLoginClick={() => setShowLogin(true)}
      onLogout={handleLogout}
    />
  );
}
