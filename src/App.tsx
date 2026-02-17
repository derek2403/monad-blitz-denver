import { useState, useCallback } from 'react'
import { Routes, Route, useNavigate, Navigate } from 'react-router-dom'
import { Wallet } from 'ethers'
import Landing from './pages/Landing'
import Lobby from './pages/Lobby'
import Game from './components/Game/Game'
import Leaderboard from './pages/Leaderboard'
import Reward from './pages/Reward'
import WalletExport from './pages/WalletExport'

interface LeaderboardEntry {
  address: string
  score: number
}

function App() {
  const navigate = useNavigate()
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [myScore, setMyScore] = useState(0)

  const handlePlay = () => {
    navigate('/Lobby')
  }

  const handleGameStart = useCallback((w: Wallet) => {
    setWallet(w)
    navigate('/Game')
  }, [navigate])

  const handleGameEnd = useCallback((lb: LeaderboardEntry[], score: number) => {
    setLeaderboard(lb)
    setMyScore(score)
    navigate('/Leaderboard')
  }, [navigate])

  const handleClaimPrize = () => {
    navigate('/Reward')
  }

  const handleExportWallet = () => {
    navigate('/WalletExport')
  }

  const address = wallet?.address ?? ''

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/Landing" replace />} />
      <Route path="/Landing" element={<Landing onPlay={handlePlay} />} />
      <Route path="/Lobby" element={<Lobby onGameStart={handleGameStart} />} />
      <Route
        path="/Game"
        element={wallet ? <Game wallet={wallet} onGameEnd={handleGameEnd} /> : <Navigate to="/Lobby" replace />}
      />
      <Route
        path="/Leaderboard"
        element={
          <Leaderboard
            leaderboard={leaderboard}
            myScore={myScore}
            myAddress={address}
            onClaimPrize={handleClaimPrize}
          />
        }
      />
      <Route
        path="/Reward"
        element={
          <Reward
            myScore={myScore}
            myAddress={address}
            onExportWallet={handleExportWallet}
          />
        }
      />
      <Route path="/WalletExport" element={<WalletExport />} />
    </Routes>
  )
}

export default App
