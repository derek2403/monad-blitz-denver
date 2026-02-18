import { useState, useEffect, useCallback, useRef } from 'react'
import { Wallet, JsonRpcProvider, Contract, Interface, WebSocketProvider } from 'ethers'

// ─── Contract ──────────────────────────────────────────────────────────────────

const BALLGAME_ADDRESS = '0xE17722A663E72f876baFe1F73dE6e6e02358Ba65'
const BALL_COUNT = 50
const GAME_DURATION_MS = 40_000 // 40 seconds
const REGEN_THRESHOLD = 10 // regenerate when unclaimed balls drops below this

const BALLGAME_ABI = [
  'function currentGameId() view returns (uint256)',
  'function startGame()',
  'function endGame()',
  'function regenerateBalls()',
  'function claimBall(uint8 index)',
  'function getGamePositions(uint256 gameId) view returns (uint16[50] xs, uint16[50] ys)',
  'function getGameBallTypes(uint256 gameId) view returns (uint8[50])',
  'function getGameClaims(uint256 gameId) view returns (address[50] claimedBy, uint8 claimedCount)',
  'function getGameStartTime(uint256 gameId) view returns (uint256)',
  'function isGameActive() view returns (bool)',
  'function getScore(address player) view returns (uint256)',
  'event GameStarted(uint256 indexed gameId, uint256 startTime, uint16[50] xs, uint16[50] ys, uint8[50] ballTypes)',
  'event BallClaimed(uint256 indexed gameId, uint8 index, address player, uint8 ballType, uint256 newScore)',
  'event GameEnded(uint256 indexed gameId, address endedBy)',
  'event BallsRegenerated(uint256 indexed gameId, uint256 startTime, uint16[50] xs, uint16[50] ys, uint8[50] ballTypes)',
]

const BALLGAME_IFACE = new Interface(BALLGAME_ABI)
const CHAIN_ID = 10143
const MONAD_RPC_URL = 'https://monad-testnet.g.alchemy.com/v2/p3LF9TmoLQFqlPs6DcFxH'
const MONAD_WS_URL = 'wss://monad-testnet.g.alchemy.com/v2/p3LF9TmoLQFqlPs6DcFxH'

const BALL_TYPE_COLORS: Record<number, string> = {
  0: '#3b82f6', 1: '#eab308', 2: '#ef4444',
}
const BALL_TYPE_POINTS: Record<number, string> = {
  0: '+1', 1: '+3', 2: '-5',
}

// Icon mapping for ball types
const NORMAL_ICONS = ['/icons/btc.png', '/icons/eth.png']
const SPECIAL_ICONS = ['/icons/monad.png']
const BOMB_ICONS = ['/icons/ftx.png', '/icons/terra.png']

function getBallIcon(ballType: number, index: number): string {
  if (ballType === 1) return SPECIAL_ICONS[0]
  if (ballType === 2) return BOMB_ICONS[index % BOMB_ICONS.length]
  return NORMAL_ICONS[index % NORMAL_ICONS.length]
}

interface BallState {
  x: number; y: number; ballType: number; claimed: boolean; claimedBy: string | null
}
interface LeaderboardEntry {
  address: string; score: number
}
interface TxLog {
  action: string; wallet: string; txSentAt: number; txConfirmedAt: number | null; wsEventAt: number | null
}

const rpcProvider = new JsonRpcProvider(MONAD_RPC_URL)
const readContract = new Contract(BALLGAME_ADDRESS, BALLGAME_ABI, rpcProvider)

// Clock calibration (ms precision, median of 3 samples)
let clockOffsetMs = 0
async function calibrateClock() {
  try {
    const samples: number[] = []
    for (let i = 0; i < 3; i++) {
      const before = Date.now()
      const block = await rpcProvider.getBlock('latest')
      const after = Date.now()
      if (block) {
        const rtt = after - before
        const localEstimate = before + rtt / 2
        samples.push(block.timestamp * 1000 - localEstimate)
      }
    }
    if (samples.length > 0) {
      samples.sort((a, b) => a - b)
      clockOffsetMs = samples[Math.floor(samples.length / 2)]
    }
  } catch { /* ignore */ }
}
calibrateClock()

