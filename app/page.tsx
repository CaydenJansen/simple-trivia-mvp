import Link from "next/link";
import BrandWordmark from "@/components/BrandWordmark";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f7f6ff] flex items-center justify-center px-6">
      <div className="w-full max-w-3xl">
        <div className="text-center mb-10">
          <h1 className="mb-1 text-4xl">
            <BrandWordmark />
          </h1>

          <p className="mt-3 text-zinc-500">
            Live trivia. One phone per team.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <Link
            href="/host"
            className="group rounded-2xl border border-zinc-200 bg-white p-7 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
          >
            <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-violet-100 text-xl">
              🎤
            </div>

            <h2 className="text-xl font-semibold text-zinc-900">
              Host
            </h2>

            <p className="mt-2 text-sm leading-6 text-zinc-500">
              Build quizzes, open a lobby and run a live trivia game.
            </p>

            <div className="mt-6 font-medium text-violet-600">
              Host a game →
            </div>
          </Link>

          <Link
            href="/play"
            className="group rounded-2xl border border-zinc-200 bg-white p-7 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
          >
            <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-violet-100 text-xl">
              📱
            </div>

            <h2 className="text-xl font-semibold text-zinc-900">
              Play
            </h2>

            <p className="mt-2 text-sm leading-6 text-zinc-500">
              Enter a game code and join your team on your phone.
            </p>

            <div className="mt-6 font-medium text-violet-600">
              Join a game →
            </div>
          </Link>
        </div>

        <p className="mt-8 text-center text-xs text-zinc-400">
          Good Trivia Company
        </p>
      </div>
    </main>
  );
}
