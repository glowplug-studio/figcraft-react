import { InviteFragment } from "./invite-fragment";
import { safeDestination } from "../../lib/auth";
import { login } from "./actions";

const messages: Record<string, string> = {
  credentials: "Sign-in failed. Check your email and password.",
  callback: "This sign-in link could not be verified. Sign in again.",
  unavailable: "Sign-in is currently unavailable. Try again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams;
  const error = typeof params.error === "string" && Object.hasOwn(messages, params.error) ? messages[params.error] : undefined;
  return (
    <main className="auth-page">
      <InviteFragment />
      <h1>Sign in to Figcraft</h1>
      <p>Use your host account to open the editor.</p>
      {error ? <p role="alert">{error}</p> : null}
      <form action={login}>
        <input type="hidden" name="next" value={safeDestination(params.next)} />
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
