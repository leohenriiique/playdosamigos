import { supabase } from "./supabaseClient";

function normalizePhone(phone) {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
}

function normalizeInstagram(handle) {
  if (!handle) return "";
  return handle.trim().replace(/^@/, "").toLowerCase();
}

// Procura um atleta já cadastrado pelo telefone ou instagram; se não achar, cria um novo.
// É essa função que garante que a mesma pessoa, em campeonatos diferentes, sempre
// caia no mesmo "cadastro" — e por isso os resultados dela se somam no ranking geral.
export async function findOrCreateAthlete({ name, phone, instagram }) {
  const cleanPhone = normalizePhone(phone);
  const cleanInstagram = normalizeInstagram(instagram);

  if (cleanPhone) {
    const { data } = await supabase.from("athletes").select("*").eq("phone", cleanPhone).maybeSingle();
    if (data) return data;
  }
  if (cleanInstagram) {
    const { data } = await supabase.from("athletes").select("*").eq("instagram", cleanInstagram).maybeSingle();
    if (data) return data;
  }

  const { data, error } = await supabase
    .from("athletes")
    .insert({ name: name.trim(), phone: cleanPhone || null, instagram: cleanInstagram || null })
    .select()
    .single();

  if (error) {
    // Corrida rara: alguém cadastrou o mesmo telefone/instagram entre a busca e a inserção.
    if (error.code === "23505") {
      if (cleanPhone) {
        const { data: existing } = await supabase.from("athletes").select("*").eq("phone", cleanPhone).maybeSingle();
        if (existing) return existing;
      }
      if (cleanInstagram) {
        const { data: existing } = await supabase.from("athletes").select("*").eq("instagram", cleanInstagram).maybeSingle();
        if (existing) return existing;
      }
    }
    throw error;
  }
  return data;
}

// Cria vários atletas de uma vez, sem telefone/instagram (usado no "adicionar vários nomes").
// Sem um identificador, não tem como saber se é a mesma pessoa de outro campeonato —
// por isso cada nome aqui sempre vira um cadastro novo.
export async function createAthletesBulk(names) {
  const rows = names.map((n) => ({ name: n.trim() }));
  const { data, error } = await supabase.from("athletes").insert(rows).select();
  if (error) throw error;
  return data;
}

// Busca atletas já cadastrados pelo nome (autocomplete ao adicionar em um novo campeonato).
export async function searchAthletes(query) {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase
    .from("athletes")
    .select("id, name, phone, instagram")
    .ilike("name", `%${q}%`)
    .order("name")
    .limit(8);
  if (error) throw error;
  return data;
}

// Busca todos os atletas globais cadastrados (usado no ranking geral).
export async function fetchAllAthletes() {
  const { data, error } = await supabase.from("athletes").select("*");
  if (error) throw error;
  return data;
}
