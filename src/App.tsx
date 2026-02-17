import { useState, useCallback } from 'react'
import { Wallet } from 'ethers'
import Landing from './pages/Landing'
import Lobby from './pages/Lobby'
import Game from './pages/Game'
import Leaderboard from './pages/Leaderboard'
import Reward from './pages/Reward'
import WalletExport from './pages/WalletExport'
import Admin from './pages/Admin'

type Page = 'landing' | 'lobby' | 'game' | 'leaderboard' | 'reward' | 'wallet' | 'admin'

interface LeaderboardEntry {
  address: string
  score: number
}

function getInitialPage(): Page {
  const path = window.location.pathname
  if (path === '/admin') return 'admin'
  return 'landing'
}

function App() {
  const [page, setPage] = useState<Page>(getInitialPage)
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [myScore, setMyScore] = useState(0)

  const handlePlay = () => {
    setPage('lobby')
  }

  const handleGameStart = useCallback((w: Wallet) => {
    setWallet(w)
    setPage('game')
  }, [])

  const handleGameEnd = useCallback((lb: LeaderboardEntry[], score: number) => {
    setLeaderboard(lb)
    setMyScore(score)
    setPage('leaderboard')
  }, [])

  const handleClaimPrize = () => {
    setPage('reward')
  }

  const handleExportWallet = () => {
    setPage('wallet')
  }

  const handleAdmin = () => {
    setPage('admin')
  }

  const handleDone = () => {
    setPage('landing')
  }

  const address = wallet?.address ?? ''

  switch (page) {
    case 'landing':
      return <Landing onPlay={handlePlay} onAdmin={handleAdmin} />
    case 'lobby':
      return <Lobby onGameStart={handleGameStart} />
    case 'game':
      return wallet ? <Game wallet={wallet} onGameEnd={handleGameEnd} /> : null
    case 'leaderboard':
      return (
        <Leaderboard
          leaderboard={leaderboard}
          myScore={myScore}
          myAddress={address}
          onClaimPrize={handleClaimPrize}
        />
      )
    case 'reward':
      return (
        <Reward
          myScore={myScore}
          myAddress={address}
          onExportWallet={handleExportWallet}
        />
      )
    case 'wallet':
      return <WalletExport onDone={handleDone} />
    case 'admin':
      return <Admin onBack={handleDone} />
    default:
      return <Landing onPlay={handlePlay} onAdmin={handleAdmin} />
  }
}

export default App
