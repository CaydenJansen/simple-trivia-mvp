"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { validateHostCredentials } from "@/lib/auth/credentials";
import { supabase } from "@/lib/supabase/client";

import HostPrototype from "./HostPrototype";

type AuthMode = "sign-in" | "sign-up";

export default function HostAuthGate({ showDevNavigator = false }: { showDevNavigator?: boolean }) {
  const [session, setSession] = useState<Session | null>(null);
  const [liveHostMode, setLiveHostMode] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    let active = true;
    let authEventVersion = 0;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      authEventVersion += 1;
      if (!active) return;
      setSession(nextSession);
      if (!nextSession) setPassword("");
      setCheckingSession(false);
    });

    const sessionRequestVersion = authEventVersion;

    void supabase.auth.getSession().then(({ data }) => {
      if (!active || authEventVersion !== sessionRequestVersion) return;
      setSession(data.session);
      if (!data.session) setPassword("");
      setCheckingSession(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setIsError(false);

    const credentials = validateHostCredentials(email, password);
    if (!credentials.valid) {
      setMessage(credentials.message);
      setIsError(true);
      return;
    }

    setSubmitting(true);

    const result =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword(credentials)
        : await supabase.auth.signUp({
            ...credentials,
            options: { emailRedirectTo: `${window.location.origin}/host` },
          });

    setSubmitting(false);

    if (result.error) {
      setMessage(result.error.message);
      setIsError(true);
      return;
    }

    if (result.data.session) {
      setSession(result.data.session);
      setPassword("");
    }

    if (mode === "sign-up" && !result.data.session) {
      setMessage("Check your email to confirm your account, then sign in.");
      setPassword("");
      setMode("sign-in");
    }
  }

  async function handleSignOut() {
    setMessage(null);
    const { error } = await supabase.auth.signOut();

    if (error) {
      setMessage(error.message);
      setIsError(true);
    }
  }

  if (checkingSession) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f6ff] px-6">
        <p className="text-sm text-zinc-500">Checking your host session…</p>
      </main>
    );
  }

  if (session) {
    return (
      <div className="relative">
        {!liveHostMode && (
          <div className="fixed bottom-4 right-4 z-30 flex items-center gap-3 rounded-xl border border-zinc-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur">
            <span className="hidden max-w-48 truncate text-xs text-zinc-500 sm:block">
              {session.user.email}
            </span>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="text-xs font-semibold text-violet-700 transition hover:text-violet-900"
            >
              Sign out
            </button>
          </div>
        )}
        <HostPrototype showDevNavigator={showDevNavigator} onLiveModeChange={setLiveHostMode} />
      </div>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f6ff] px-6 py-12">
      <section className="w-full max-w-md rounded-3xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-600 text-lg font-bold text-white">
            ST
          </div>
          <h1 className="text-2xl font-bold text-zinc-900">
            {mode === "sign-in" ? "Host sign in" : "Create a host account"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            {mode === "sign-in"
              ? "Sign in to build quizzes and run live games."
              : "Your account will own your quizzes and My Questions."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="host-email" className="text-sm font-medium text-zinc-700">
              Email
            </label>
            <input
              id="host-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 w-full rounded-xl border border-zinc-300 px-4 py-3 text-zinc-900 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="host-password" className="text-sm font-medium text-zinc-700">
              Password
            </label>
            <input
              id="host-password"
              type="password"
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full rounded-xl border border-zinc-300 px-4 py-3 text-zinc-900 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
              placeholder="At least 8 characters"
            />
          </div>

          {message ? (
            <p
              role={isError ? "alert" : "status"}
              className={`rounded-xl px-4 py-3 text-sm ${
                isError
                  ? "bg-red-50 text-red-700"
                  : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {message}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-violet-600 px-4 py-3 font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting
              ? "Please wait…"
              : mode === "sign-in"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "sign-in" ? "sign-up" : "sign-in");
            setMessage(null);
            setIsError(false);
          }}
          className="mt-6 w-full text-center text-sm font-medium text-violet-700 hover:text-violet-900"
        >
          {mode === "sign-in"
            ? "New host? Create an account"
            : "Already have an account? Sign in"}
        </button>
      </section>
    </main>
  );
}
