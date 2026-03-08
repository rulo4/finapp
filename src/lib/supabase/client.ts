import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function getSupabaseConfig() {
  return {
    url: supabaseUrl ?? '',
    anonKeyLoaded: Boolean(supabaseAnonKey),
  };
}

export async function checkSupabaseConnection() {
  if (!supabase) {
    return {
      ok: false,
      message: 'Faltan variables de entorno para inicializar el cliente.',
    };
  }

  const { error } = await supabase.from('expense_categories').select('id').limit(1);

  if (error) {
    return {
      ok: false,
      message: error.message,
    };
  }

  return {
    ok: true,
    message: 'Conexion correcta con Supabase local.',
  };
}
