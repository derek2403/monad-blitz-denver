import { useState } from 'react'

interface RewardProps {
  myScore: number
  myAddress: string
  onExportWallet: () => void
}

export default function Reward({ myScore, myAddress, onExportWallet }: RewardProps) {
  const [claimed, setClaimed] = useState(false)

  // Hardcoded reward amount for now — will be replaced with real logic
  const rewardAmount = (myScore * 0.01).toFixed(4)

  const handleClaim = () => {
    // Hardcoded: simulate claiming reward
    setClaimed(true)
  }

  return (
    <div className="w-screen h-screen bg-white overflow-hidden select-none flex flex-col items-center justify-center px-8">

      <div className="relative z-10 flex flex-col items-center gap-6 max-w-md w-full">
        <div className="text-[11px] font-semibold tracking-[0.25em] uppercase text-gray-400">Rewards</div>
        <h1 className="text-5xl font-bold font-mono text-yellow-400">YOUR PRIZE</h1>

        {/* Prize card */}
        <div className="w-full bg-black/40 border border-yellow-500/30 rounded-2xl p-8 backdrop-blur-md text-center">
          <div className="text-gray-400 text-xs uppercase tracking-widest mb-3">Prize Amount</div>
          <div className="text-yellow-400 text-5xl font-bold font-mono mb-2">{rewardAmount} MON</div>
          <div className="text-gray-500 text-xs">Based on your score of {myScore} pts</div>
        </div>

        {/* Destination */}
        <div className="w-full bg-black/30 border border-white/10 rounded-2xl p-4 backdrop-blur-md">
          <div className="text-gray-400 text-xs uppercase tracking-widest mb-2">Sent to your burner wallet</div>
          <div className="text-white/80 text-xs font-mono break-all bg-black/30 rounded-lg p-3">{myAddress}</div>
        </div>

        {!claimed ? (
          <button
            onClick={handleClaim}
            className="mt-2 bg-yellow-500 hover:bg-yellow-400 active:scale-95 text-black text-lg font-bold px-10 py-3.5 rounded-2xl transition-all shadow-lg shadow-yellow-400/30 hover:shadow-yellow-400/50"
          >
            CLAIM {rewardAmount} MON
          </button>
        ) : (
          <div className="flex flex-col items-center gap-4 mt-2">
            <div className="bg-green-500/20 border border-green-400/30 rounded-2xl px-6 py-3 text-green-400 font-semibold">
              Prize claimed successfully!
            </div>
            <button
              onClick={onExportWallet}
              className="bg-purple-600 hover:bg-purple-500 active:scale-95 text-white text-sm font-bold px-8 py-3 rounded-2xl transition-all shadow-lg shadow-purple-400/20"
            >
              EXPORT WALLET TO GET REWARDS
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
