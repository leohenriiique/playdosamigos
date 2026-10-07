import { supabase } from "./supabaseClient";

// Lista os campeonatos (sem o campo "data" pesado — só o resumo para a tela inicial).
export async function listTournaments() {
  const { data, error } = await supabase
    .from("tournaments")
    .select("id, name, status, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data;
}

// Cria um campeonato novo e vazio.
export async function createTournament(name) {
  const { data, error } = await supabase
    .from("tournaments")
    .insert({ name, data: {} })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Carrega um campeonato inteiro (com todo o estado salvo em "data").
export async function loadTournament(id) {
  const { data, error } = await supabase
    .from("tournaments")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

// Salva o estado do campeonato (chamado a cada alteração, com debounce no app).
export async function saveTournamentData(id, payload) {
  const { error } = await supabase
    .from("tournaments")
    .update({ data: payload, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// Renomeia um campeonato.
export async function renameTournament(id, name) {
  const { error } = await supabase.from("tournaments").update({ name }).eq("id", id);
  if (error) throw error;
}

// Marca um campeonato como finalizado ou em andamento.
export async function setTournamentStatus(id, status) {
  const { error } = await supabase.from("tournaments").update({ status }).eq("id", id);
  if (error) throw error;
}

// Busca todos os campeonatos com o "data" completo (usado no ranking geral).
export async function fetchAllTournamentsFull() {
  const { data, error } = await supabase
    .from("tournaments")
    .select("id, name, status, data");
  if (error) throw error;
  return data;
}

// Exclui um campeonato permanentemente.
export async function deleteTournament(id) {
  const { error } = await supabase.from("tournaments").delete().eq("id", id);
  if (error) throw error;
}