// ─── Props ─────────────────────────────────────────────────────────────────────

interface GameProps {
  wallet: Wallet
  onGameEnd: (leaderboard: LeaderboardEntry[], myScore: number, txLogs: TxLog[]) => void
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function Game({ wallet, onGameEnd }: GameProps) {
  const address = wallet.address


  const [gameStartTime, setGameStartTime] = useState(0)
  const [balls, setBalls] = useState<BallState[]>([])
  const [gameActive, setGameActive] = useState(false)
  const [status, setStatus] = useState('')
  const [myScore, setMyScore] = useState(0)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [txLogs, setTxLogs] = useState<TxLog[]>([])
  const [isFalling, setIsFalling] = useState(false)
  const [animOffset, setAnimOffset] = useState<{ dx: number; dy: number }[]>([])
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION_MS)

  const wsProviderRef = useRef<WebSocketProvider | null>(null)
  const pendingTxRef = useRef<TxLog | null>(null)
  const pendingClaimsRef = useRef<Map<number, TxLog>>(new Map())
  const cachedParamsRef = useRef<{ nonce: number; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | null>(null)
  const knownPlayersRef = useRef<Set<string>>(new Set())
  const claimingRef = useRef<Set<number>>(new Set())
  const gameBoxRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<number>(0)
  const fallingStartRef = useRef<number>(0)
  const gameStartedAtRef = useRef<number>(0) // local timestamp when game page mounted / game started
  const gameEndedRef = useRef(false)
  const regenPendingRef = useRef(false)

  // ─── Cached tx params ──────────────────────────────────────────────────────

  const refreshCachedParams = useCallback(async () => {
    try {
      const [nonce, feeData] = await Promise.all([
        rpcProvider.getTransactionCount(wallet.address, 'pending'),
        rpcProvider.getFeeData(),
      ])
      cachedParamsRef.current = {
        nonce,
        maxFeePerGas: feeData.maxFeePerGas ?? 50000000000n,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 2000000000n,
      }
    } catch (err) {
      console.error('Failed to cache tx params:', err)
      cachedParamsRef.current = null
    }
  }, [wallet])

  useEffect(() => { refreshCachedParams() }, [refreshCachedParams])

  // ─── Helpers ───────────────────────────────────────────────────────────────

  const fetchMyScore = useCallback(async () => {
    try { const s = await readContract.getScore(address); setMyScore(Number(s)) } catch { /* ignore */ }
  }, [address])

  const refreshLeaderboard = useCallback(async () => {
    const players = Array.from(knownPlayersRef.current)
    if (players.length === 0) return
    try {
      const scores = await Promise.all(players.map(p => readContract.getScore(p)))
      const entries = players.map((addr, i) => ({ address: addr, score: Number(scores[i]) })).sort((a, b) => b.score - a.score)
      setLeaderboard(entries)
    } catch { /* ignore */ }
  }, [])

  // ─── Fetch game state ──────────────────────────────────────────────────────

  const fetchGameState = useCallback(async () => {
    try {
      const id = await readContract.currentGameId()
      const gameIdNum = Number(id)
      // setGameId(gameIdNum)
      if (gameIdNum === 0) { setBalls([]); setGameActive(false); return }

      const [positions, ballTypes, claims, startTime] = await Promise.all([
        readContract.getGamePositions(gameIdNum),
        readContract.getGameBallTypes(gameIdNum),
        readContract.getGameClaims(gameIdNum),
        readContract.getGameStartTime(gameIdNum),
      ])

      setGameStartTime(Number(startTime))
      const [xs, ys] = positions
      const [claimedBy, claimedCount] = claims
      const isFinished = Number(claimedCount) >= BALL_COUNT

      const newBalls: BallState[] = []
      for (let i = 0; i < BALL_COUNT; i++) {
        const addr = claimedBy[i] as string
        const isClaimed = addr !== '0x0000000000000000000000000000000000000000'
        if (isClaimed) knownPlayersRef.current.add(addr)
        newBalls.push({
          x: Number(xs[i]) / 10, y: Number(ys[i]) / 10,
          ballType: Number(ballTypes[i]),
          claimed: isClaimed || isFinished,
          claimedBy: isClaimed ? addr : null,
        })
      }
      setBalls(newBalls)
      setGameActive(!isFinished)
    } catch (err) { console.error('Failed to fetch game state:', err) }
  }, [])

  useEffect(() => { fetchGameState() }, [fetchGameState])
  useEffect(() => { knownPlayersRef.current.add(address); fetchMyScore() }, [address, fetchMyScore])
  useEffect(() => { if (!gameActive || isFalling) return; const id = setInterval(fetchGameState, 3000); return () => clearInterval(id) }, [gameActive, isFalling, fetchGameState])
  useEffect(() => { refreshLeaderboard(); const id = setInterval(refreshLeaderboard, 5000); return () => clearInterval(id) }, [refreshLeaderboard])

  // ─── 40s game timer (synced to on-chain startTime) ─────────────────────────

  // Countdown timer — uses blockchain gameStartTime so all players share the same deadline
  useEffect(() => {
    if (!gameActive || gameStartTime === 0) return
    const id = setInterval(() => {
      const nowMs = Date.now() + clockOffsetMs
      const elapsed = nowMs - gameStartTime * 1000
      const remaining = Math.max(0, GAME_DURATION_MS - elapsed)
      setTimeLeft(remaining)
    }, 100)
    return () => clearInterval(id)
  }, [gameActive, gameStartTime])

  // ─── Raw tx ────────────────────────────────────────────────────────────────

  const sendRawTx = useCallback(async (action: string, data: string, gasLimit: bigint = 300000n) => {
    if (!cachedParamsRef.current) throw new Error('Cached params not ready')
    const params = cachedParamsRef.current
    const isClaimAction = action.startsWith('claimBall(')

    if (!isClaimAction) {
      const txSentAt = performance.now()
      pendingTxRef.current = { action, wallet: address, txSentAt, txConfirmedAt: null, wsEventAt: null }
    }

    const currentNonce = params.nonce
    params.nonce++

    const signedTx = await wallet.signTransaction({
      to: BALLGAME_ADDRESS, data, nonce: currentNonce, gasLimit,
      maxFeePerGas: params.maxFeePerGas, maxPriorityFeePerGas: params.maxPriorityFeePerGas,
      chainId: CHAIN_ID, type: 2,
    })

      ; (async () => {
        let success = false
        try {
          await rpcProvider.send('eth_sendRawTransaction', [signedTx])
          success = true
        } catch (err: unknown) {
          const msg = ((err as Error)?.message || '') + ((err as { info?: { error?: { message?: string } } })?.info?.error?.message || '')
          if (msg.toLowerCase().includes('nonce')) {
            try {
              await refreshCachedParams()
              if (cachedParamsRef.current) {
                const freshNonce = cachedParamsRef.current.nonce
                cachedParamsRef.current.nonce++
                const retryTx = await wallet.signTransaction({
                  to: BALLGAME_ADDRESS, data, nonce: freshNonce, gasLimit,
                  maxFeePerGas: cachedParamsRef.current.maxFeePerGas,
                  maxPriorityFeePerGas: cachedParamsRef.current.maxPriorityFeePerGas,
                  chainId: CHAIN_ID, type: 2,
                })
                await rpcProvider.send('eth_sendRawTransaction', [retryTx])
                success = true
              }
            } catch { /* retry failed */ }
          }
          if (!success) {
            if (isClaimAction) {
              const match = action.match(/claimBall\((\d+)\)/)
              const idx = match ? Number(match[1]) : -1
              pendingClaimsRef.current.delete(idx)
              claimingRef.current.delete(idx)
            } else { pendingTxRef.current = null }
            setStatus(`${action} failed: ${msg || err}`)
            refreshCachedParams()
            return
          }
        }

        const txConfirmedAt = performance.now()
        if (isClaimAction) {
          const match = action.match(/claimBall\((\d+)\)/)
          const idx = match ? Number(match[1]) : -1
          const pending = pendingClaimsRef.current.get(idx)
          if (pending) pending.txConfirmedAt = txConfirmedAt
          setTxLogs(prev => {
            const entry = prev.find(l => l.action === action && l.txConfirmedAt === null)
            if (entry) return prev.map(l => l === entry ? { ...l, txConfirmedAt } : l)
            return prev
          })
          if (pending?.wsEventAt) pendingClaimsRef.current.delete(idx)
        } else if (pendingTxRef.current) {
          pendingTxRef.current.txConfirmedAt = txConfirmedAt
        }
      })()
  }, [wallet, address, refreshCachedParams])

  // ─── Game actions ──────────────────────────────────────────────────────────

  const callClaimBall = useCallback(async (index: number) => {
    if (claimingRef.current.has(index)) return
    claimingRef.current.add(index)
    const txSentAt = performance.now()
    pendingClaimsRef.current.set(index, {
      action: `claimBall(${index})`, wallet: address, txSentAt, txConfirmedAt: null, wsEventAt: null,
    })
    try {
      const data = BALLGAME_IFACE.encodeFunctionData('claimBall', [index])
      await sendRawTx(`claimBall(${index})`, data, 150000n)
    } catch (err) {
      claimingRef.current.delete(index)
      pendingClaimsRef.current.delete(index)
      setStatus(`claimBall(${index}) failed: ${err}`)
    }
  }, [address, sendRawTx])

  const callRegenerateBalls = useCallback(async () => {
    if (regenPendingRef.current) return
    regenPendingRef.current = true
    fallingStartRef.current = Date.now()
    setIsFalling(true)
    try {
      const data = BALLGAME_IFACE.encodeFunctionData('regenerateBalls')
      await sendRawTx('regenerateBalls()', data, 1000000n)
    } catch (err) {
      regenPendingRef.current = false
      setIsFalling(false)
      fallingStartRef.current = 0
      setStatus(`regenerateBalls() failed: ${err}`)
    }
  }, [sendRawTx])

  const callEndGame = useCallback(async () => {
    if (gameEndedRef.current) return
    gameEndedRef.current = true
    try {
      const data = BALLGAME_IFACE.encodeFunctionData('endGame')
      await sendRawTx('endGame()', data, 300000n)
    } catch (err) {
      gameEndedRef.current = false
      setStatus(`endGame() failed: ${err}`)
    }
  }, [sendRawTx])

  // ─── Auto-regenerate when balls are low ────────────────────────────────────

  useEffect(() => {
    if (!gameActive || isFalling || gameEndedRef.current) return
    const unclaimed = balls.filter(b => !b.claimed).length
    if (unclaimed > 0 && unclaimed < REGEN_THRESHOLD) {
      callRegenerateBalls()
    }
  }, [balls, gameActive, isFalling, callRegenerateBalls])

  // ─── Auto-end after 40s ────────────────────────────────────────────────────

  useEffect(() => {
    if (timeLeft <= 0 && gameActive && !gameEndedRef.current) {
      callEndGame()
    }
  }, [timeLeft, gameActive, callEndGame])

  // ─── WebSocket ─────────────────────────────────────────────────────────────

  useEffect(() => {
    let destroyed = false
    const setupWs = async () => {
      try {
        const wsProvider = new WebSocketProvider(MONAD_WS_URL)
        wsProviderRef.current = wsProvider
        await wsProvider.ready
        if (destroyed) { wsProvider.destroy(); return }
        // ws connected

        const contract = new Contract(BALLGAME_ADDRESS, BALLGAME_ABI, wsProvider)

        contract.on('GameStarted', (gameIdBn: bigint, startTimeBn: bigint, xs: bigint[], ys: bigint[], ballTypes: bigint[]) => {
          const wsEventAt = performance.now()
          const newGameId = Number(gameIdBn)
          calibrateClock()
          claimingRef.current.clear()
          pendingClaimsRef.current.clear()
          regenPendingRef.current = false

          // setGameId(newGameId)
          setGameStartTime(Number(startTimeBn))
          setGameActive(true)
          gameEndedRef.current = false
          if (gameStartedAtRef.current === 0) gameStartedAtRef.current = Date.now()

          const newBalls: BallState[] = []
          for (let i = 0; i < BALL_COUNT; i++) {
            newBalls.push({
              x: Number(xs[i]) / 10, y: Number(ys[i]) / 10,
              ballType: Number(ballTypes[i]), claimed: false, claimedBy: null,
            })
          }
          setBalls(newBalls)

          if (pendingTxRef.current) {
            const pending = pendingTxRef.current
            pendingTxRef.current = null
            setTxLogs(prev => [{ ...pending, wsEventAt }, ...prev].slice(0, 20))
            setStatus(`Game #${newGameId} started: ${((wsEventAt - pending.txSentAt) / 1000).toFixed(3)}s`)
          } else {
            setStatus(`Game #${newGameId} started`)
          }
        })

        contract.on('BallClaimed', (_gameIdBn: bigint, indexBn: bigint, player: string, ballTypeBn: bigint, newScoreBn: bigint) => {
          const wsEventAt = performance.now()
          const idx = Number(indexBn)
          const ballType = Number(ballTypeBn)
          const newScore = Number(newScoreBn)
          const typeLabel = ballType === 1 ? 'Special' : ballType === 2 ? 'Bomb' : 'Normal'
          const pointsLabel = BALL_TYPE_POINTS[ballType]
          knownPlayersRef.current.add(player)

          setBalls(prev => {
            const updated = [...prev]
            if (updated[idx]) updated[idx] = { ...updated[idx], claimed: true, claimedBy: player }
            return updated
          })

          setLeaderboard(prev => {
            const existing = prev.find(e => e.address.toLowerCase() === player.toLowerCase())
            let updated: LeaderboardEntry[]
            if (existing) {
              updated = prev.map(e => e.address.toLowerCase() === player.toLowerCase() ? { ...e, score: newScore } : e)
            } else {
              updated = [...prev, { address: player, score: newScore }]
            }
            return updated.sort((a, b) => b.score - a.score)
          })

          if (player.toLowerCase() === address.toLowerCase()) setMyScore(newScore)

          const shortAddr = `${player.slice(0, 6)}...${player.slice(-4)}`
          const pending = pendingClaimsRef.current.get(idx)
          if (pending) {
            pending.wsEventAt = wsEventAt
            setTxLogs(prev => [{ ...pending, wallet: player, wsEventAt }, ...prev].slice(0, 20))
            setStatus(`${typeLabel} #${idx} (${pointsLabel}) by ${shortAddr}: ${((wsEventAt - pending.txSentAt) / 1000).toFixed(3)}s`)
          } else {
            setTxLogs(prev => [{
              action: `${typeLabel.toLowerCase()} #${idx} (${pointsLabel})`,
              wallet: shortAddr, txSentAt: wsEventAt, txConfirmedAt: null, wsEventAt,
            }, ...prev].slice(0, 20))
            setStatus(`${typeLabel} #${idx} (${pointsLabel}) by ${shortAddr} → Score: ${newScore}`)
          }
        })

        contract.on('BallsRegenerated', (_gameIdBn: bigint, startTimeBn: bigint, xs: bigint[], ys: bigint[], ballTypes: bigint[]) => {
          calibrateClock()
          claimingRef.current.clear()
          pendingClaimsRef.current.clear()

          const newStartTime = Number(startTimeBn)
          const newBalls: BallState[] = []
          for (let i = 0; i < BALL_COUNT; i++) {
            newBalls.push({
              x: Number(xs[i]) / 10, y: Number(ys[i]) / 10,
              ballType: Number(ballTypes[i]), claimed: false, claimedBy: null,
            })
          }

          // If not already falling, start now
          if (fallingStartRef.current === 0) {
            fallingStartRef.current = Date.now()
            setIsFalling(true)
          }

          const elapsed = Date.now() - fallingStartRef.current
          const remaining = Math.max(0, 2000 - elapsed)

          setTimeout(() => {
            setGameStartTime(newStartTime)
            setGameActive(true)
            setIsFalling(false)
            fallingStartRef.current = 0
            regenPendingRef.current = false
            setBalls(newBalls)
            setStatus('New balls generated!')
          }, remaining)
        })

        contract.on('GameEnded', () => {
          setGameActive(false)
          setBalls(prev => prev.map(b => ({ ...b, claimed: true })))
          setStatus('Game ended!')
          gameEndedRef.current = true
        })
      } catch (err) {
        console.error('WS failed:', err)
        // ws disconnected
      }
    }
    setupWs()
    return () => {
      destroyed = true
      wsProviderRef.current?.destroy()
      wsProviderRef.current = null
      // ws cleanup
    }
  }, [address])

  // ─── Transition to leaderboard after game ends ─────────────────────────────

  useEffect(() => {
    if (gameEndedRef.current && !gameActive) {
      // Give time for final scores to settle
      const timer = setTimeout(async () => {
        await refreshLeaderboard()
        await fetchMyScore()
        // Read latest state
        const players = Array.from(knownPlayersRef.current)
        let finalLb = leaderboard
        if (players.length > 0) {
          try {
            const scores = await Promise.all(players.map(p => readContract.getScore(p)))
            finalLb = players.map((addr, i) => ({ address: addr, score: Number(scores[i]) })).sort((a, b) => b.score - a.score)
          } catch { /* use existing */ }
        }
        let finalScore = myScore
        try { const s = await readContract.getScore(address); finalScore = Number(s) } catch { /* use existing */ }
        onGameEnd(finalLb, finalScore, txLogs)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [gameActive])

  // ─── Ball animation ────────────────────────────────────────────────────────

  useEffect(() => {
    if (balls.length === 0 || !gameActive) {
      setAnimOffset([])
      cancelAnimationFrame(animRef.current)
      return
    }

    if (isFalling && fallingStartRef.current === 0) fallingStartRef.current = Date.now()
    if (!isFalling) fallingStartRef.current = 0

    const animate = () => {
      if (isFalling) {
        const elapsed = (Date.now() - fallingStartRef.current) / 1000
        const offsets = balls.map((ball, i) => {
          const delay = (i % 5) * 0.08
          const t = Math.max(0, elapsed - delay)
          const gravity = 200
          const fallDist = 0.5 * gravity * t * t
          const dy = Math.min(fallDist, 120 - ball.y)
          return { dx: 0, dy }
        })
        setAnimOffset(offsets)
        animRef.current = requestAnimationFrame(animate)
        return
      }

      const t = ((Date.now() + clockOffsetMs) / 1000) - gameStartTime

      const offsets = balls.map((ball, i) => {
        const cycleDuration = 3.0 + (i % 4) * 0.5
        const launchDelay = (i % 5) * 0.4
        const elapsed = t - launchDelay
        if (elapsed < 0) return { dx: 0, dy: 110 - ball.y }

        const phase = (elapsed % cycleDuration) / cycleDuration
        const peakHeight = 75 + (i % 3) * 15
        const baseY = 110
        const targetY = baseY - peakHeight * 4 * phase * (1 - phase)
        const dx = Math.sin(elapsed * 0.6 + i * 2.0) * 2.5
        const dy = targetY - ball.y
        return { dx, dy }
      })
      setAnimOffset(offsets)
      animRef.current = requestAnimationFrame(animate)
    }

    animRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animRef.current)
  }, [balls, gameActive, gameStartTime, isFalling])

  // ─── Render ────────────────────────────────────────────────────────────────

  const timerSeconds = Math.ceil(timeLeft / 1000)
  const timerProgress = timeLeft / GAME_DURATION_MS
  const isTimerLow = timeLeft < 5000

  return (
    <div className="w-screen h-screen select-none overflow-hidden" style={{ backgroundColor: '#1a1a2e' }}>
      {/* Game box */}
      <div
        ref={gameBoxRef}
        className="relative w-full h-full overflow-hidden"
        style={{ backgroundColor: '#1a1a2e' }}
      >
        {/* Score — top left */}
        <div className="absolute top-4 left-4 z-10">
          <div className="bg-black/60 border border-white/10 rounded-xl px-4 py-2.5 backdrop-blur-md">
            <div className="text-[9px] font-semibold tracking-[0.18em] uppercase text-gray-400 mb-0.5">Score</div>
            <div className="text-yellow-400 text-3xl font-bold font-mono tabular-nums leading-none">{myScore}</div>
          </div>
        </div>


        {/* Timer — top right */}
        <div className="absolute top-4 right-4 z-10">
          <div className="bg-black/60 border border-white/10 rounded-xl px-4 py-2.5 backdrop-blur-md flex items-center gap-3">
            <svg width="48" height="48" viewBox="0 0 48 48">
              <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
              <circle
                cx="24" cy="24" r="20" fill="none"
                stroke={isTimerLow ? '#FF4444' : '#A78BFA'}
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 20}`}
                strokeDashoffset={`${2 * Math.PI * 20 * (1 - timerProgress)}`}
                style={{
                  transform: 'rotate(-90deg)',
                  transformOrigin: '50% 50%',
                  filter: isTimerLow ? 'drop-shadow(0 0 6px #FF4444)' : 'drop-shadow(0 0 4px #A78BFA)',
                }}
              />
              <text
                x="24" y="24"
                textAnchor="middle" dominantBaseline="central"
                fill={isTimerLow ? '#FF4444' : '#fff'}
                fontSize="16" fontWeight="bold" fontFamily="monospace"
              >
                {timerSeconds}
              </text>
            </svg>
          </div>
        </div>

        {/* Character — center */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 0 }}>
          <img src="/character.gif" alt="" style={{ width: 300, height: 300, opacity: 0.35 }} />
        </div>

        {/* Balls */}
        {balls.map((ball, i) => {
          if (ball.claimed) return null
          const offset = animOffset[i] || { dx: 0, dy: 0 }
          const bx = ball.x + offset.dx
          const by = ball.y + offset.dy
          const isBomb = ball.ballType === 2
          const isSpecial = ball.ballType === 1
          const iconSrc = getBallIcon(ball.ballType, i)
          const size = isBomb ? 42 : isSpecial ? 40 : 36
          return (
            <button
              key={`${gameStartTime}-${i}`}
              onClick={() => {
                // Optimistically hide the ball immediately (like Game.jsx)
                setBalls(prev => {
                  const updated = [...prev]
                  if (updated[i]) updated[i] = { ...updated[i], claimed: true }
                  return updated
                })
                callClaimBall(i)
              }}
              style={{
                position: 'absolute',
                left: `${bx}%`,
                top: `${by}%`,
                transform: 'translate(-50%, -50%)',
                width: `${size}px`,
                height: `${size}px`,
                borderRadius: '50%',
                border: isSpecial ? '2px solid #fde047' : isBomb ? '2px solid #fca5a5' : '2px solid rgba(255,255,255,0.3)',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                padding: 0,
                overflow: 'hidden',
                boxShadow: isSpecial
                  ? '0 0 18px #eab308aa, 0 0 36px #eab30866, 0 0 60px #eab30833'
                  : isBomb
                    ? '0 0 16px #ef444488, 0 0 30px #ef444444'
                    : '0 0 10px rgba(255,255,255,0.3)',
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
                userSelect: 'none',
              }}
            >
              <img
                src={iconSrc}
                alt=""
                draggable={false}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  borderRadius: '50%',
                  pointerEvents: 'none',
                }}
              />
            </button>
          )
        })}

        {/* Empty state */}
        {balls.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-lg">
            Waiting for game...
          </div>
        )}

        {/* All claimed waiting for regen */}
        {balls.length > 0 && balls.every(b => b.claimed) && gameActive && (
          <div className="absolute inset-0 flex items-center justify-center text-purple-400 text-lg font-semibold">
            Regenerating balls...
          </div>
        )}

        {/* Game over */}
        {!gameActive && gameEndedRef.current && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="text-yellow-400 text-2xl font-bold font-mono">GAME OVER — Loading results...</div>
          </div>
        )}
      </div>

      {/* Status text below game box */}
      {status && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
          <span className="text-xs text-gray-400 font-mono">{status}</span>
        </div>
      )}
    </div>
  )
}
