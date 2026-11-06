"use server";

import { redirect } from "next/navigation";
import { loginLocation, safeDestination } from "../../lib/auth";
import { getServerSupabase } from "../../lib/supabase/server";

export async function login(form: FormData): Promise<never> {
  const destination = safeDestination(form.get("next"));
  const email = form.get("email");
  const password = form.get("password");
  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
    redirect(loginLocation(destination, "credentials"));
  }
  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) redirect(loginLocation(destination, "credentials"));
  redirect(destination);
}
