import { createClient } from "@supabase/supabase-js";

// A "anon key" do Supabase é feita para ficar exposta no código do
// front-end — a segurança real vem das políticas de RLS configuradas
// nas tabelas (veja supabase_schema.sql), não do sigilo desta chave.
// Ainda assim, se quiser trocar de projeto sem editar código, defina
// VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY nas variáveis de ambiente
// da Vercel — elas têm prioridade sobre os valores abaixo.
const FALLBACK_URL = "https://kwmfueucbtvinwfomitz.supabase.co";
const FALLBACK_ANON_KEY = "sb_publishable_rcaWFMELQSfw_wdp6HOV5A_sIKPYB1e";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
