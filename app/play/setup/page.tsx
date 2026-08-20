import { notFound } from "next/navigation";

export default function TeamSetupPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="min-h-screen bg-[#f7f6ff] flex justify-center">
      <div className="w-full max-w-[430px] min-h-screen bg-[#f7f6ff] flex flex-col">

        <div className="bg-white px-6 py-5 border-b border-zinc-200">
          <div className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            • Game found
          </div>

          <h1 className="mt-3 text-xl font-bold text-zinc-900">
            Friday Night Trivia
          </h1>
        </div>

        <div className="flex-1 px-6 py-6">
          <h2 className="text-2xl font-bold text-zinc-900">
            What&apos;s your team name?
          </h2>

          <p className="mt-2 text-sm text-zinc-500">
            This is what you&apos;ll appear as on the leaderboard.
          </p>

          <input
            type="text"
            placeholder="Trivia Newton John"
            className="mt-5 w-full rounded-xl border border-zinc-200 bg-white px-4 py-4 text-base outline-none focus:border-violet-500"
          />

          <div className="my-6 border-t border-zinc-200" />

          <div className="flex items-baseline gap-2">
            <h3 className="font-semibold text-zinc-900">
              Team PIN
            </h3>
            <span className="text-xs text-zinc-400">
              optional
            </span>
          </div>

          <p className="mt-2 text-sm leading-5 text-zinc-500">
            A team PIN links your results across multiple trivia nights so you
            can build a history and compete in tournaments.
          </p>

          <button className="mt-5 w-full rounded-xl border border-zinc-200 bg-white px-4 py-4 text-left">
            <div className="font-semibold text-zinc-900">
              🔑 &nbsp; I already have a team PIN
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              Enter it to link tonight&apos;s result
            </div>
          </button>

          <button className="mt-3 w-full rounded-xl border border-zinc-200 bg-white px-4 py-4 text-left">
            <div className="font-semibold text-zinc-900">
              ✨ &nbsp; Create a team PIN
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              Start building your team history tonight
            </div>
          </button>

          <button className="mt-4 text-sm text-zinc-500 underline">
            Skip for now →
          </button>
        </div>

        <div className="sticky bottom-0 border-t border-zinc-200 bg-[#f7f6ff] px-6 py-4">
          <button className="w-full rounded-xl bg-violet-600 py-4 font-semibold text-white">
            Join Game
          </button>

          <p className="mt-3 text-center text-xs text-zinc-400">
            One phone per team.
          </p>
        </div>
      </div>
    </main>
  );
}
