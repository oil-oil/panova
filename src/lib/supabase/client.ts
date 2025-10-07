"use client";

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

if (!url || !anon) {
  // Soft fail in dev; we'll warn once, UI may fallback to migration path
  console.warn("Supabase env missing: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

export const supabase = createClient(url, anon, {
  auth: { persistSession: false },
});
