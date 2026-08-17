import Link from "next/link";

export default function PlayPage() {
  return (
    <main className="min-h-screen bg-[#f7f6ff] flex justify-center">
      <div className="w-full max-w-[430px] min-h-screen bg-[#f7f6ff] px-6 flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600 text-white font-bold text-lg">
            ST
          </div>

          <h1 className="mt-7 text-3xl font-bold text-zinc-900">
            Join a Game
          </h1>

          <p className="mt-3 text-center text-sm text-zinc-500">
            Enter the game code shown by your quiz host.
          </p>

          <div className="mt-8 w-full">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="728461"
              className="w-full rounded-2xl border border-zinc-200 bg-white px-5 py-5 text-center text-3xl font-semibold tracking-[0.3em] text-zinc-900 outline-none transition focus:border-violet-500"
            />

<Link
  href="/play/setup"
  className="block w-full rounded-xl bg-violet-600 py-4 text-center font-semibold text-white"
>
  Join Game
</Link>

            <p className="mt-4 text-center text-xs text-zinc-400">
              Or scan your host&apos;s QR code to join instantly.
            </p>
          </div>
        </div>

        <div className="pb-6 text-center text-xs text-zinc-400">
          One phone per team.
        </div>
      </div>
    </main>
  );
}