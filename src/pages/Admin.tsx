import { useState, useEffect, useCallback, useRef } from 'react'
import { Wallet, JsonRpcProvider, Contract, Interface, WebSocketProvider } from 'ethers'

const BALLGAME_ADDRESS = '0xE17722A663E72f876baFe1F73dE6e6e02358Ba65'
const CHAIN_ID = 10143
const MONAD_RPC_URL = 'https://monad-testnet.g.alchemy.com/v2/p3LF9TmoLQFqlPs6DcFxH'
const MONAD_WS_URL = 'wss://monad-testnet.g.alchemy.com/v2/p3LF9TmoLQFqlPs6DcFxH'
const ENV_PRIVATE_KEY = import.meta.env.VITE_PRIVATE_KEY as string | undefined

const BALLGAME_ABI = [
  'function currentGameId() view returns (uint256)',
  'function startGame()',
  'function endGame()',
  'function regenerateBalls()',
  'function isGameActive() view returns (bool)',
  'function getGameClaims(uint256 gameId) view returns (address[50] claimedBy, uint8 claimedCount)',
  'function getScore(address player) view returns (uint256)',
  'event GameStarted(uint256 indexed gameId, uint256 startTime, uint16[50] xs, uint16[50] ys, uint8[50] ballTypes)',
  'event BallClaimed(uint256 indexed gameId, uint8 index, address player, uint8 ballType, uint256 newScore)',
  'event GameEnded(uint256 indexed gameId, address endedBy)',
  'event BallsRegenerated(uint256 indexed gameId, uint256 startTime, uint16[50] xs, uint16[50] ys, uint8[50] ballTypes)',
]

const BALLGAME_IFACE = new Interface(BALLGAME_ABI)
const rpcProvider = new JsonRpcProvider(MONAD_RPC_URL)
const readContract = new Contract(BALLGAME_ADDRESS, BALLGAME_ABI, rpcProvider)

interface AdminProps {
  onBack: () => void
}

