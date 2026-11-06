export function supabaseConfig(): { url: string; publishableKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey?.startsWith("sb_publishable_")) {
    throw new Error("Configure the Supabase URL and publishable key for the preview host.");
  }
  return { url, publishableKey };
}
