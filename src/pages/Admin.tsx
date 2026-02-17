import { useState, useEffect, useCallback, useRef } from 'react'
import { Wallet, JsonRpcProvider, Contract, Interface, WebSocketProvider } from 'ethers'

const BALLGAME_ADDRESS = '0xE17722A663E72f876baFe1F73dE6e6e02358Ba65'
const CHAIN_ID = 10143
const MONAD_RPC_URL = 'https://monad-testnet.g.alchemy.com/v2/6U7t79S89NhHIspqDQ7oKGRWp5ZOfsNj'
const MONAD_WS_URL = 'wss://monad-testnet.g.alchemy.com/v2/6U7t79S89NhHIspqDQ7oKGRWp5ZOfsNj'
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

  const wsProviderRef = useRef<WebSocketProvider | null>(null)

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

  useEffect(() => { fetchState() }, [fetchState])
  useEffect(() => {
    const id = setInterval(fetchState, 3000)
    return () => clearInterval(id)
  }, [fetchState])

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

        contract.on('BallClaimed', (_: bigint, indexBn: bigint, player: string, ballTypeBn: bigint) => {
          const typeLabel = Number(ballTypeBn) === 1 ? 'Special' : Number(ballTypeBn) === 2 ? 'Bomb' : 'Normal'
          const short = `${player.slice(0, 6)}...${player.slice(-4)}`
          addLog(`Ball #${Number(indexBn)} (${typeLabel}) claimed by ${short}`)
          setClaimedCount(prev => prev + 1)
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
      <div className="w-screen h-screen bg-[#0a0a1a] flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-400 mb-4">No Admin Key</h1>
          <p className="text-gray-400 text-sm mb-6">Set VITE_PRIVATE_KEY in your .env file to use the admin panel.</p>
          <button onClick={onBack} className="text-gray-500 hover:text-white text-sm underline">Back</button>
        </div>
      </div>
    )
  }

  return (
    <div className="w-screen h-screen bg-[#0a0a1a] overflow-hidden select-none flex flex-col items-center justify-center px-8">
      <div className="relative z-10 flex flex-col items-center gap-6 w-full max-w-lg">
        <div className="text-[11px] font-semibold tracking-[0.25em] uppercase text-gray-400">Admin Panel</div>
        <h1 className="text-4xl font-bold font-mono text-purple-400">GAME CONTROL</h1>

        {/* Status card */}
        <div className="w-full bg-black/40 border border-white/10 rounded-2xl p-5 backdrop-blur-md">
          <div className="flex justify-between items-center mb-3">
            <span className="text-gray-400 text-xs uppercase tracking-widest">Contract Status</span>
            <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-400' : 'bg-red-400'}`} />
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500 text-xs">Game ID</span>
              <div className="text-white font-mono font-bold text-lg">{gameId}</div>
            </div>
            <div>
              <span className="text-gray-500 text-xs">Status</span>
              <div className={`font-bold text-lg ${gameActive ? 'text-green-400' : 'text-gray-500'}`}>
                {gameActive ? 'ACTIVE' : 'INACTIVE'}
              </div>
            </div>
            <div>
              <span className="text-gray-500 text-xs">Balls Claimed</span>
              <div className="text-white font-mono font-bold text-lg">{claimedCount} / 50</div>
            </div>
            <div>
              <span className="text-gray-500 text-xs">Admin Wallet</span>
              <div className="text-white/60 font-mono text-xs truncate">{wallet.address.slice(0, 10)}...</div>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="w-full flex flex-col gap-3">
          <button
            onClick={handleStartGame}
            disabled={loading || gameActive}
            className="w-full bg-green-600 hover:bg-green-500 disabled:bg-green-900 disabled:opacity-50 text-white text-lg font-bold py-3.5 rounded-2xl transition-all shadow-lg shadow-green-500/20 disabled:shadow-none"
          >
            {gameActive ? 'GAME IN PROGRESS' : 'START GAME'}
          </button>

          <div className="flex gap-3">
            <button
              onClick={handleRegenerate}
              disabled={loading || !gameActive}
              className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-900 disabled:opacity-50 text-white font-bold py-3 rounded-2xl transition-all"
            >
              REGENERATE BALLS
            </button>
            <button
              onClick={handleEndGame}
              disabled={loading || !gameActive}
              className="flex-1 bg-red-600 hover:bg-red-500 disabled:bg-red-900 disabled:opacity-50 text-white font-bold py-3 rounded-2xl transition-all"
            >
              END GAME
            </button>
          </div>
        </div>

        {/* Status text */}
        {status && (
          <div className="text-sm text-gray-400 text-center">{status}</div>
        )}

        {/* Live log */}
        {logs.length > 0 && (
          <div className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 backdrop-blur-md max-h-[25vh] overflow-y-auto">
            <div className="text-[10px] font-semibold tracking-[0.18em] uppercase text-gray-400 mb-2">Live Log</div>
            <div className="space-y-1">
              {logs.map((log, i) => (
                <div key={i} className="text-xs text-gray-300 font-mono">{log}</div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={onBack}
          className="mt-2 text-gray-500 hover:text-white text-sm underline transition-colors"
        >
          Back to Home
        </button>
      </div>
    </div>
  )
}
