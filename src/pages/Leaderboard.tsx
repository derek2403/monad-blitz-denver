interface LeaderboardEntry {
  address: string
  score: number
}

interface LeaderboardProps {
  leaderboard: LeaderboardEntry[]
  myScore: number
  myAddress: string
  onClaimPrize: () => void
}

export default function Leaderboard({ leaderboard, myScore, myAddress, onClaimPrize }: LeaderboardProps) {
  const myRank = leaderboard.findIndex(e => e.address.toLowerCase() === myAddress.toLowerCase()) + 1

  return (
    <div className="relative w-screen h-screen bg-[#0a0a1a] overflow-hidden select-none flex flex-col items-center justify-center px-8">
      {/* Background video */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <video src="/character.mp4" autoPlay loop muted playsInline style={{ height: '80%', objectFit: 'contain', opacity: 0.15 }} />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-6 w-full max-w-lg">
        <div className="text-[11px] font-semibold tracking-[0.25em] uppercase text-gray-400">Game Over</div>
        <h1 className="text-5xl font-bold font-mono text-yellow-400">LEADERBOARD</h1>

        {/* My result */}
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl px-6 py-4 w-full text-center">
          <div className="text-gray-400 text-xs uppercase tracking-widest mb-1">Your Result</div>
          <div className="text-yellow-400 text-3xl font-bold font-mono">{myScore} pts</div>
          {myRank > 0 && <div className="text-gray-300 text-sm mt-1">Rank #{myRank} of {leaderboard.length}</div>}
        </div>

        {/* Leaderboard table */}
        <div className="w-full bg-black/40 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-md max-h-[40vh] overflow-y-auto">
          <div className="grid grid-cols-[50px_1fr_80px] text-xs text-gray-500 font-semibold uppercase tracking-wider px-4 py-3 border-b border-white/10">
            <span>Rank</span>
            <span>Player</span>
            <span className="text-right">Score</span>
          </div>
          {leaderboard.map((entry, i) => {
            const short = `${entry.address.slice(0, 6)}...${entry.address.slice(-4)}`
            const isMe = entry.address.toLowerCase() === myAddress.toLowerCase()
            const rankColor = i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-orange-400' : 'text-gray-500'
            return (
              <div
                key={entry.address}
                className={`grid grid-cols-[50px_1fr_80px] px-4 py-3 border-b border-white/5 ${isMe ? 'bg-yellow-500/10' : ''}`}
              >
                <span className={`font-bold font-mono ${rankColor}`}>#{i + 1}</span>
                <span className={`font-mono text-sm ${isMe ? 'text-yellow-400' : 'text-white/80'}`}>
                  {short} {isMe ? '(you)' : ''}
                </span>
                <span className="text-green-400 font-bold font-mono text-right">{entry.score}</span>
              </div>
            )
          })}
          {leaderboard.length === 0 && (
            <div className="px-4 py-6 text-center text-gray-500 text-xs">No scores recorded</div>
          )}
        </div>

        {/* Claim Prize button */}
        <button
          onClick={onClaimPrize}
          className="mt-4 bg-yellow-500 hover:bg-yellow-400 active:scale-95 text-black text-lg font-bold px-10 py-3.5 rounded-2xl transition-all shadow-lg shadow-yellow-400/30 hover:shadow-yellow-400/50"
        >
          CLAIM PRIZE
        </button>
      </div>
    </div>
  )
}
