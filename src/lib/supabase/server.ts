// Server-side Supabase client. Avoid "use client" imports here.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

if (!url || !anon) {
  console.warn("[supabase/server] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

export const supabaseServer = createClient(url, anon, { auth: { persistSession: false } });

// Mark server-only so Next.js doesn't include it in client bundles
import "server-only";
