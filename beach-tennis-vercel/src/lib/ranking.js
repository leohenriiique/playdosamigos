import { supabase } from "./supabaseClient";

// Ranking separado por gênero: "masculino" | "feminino".
// Tabelas (ver supabase_schema_ranking.sql):
//  - ranking_settings(gender, reset_at): só campeonatos criados DEPOIS do reset_at contam.
//  - ranking_enrollments(athlete_id, gender): só atletas inscritos pontuam.
// Se as tabelas ainda não existem, as funções devolvem "sem reset / ninguém inscrito"
// e `missing: true`, para o app avisar em vez de quebrar.

export async function fetchRankingSetup(gender) {
  const [s, e] = await Promise.all([
    supabase.from("ranking_settings").select("reset_at").eq("gender", gender).maybeSingle(),
    supabase.from("ranking_enrollments").select("athlete_id").eq("gender", gender),
  ]);
  const missing = !!(s.error || e.error);
  return {
    missing,
    resetAt: s.data?.reset_at || null,
    enrolledIds: new Set((e.data || []).map((r) => r.athlete_id)),
  };
}

export async function enrollAthletes(gender, athleteIds) {
  if (!athleteIds.length) return;
  const rows = athleteIds.map((athlete_id) => ({ athlete_id, gender }));
  const { error } = await supabase.from("ranking_enrollments").upsert(rows, { onConflict: "athlete_id,gender" });
  if (error) throw error;
}

export async function unenrollAthletes(gender, athleteIds) {
  if (!athleteIds.length) return;
  const { error } = await supabase
    .from("ranking_enrollments").delete().eq("gender", gender).in("athlete_id", athleteIds);
  if (error) throw error;
}

// Zera o ranking do gênero: novo marco de data + remove todas as inscrições.
// (Campeonatos e atletas continuam salvos; só deixam de contar pontos.)
export async function resetRanking(gender) {
  const now = new Date().toISOString();
  const a = await supabase.from("ranking_settings").upsert({ gender, reset_at: now }, { onConflict: "gender" });
  if (a.error) throw a.error;
  const b = await supabase.from("ranking_enrollments").delete().eq("gender", gender);
  if (b.error) throw b.error;
}
