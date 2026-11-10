"use client";
import { useEffect } from "react";

/** Redirects carry the invite in the fragment. Keep it out of login form data and server logs. */
export function InviteFragment() {
  useEffect(() => {
    if (!location.hash.startsWith("#join=") || location.hash.length > 8192) return;
    try {
      sessionStorage.setItem("figcraft-join-after-login", location.hash);
      history.replaceState(history.state, "", location.pathname + location.search);
    } catch { /* Keep the fragment when this browser disallows session storage. */ }
  }, []);
  return null;
}
