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
  if (path === '/games') return 'lobby'
  if (path === '/leaderboard') return 'leaderboard'
  return 'landing'
}

function navigateTo(path: string) {
  window.history.pushState(null, '', path)
}

function App() {
  const [page, setPage] = useState<Page>(getInitialPage)
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [myScore, setMyScore] = useState(0)

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

  const handleAdmin = () => {
    setPage('admin')
  }

  const handleDone = () => {
    navigateTo('/')
    setPage('landing')
  }

  const address = wallet?.address ?? ''

  switch (page) {
    case 'landing':
      return <Landing onAdmin={handleAdmin} onPlay={() => { navigateTo('/games'); setPage('lobby') }} />
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
          leaderboard={leaderboard}
          myAddress={address}
          walletPrivateKey={wallet?.privateKey ?? ''}
          onBackToLobby={() => { navigateTo('/games'); setPage('lobby') }}
        />
      )
    case 'wallet':
      return <WalletExport onDone={handleDone} />
    case 'admin':
      return <Admin onBack={handleDone} />
    default:
      return <Landing onAdmin={handleAdmin} onPlay={() => { navigateTo('/games'); setPage('lobby') }} />
  }
}

export default App
