import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Set these to the Supabase project URL and publishable/anon key.
export const SUPABASE_URL = "https://xjjkhsdcqbaflodjiljs.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_VbZrx48guWcb3PsOt8A_xw_6d45xnc0";
export const supabaseConfigured = !SUPABASE_URL.includes("YOUR_PROJECT_ID")
  && !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE_PUBLISHABLE_KEY");

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);
