interface LandingProps {
  onPlay: () => void
  onAdmin: () => void
}

export default function Landing({ onPlay, onAdmin }: LandingProps) {
  return (
    <div className="relative w-screen h-screen bg-white overflow-hidden select-none flex flex-col items-center justify-center">
      <div className="relative z-10 flex flex-col items-center gap-6">
        <h1 className="text-6xl font-bold font-mono text-center leading-tight">
          <span className="text-yellow-400">Monad</span>{' '}
          <span className="text-purple-400">Ball Game</span>
        </h1>
        <p className="text-gray-400 text-sm text-center max-w-md">
          Catch the on-chain balls, earn points, and claim your rewards on Monad Testnet.
        </p>

        <button
          onClick={onPlay}
          className="mt-8 bg-yellow-500 hover:bg-yellow-400 active:scale-95 text-black text-lg font-bold px-12 py-4 rounded-2xl transition-all shadow-lg shadow-yellow-400/30 hover:shadow-yellow-400/50"
        >
          PLAY
        </button>

        <span className="text-gray-600 text-xs mt-4 tracking-widest uppercase">
          Built on Monad Testnet
        </span>

        <button
          onClick={onAdmin}
          className="mt-6 text-gray-600 hover:text-gray-400 text-xs underline transition-colors"
        >
          Admin Panel
        </button>
      </div>
    </div>
  )
}