export default function Admin({ onBack }: AdminProps) {
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [gameActive, setGameActive] = useState(false)
  const [gameId, setGameId] = useState(0)
  const [claimedCount, setClaimedCount] = useState(0)
  const [wsConnected, setWsConnected] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [leaderboard, setLeaderboard] = useState<{ address: string; score: number }[]>([])

  const wsProviderRef = useRef<WebSocketProvider | null>(null)
  const knownPlayersRef = useRef<Set<string>>(new Set())

  const wallet = ENV_PRIVATE_KEY ? new Wallet(ENV_PRIVATE_KEY, rpcProvider) : null

  const addLog = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString()
    setLogs(prev => [`[${time}] ${msg}`, ...prev].slice(0, 30))
  }, [])

  // Fetch game state
  const fetchState = useCallback(async () => {
    try {
      const [id, active] = await Promise.all([
        readContract.currentGameId(),
        readContract.isGameActive(),
      ])
      const idNum = Number(id)
      setGameId(idNum)
      setGameActive(active)

      if (idNum > 0) {
        const [, count] = await readContract.getGameClaims(idNum)
        setClaimedCount(Number(count))
      }
    } catch (err) {
      console.error('Failed to fetch state:', err)
    }
  }, [])

  const refreshLeaderboard = useCallback(async () => {
    const players = Array.from(knownPlayersRef.current)
    if (players.length === 0) return
    try {
      const scores = await Promise.all(players.map(p => readContract.getScore(p)))
      const entries = players
        .map((addr, i) => ({ address: addr, score: Number(scores[i]) }))
        .sort((a, b) => b.score - a.score)
      setLeaderboard(entries)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { fetchState() }, [fetchState])
  useEffect(() => {
    const id = setInterval(fetchState, 3000)
    return () => clearInterval(id)
  }, [fetchState])
  useEffect(() => {
    const id = setInterval(refreshLeaderboard, 3000)
    return () => clearInterval(id)
  }, [refreshLeaderboard])

  // WebSocket for live updates
  useEffect(() => {
    let destroyed = false
    const setup = async () => {
      try {
        const wsProvider = new WebSocketProvider(MONAD_WS_URL)
        wsProviderRef.current = wsProvider
        await wsProvider.ready
        if (destroyed) { wsProvider.destroy(); return }
        setWsConnected(true)

        const contract = new Contract(BALLGAME_ADDRESS, BALLGAME_ABI, wsProvider)

        contract.on('GameStarted', (gameIdBn: bigint) => {
          addLog(`Game #${Number(gameIdBn)} started!`)
          setGameActive(true)
          setGameId(Number(gameIdBn))
          setClaimedCount(0)
        })

        contract.on('BallClaimed', (_: bigint, indexBn: bigint, player: string, ballTypeBn: bigint, newScoreBn: bigint) => {
          const typeLabel = Number(ballTypeBn) === 1 ? 'Special' : Number(ballTypeBn) === 2 ? 'Bomb' : 'Normal'
          const short = `${player.slice(0, 6)}...${player.slice(-4)}`
          addLog(`Ball #${Number(indexBn)} (${typeLabel}) claimed by ${short}`)
          setClaimedCount(prev => prev + 1)
          knownPlayersRef.current.add(player)
          setLeaderboard(prev => {
            const existing = prev.find(e => e.address.toLowerCase() === player.toLowerCase())
            const newScore = Number(newScoreBn)
            let updated: { address: string; score: number }[]
            if (existing) {
              updated = prev.map(e => e.address.toLowerCase() === player.toLowerCase() ? { ...e, score: newScore } : e)
            } else {
              updated = [...prev, { address: player, score: newScore }]
            }
            return updated.sort((a, b) => b.score - a.score)
          })
        })

        contract.on('BallsRegenerated', () => {
          addLog('Balls regenerated!')
          setClaimedCount(0)
        })

        contract.on('GameEnded', (_: bigint, endedBy: string) => {
          const short = `${endedBy.slice(0, 6)}...${endedBy.slice(-4)}`
          addLog(`Game ended by ${short}`)
          setGameActive(false)
        })
      } catch (err) {
        console.error('WS failed:', err)
        setWsConnected(false)
      }
    }

    setup()
    return () => {
      destroyed = true
      wsProviderRef.current?.destroy()
      wsProviderRef.current = null
    }
  }, [addLog])

  // Send raw tx helper
  const sendTx = async (action: string, data: string, gasLimit: bigint = 1000000n) => {
    if (!wallet) { setStatus('No VITE_PRIVATE_KEY set'); return }
    setLoading(true)
    setStatus(`Sending ${action}...`)
    try {
      const [nonce, feeData] = await Promise.all([
        rpcProvider.getTransactionCount(wallet.address, 'pending'),
        rpcProvider.getFeeData(),
      ])
      const signedTx = await wallet.signTransaction({
        to: BALLGAME_ADDRESS,
        data,
        nonce,
        gasLimit,
        maxFeePerGas: feeData.maxFeePerGas ?? 50000000000n,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 2000000000n,
        chainId: CHAIN_ID,
        type: 2,
      })
      await rpcProvider.send('eth_sendRawTransaction', [signedTx])
      setStatus(`${action} sent! Waiting for confirmation...`)
      addLog(`${action} tx sent`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setStatus(`${action} failed: ${msg}`)
      addLog(`${action} failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  const handleStartGame = () => sendTx('startGame', BALLGAME_IFACE.encodeFunctionData('startGame'))
  const handleEndGame = () => sendTx('endGame', BALLGAME_IFACE.encodeFunctionData('endGame'))
  const handleRegenerate = () => sendTx('regenerateBalls', BALLGAME_IFACE.encodeFunctionData('regenerateBalls'))

  if (!wallet) {
    return (
      <div className="w-screen h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-500 mb-4">No Admin Key</h1>
          <p className="text-gray-500 text-sm mb-6">Set VITE_PRIVATE_KEY in your .env file to use the admin panel.</p>
          <button onClick={onBack} className="text-gray-500 hover:text-gray-800 text-sm underline">Back</button>
        </div>
      </div>
    )
  }

  return (
    <div className="w-screen h-screen bg-white overflow-hidden select-none flex flex-col items-center px-8 py-6">
      <div className="text-[11px] font-semibold tracking-[0.25em] uppercase text-gray-500 mb-1">Admin Panel</div>
      <h1 className="text-4xl font-bold font-mono text-purple-500 mb-6">GAME CONTROL</h1>

      <div className="relative z-10 flex gap-6 w-full max-w-5xl flex-1 min-h-0">
        {/* Left column — controls & log */}
        <div className="flex flex-col gap-5 flex-1 min-w-0">
          {/* Status card */}
          <div className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-5">
            <div className="flex justify-between items-center mb-3">
              <span className="text-gray-500 text-xs uppercase tracking-widest">Contract Status</span>
              <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-400 text-xs">Game ID</span>
                <div className="text-gray-800 font-mono font-bold text-lg">{gameId}</div>
              </div>
              <div>
                <span className="text-gray-400 text-xs">Status</span>
                <div className={`font-bold text-lg ${gameActive ? 'text-green-600' : 'text-gray-400'}`}>
                  {gameActive ? 'ACTIVE' : 'INACTIVE'}
                </div>
              </div>
              <div>
                <span className="text-gray-400 text-xs">Balls Claimed</span>
                <div className="text-gray-800 font-mono font-bold text-lg">{claimedCount} / 50</div>
              </div>
              <div>
                <span className="text-gray-400 text-xs">Admin Wallet</span>
                <div className="text-gray-500 font-mono text-xs truncate">{wallet.address.slice(0, 10)}...</div>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="w-full flex flex-col gap-3">
            <button
              onClick={handleStartGame}
              disabled={loading || gameActive}
              className="w-full bg-green-600 hover:bg-green-500 disabled:bg-gray-300 disabled:text-gray-500 text-white text-lg font-bold py-3.5 rounded-2xl transition-all shadow-lg shadow-green-500/20 disabled:shadow-none"
            >
              {gameActive ? 'GAME IN PROGRESS' : 'START GAME'}
            </button>

            <div className="flex gap-3">
              <button
                onClick={handleRegenerate}
                disabled={loading || !gameActive}
                className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-300 disabled:text-gray-500 text-white font-bold py-3 rounded-2xl transition-all"
              >
                REGENERATE BALLS
              </button>
              <button
                onClick={handleEndGame}
                disabled={loading || !gameActive}
                className="flex-1 bg-red-600 hover:bg-red-500 disabled:bg-gray-300 disabled:text-gray-500 text-white font-bold py-3 rounded-2xl transition-all"
              >
                END GAME
              </button>
            </div>
          </div>

          {/* Status text */}
          {status && (
            <div className="text-sm text-gray-500 text-center">{status}</div>
          )}

          {/* Live log */}
          {logs.length > 0 && (
            <div className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-4 flex-1 min-h-0 overflow-y-auto">
              <div className="text-[10px] font-semibold tracking-[0.18em] uppercase text-gray-500 mb-2">Live Log</div>
              <div className="space-y-1">
                {logs.map((log, i) => (
                  <div key={i} className="text-xs text-gray-600 font-mono">{log}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column — live leaderboard */}
        <div className="flex flex-col gap-3 w-80 min-w-[300px]">
          <div className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-4 flex-1 min-h-0 overflow-y-auto">
            <div className="flex justify-between items-center mb-3">
              <div className="text-[10px] font-semibold tracking-[0.18em] uppercase text-gray-500">Live Leaderboard</div>
              <div className="text-[10px] text-gray-400 font-mono">{leaderboard.length} players</div>
            </div>

            {/* Header */}
            <div className="grid grid-cols-[36px_1fr_60px] text-[10px] font-semibold tracking-[0.14em] uppercase text-gray-400 pb-2 border-b border-gray-200">
              <span>#</span>
              <span>Player</span>
              <span className="text-right">Score</span>
            </div>

            {/* Rows */}
            {leaderboard.map((entry, i) => {
              const short = `${entry.address.slice(0, 6)}...${entry.address.slice(-4)}`
              const rankColor = i === 0 ? '#d97706' : i === 1 ? '#6b7280' : i === 2 ? '#ea580c' : '#9ca3af'
              const rankLabel = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`
              return (
                <div
                  key={entry.address}
                  className="grid grid-cols-[36px_1fr_60px] items-center py-2 border-b border-gray-100"
                >
                  <span className="font-mono font-bold text-sm" style={{ color: rankColor }}>
                    {rankLabel}
                  </span>
                  <span className="font-mono text-xs text-gray-600 truncate">{short}</span>
                  <span className="font-mono text-sm font-bold text-right" style={{ color: i < 3 ? rankColor : '#16a34a' }}>
                    {entry.score}
                  </span>
                </div>
              )
            })}

            {leaderboard.length === 0 && (
              <div className="text-center text-gray-400 text-xs py-8">
                No players yet — scores will appear as balls are claimed
              </div>
            )}
          </div>
        </div>
      </div>

      <button
        onClick={onBack}
        className="mt-4 text-gray-500 hover:text-gray-800 text-sm underline transition-colors"
      >
        Back to Home
      </button>
    </div>
  )
}
