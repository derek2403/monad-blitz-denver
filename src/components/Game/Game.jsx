import { useEffect, useRef, useState, useCallback } from 'react'
import {
  COIN_CONFIG, GOOD_TYPES, BAD_TYPES,
  GRAVITY, COIN_RADIUS, SPAWN_INTERVAL_MS, MAX_COINS,
  GOOD_SCORE, BAD_PENALTY, BAD_COIN_CHANCE, WINDOW_MS, GAME_DURATION,
} from './constants'
import {
  JsonRpcProvider, BrowserProvider, Wallet, Contract, Interface,
  WebSocketProvider, formatEther,
} from 'ethers'

// ─── Contract constants ────────────────────────────────────────────────────────

const BALLGAME_ADDRESS = '0xcd03Cf204057882d3E54142D0E17322F77f6Cc4C'
const BALL_COUNT = 50

const BALLGAME_ABI = [
  'function currentGameId() view returns (uint256)',
  'function startGame()',
  'function claimBall(uint8 index)',
  'function getGamePositions(uint256 gameId) view returns (uint16[50] xs, uint16[50] ys)',
  'function getGameBallTypes(uint256 gameId) view returns (uint8[50])',
  'function getGameClaims(uint256 gameId) view returns (address[50] claimedBy, uint8 claimedCount)',
  'function getGameStartTime(uint256 gameId) view returns (uint256)',
  'function isGameActive() view returns (bool)',
  'function getScore(address player) view returns (uint256)',
  'function scores(address) view returns (uint256)',
  'event GameStarted(uint256 indexed gameId, uint256 startTime, uint16[50] xs, uint16[50] ys, uint8[50] ballTypes)',
  'event BallClaimed(uint256 indexed gameId, uint8 index, address player, uint8 ballType, uint256 newScore)',
]

const BALLGAME_IFACE = new Interface(BALLGAME_ABI)
const CHAIN_ID = 10143
const MONAD_RPC_URL = 'https://monad-testnet.g.alchemy.com/v2/6U7t79S89NhHIspqDQ7oKGRWp5ZOfsNj'
const MONAD_WS_URL = 'wss://monad-testnet.g.alchemy.com/v2/6U7t79S89NhHIspqDQ7oKGRWp5ZOfsNj'
const MONAD_TESTNET_CHAIN_ID = '0x279F'
const STORAGE_KEY = 'monad-ballgame-burner-key'
const MODE_KEY = 'monad-ballgame-mode'

const ENV_PRIVATE_KEY = import.meta.env.VITE_PRIVATE_KEY

// Ball type mapping: 0=Normal(+1), 1=Special(+3), 2=Bomb(-5)
const BALL_TYPE_POINTS = { 0: '+1', 1: '+3', 2: '-5' }

const rpcProvider = new JsonRpcProvider(MONAD_RPC_URL)
const readContract = new Contract(BALLGAME_ADDRESS, BALLGAME_ABI, rpcProvider)

// Clock offset for chain time sync
let clockOffset = 0
async function calibrateClock() {
  try {
    const block = await rpcProvider.getBlock('latest')
    if (block) clockOffset = block.timestamp - Math.floor(Date.now() / 1000)
  } catch { /* ignore */ }
}
calibrateClock()

function loadBurnerWallet() {
  const pk = localStorage.getItem(STORAGE_KEY)
  if (!pk) return null
  return new Wallet(pk, rpcProvider)
}

function createBurnerWallet() {
  const w = Wallet.createRandom()
  localStorage.setItem(STORAGE_KEY, w.privateKey)
  return new Wallet(w.privateKey, rpcProvider)
}

// ─── Coin icon image helpers ───────────────────────────────────────────────────

const ICON_MAP = {
  bitcoin:  '/icons/btc.png',
  ethereum: '/icons/eth.png',
  monad:    '/icons/monad.png',
  pizzadao: '/icons/pizzadao.png',
  ftx:      '/icons/ftx.png',
  terra:    '/icons/terra.png',
}

function preloadIcons() {
  const cache = {}
  for (const [key, src] of Object.entries(ICON_MAP)) {
    const img = new Image()
    img.src = src
    cache[key] = img
  }
  return cache
}

// ─── Particle burst on coin click ──────────────────────────────────────────────

const BURST_COLORS_GOOD = ['#FFD700', '#A78BFA', '#60EFFF', '#FFFFFF']
const BURST_COLORS_BAD  = ['#FF4444', '#FF8800', '#FFDD00', '#FF2222']

function spawnBurst(particles, x, y, isGood) {
  const colors = isGood ? BURST_COLORS_GOOD : BURST_COLORS_BAD
  const count  = isGood ? 12 : 10
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4
    const speed = 120 + Math.random() * 220
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 60,
      life: 1.0, decay: 0.0018 + Math.random() * 0.001,
      color: colors[Math.floor(Math.random() * colors.length)],
      radius: 3 + Math.random() * 4,
    })
  }
  particles.push({
    x, y, vx: 0, vy: 0,
    life: 1.0, decay: 0.004,
    color: isGood ? '#A78BFA' : '#FF4444',
    radius: 0, isRing: true, maxRadius: COIN_RADIUS * 2.2,
  })
}

// ─── Coin helpers ──────────────────────────────────────────────────────────────

let _coinId = 0

function makeCoinFromBall(ball, index) {
  // Map on-chain ball type to a coin type for rendering
  const isBad = ball.ballType === 2
  const pool = isBad ? BAD_TYPES : (ball.ballType === 1 ? ['monad'] : GOOD_TYPES)
  const type = pool[Math.floor(Math.random() * pool.length)]
  return {
    id: _coinId++,
    type,
    index,
    x: 0, y: 0, // will be set by animation
    vx: 0, vy: 0,
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: (Math.random() - 0.5) * 6,
    radius: COIN_RADIUS,
    isGood: !isBad,
    ballType: ball.ballType,
    claimed: false,
    // on-chain position (percentage)
    pctX: ball.x,
    pctY: ball.y,
  }
}

function renderCoin(ctx, coin, iconCache) {
  const cfg = COIN_CONFIG[coin.type]
  const icon = iconCache[coin.type]
  ctx.save()
  ctx.translate(coin.x, coin.y)
  ctx.rotate(coin.rotation)

  // Glow
  ctx.shadowColor = cfg.glow
  ctx.shadowBlur = 20

  // Draw icon image if loaded, otherwise fallback to circle
  if (icon && icon.complete && icon.naturalWidth > 0) {
    const size = coin.radius * 2
    ctx.beginPath()
    ctx.arc(0, 0, coin.radius, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()
    ctx.drawImage(icon, -size / 2, -size / 2, size, size)
    ctx.shadowBlur = 0
    // Border
    ctx.strokeStyle = cfg.glow
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(0, 0, coin.radius, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.arc(0, 0, coin.radius, 0, Math.PI * 2)
    ctx.fillStyle = cfg.bg
    ctx.fill()
    ctx.strokeStyle = cfg.glow
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#fff'
    ctx.font = `bold ${Math.round(coin.radius * 0.82)}px monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(cfg.symbol, 0, 0)
  }

  // Bad coin strikethrough
  if (!coin.isGood) {
    ctx.strokeStyle = '#FF4444'
    ctx.lineWidth = 2.5
    ctx.shadowBlur = 0
    const hw = coin.radius * 0.48
    ctx.beginPath()
    ctx.moveTo(-hw, -coin.radius + 9)
    ctx.lineTo(hw, -coin.radius + 9)
    ctx.stroke()
  }

  ctx.restore()
}

function renderTimer(ctx, remaining, total, x, y) {
  const seconds  = Math.ceil(remaining / 1000)
  const progress = remaining / total
  const r = 28
  const isLow = remaining < 3000

  ctx.save()
  // Background ring
  ctx.strokeStyle = 'rgba(255,255,255,0.1)'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.arc(x, y, r, -Math.PI / 2, Math.PI * 1.5)
  ctx.stroke()

  // Progress ring
  const color = isLow ? '#FF4444' : '#A78BFA'
  ctx.strokeStyle = color
  ctx.lineWidth = 5
  ctx.shadowColor = color
  ctx.shadowBlur = isLow ? 14 : 6
  ctx.beginPath()
  ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2)
  ctx.stroke()
  ctx.shadowBlur = 0

  // Number
  ctx.fillStyle = isLow ? '#FF4444' : '#fff'
  ctx.font = 'bold 20px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(seconds, x, y)
  ctx.restore()
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function Game() {
  const canvasRef    = useRef(null)
  const containerRef = useRef(null)
  const iconCacheRef = useRef(null)

  // Canvas game state refs
  const coinsRef      = useRef([])
  const particlesRef  = useRef([])
  const popupsRef     = useRef([])
  const badFlashRef   = useRef(0)

  // ─── Smart contract state ──────────────────────────────────────────────────
  const [gameId, setGameId] = useState(0)
  const [gameStartTime, setGameStartTime] = useState(0)
  const [balls, setBalls] = useState([])
  const [gameActive, setGameActive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [wsConnected, setWsConnected] = useState(false)
  const [balance, setBalance] = useState(null)
  const [txLogs, setTxLogs] = useState([])
  const [leaderboard, setLeaderboard] = useState([])
  const [myScore, setMyScore] = useState(0)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [showSpeedLog, setShowSpeedLog] = useState(false)

  const wsProviderRef = useRef(null)
  const pendingTxRef = useRef(null)
  const pendingClaimsRef = useRef(new Map())
  const cachedParamsRef = useRef(null)
  const knownPlayersRef = useRef(new Set())
  const claimingRef = useRef(new Set())

  // Wallet state
  const [mode, setMode] = useState(() => localStorage.getItem(MODE_KEY) || 'none')
  const [burnerWallet, setBurnerWallet] = useState(() => loadBurnerWallet())
  const [metamaskAddress, setMetamaskAddress] = useState(null)
  const [autoWallet] = useState(() => {
    if (!ENV_PRIVATE_KEY) return null
    return new Wallet(ENV_PRIVATE_KEY, rpcProvider)
  })

  const address = mode === 'auto' ? autoWallet?.address ?? null
    : mode === 'burner' ? burnerWallet?.address ?? null
    : metamaskAddress
  const isConnected = mode !== 'none' && address !== null

  const getDirectWallet = useCallback(() => {
    if (mode === 'auto') return autoWallet
    if (mode === 'burner') return burnerWallet
    return null
  }, [mode, autoWallet, burnerWallet])

  const refreshCachedParams = useCallback(async () => {
    const wallet = getDirectWallet()
    if (!wallet) { cachedParamsRef.current = null; return }
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
  }, [getDirectWallet])

  useEffect(() => {
    if (mode === 'auto' || mode === 'burner') refreshCachedParams()
  }, [mode, address, refreshCachedParams])

  const getSigner = useCallback(async () => {
    if (!window.ethereum) throw new Error('No wallet found')
    const provider = new BrowserProvider(window.ethereum)
    return provider.getSigner()
  }, [])

  const fetchBalance = useCallback(async () => {
    if (!address) return
    try {
      const bal = await rpcProvider.getBalance(address)
      setBalance(formatEther(bal))
    } catch (err) { console.error('Failed to fetch balance:', err) }
  }, [address])

  const refreshLeaderboard = useCallback(async () => {
    const players = Array.from(knownPlayersRef.current)
    if (players.length === 0) return
    try {
      const scores = await Promise.all(players.map(p => readContract.getScore(p)))
      const entries = players
        .map((addr, i) => ({ address: addr, score: Number(scores[i]) }))
        .sort((a, b) => b.score - a.score)
      setLeaderboard(entries)
    } catch (err) { console.error('Failed to refresh leaderboard:', err) }
  }, [])

  const fetchMyScore = useCallback(async () => {
    if (!address) return
    try {
      const s = await readContract.getScore(address)
      setMyScore(Number(s))
    } catch { /* ignore */ }
  }, [address])

  // ─── Fetch game state from contract ────────────────────────────────────────

  const fetchGameState = useCallback(async () => {
    try {
      const id = await readContract.currentGameId()
      const gameIdNum = Number(id)
      setGameId(gameIdNum)
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

      const newBalls = []
      for (let i = 0; i < BALL_COUNT; i++) {
        const addr = claimedBy[i]
        const isClaimed = addr !== '0x0000000000000000000000000000000000000000'
        if (isClaimed) knownPlayersRef.current.add(addr)
        newBalls.push({
          x: Number(xs[i]) / 10,
          y: Number(ys[i]) / 10,
          ballType: Number(ballTypes[i]),
          claimed: isClaimed,
          claimedBy: isClaimed ? addr : null,
        })
      }
      setBalls(newBalls)
      setGameActive(Number(claimedCount) < BALL_COUNT)
    } catch (err) { console.error('Failed to fetch game state:', err) }
  }, [])

  useEffect(() => { fetchGameState() }, [fetchGameState])
  useEffect(() => { if (address) fetchBalance() }, [address, fetchBalance])
  useEffect(() => { if (address) { knownPlayersRef.current.add(address); fetchMyScore() } }, [address, fetchMyScore])

  // Poll game state fallback
  useEffect(() => {
    if (!gameActive) return
    const interval = setInterval(fetchGameState, 3000)
    return () => clearInterval(interval)
  }, [gameActive, fetchGameState])

  // Refresh leaderboard periodically
  useEffect(() => {
    refreshLeaderboard()
    const interval = setInterval(refreshLeaderboard, 5000)
    return () => clearInterval(interval)
  }, [refreshLeaderboard])

  // Auto-detect MetaMask
  useEffect(() => {
    if (mode !== 'metamask' || !window.ethereum) return
    window.ethereum.request({ method: 'eth_accounts' })
      .then((accs) => { if (accs.length > 0) setMetamaskAddress(accs[0]) })
      .catch(console.error)
    const handler = (accs) => { setMetamaskAddress(accs.length === 0 ? null : accs[0]) }
    window.ethereum.on?.('accountsChanged', handler)
    return () => { window.ethereum?.removeListener?.('accountsChanged', handler) }
  }, [mode])

  // ─── WebSocket listener ────────────────────────────────────────────────────

  useEffect(() => {
    let destroyed = false
    const setupWs = async () => {
      try {
        const wsProvider = new WebSocketProvider(MONAD_WS_URL)
        wsProviderRef.current = wsProvider
        await wsProvider.ready
        if (destroyed) { wsProvider.destroy(); return }
        setWsConnected(true)

        const contract = new Contract(BALLGAME_ADDRESS, BALLGAME_ABI, wsProvider)

        contract.on('GameStarted', (gameIdBn, startTimeBn, xs, ys, ballTypes) => {
          const wsEventAt = performance.now()
          const newGameId = Number(gameIdBn)
          calibrateClock()
          claimingRef.current.clear()
          pendingClaimsRef.current.clear()
          setGameId(newGameId)
          setGameStartTime(Number(startTimeBn))
          setGameActive(true)

          const newBalls = []
          for (let i = 0; i < BALL_COUNT; i++) {
            newBalls.push({
              x: Number(xs[i]) / 10, y: Number(ys[i]) / 10,
              ballType: Number(ballTypes[i]), claimed: false, claimedBy: null,
            })
          }
          setBalls(newBalls)

          if (pendingTxRef.current) {
            const pending = pendingTxRef.current
            const log = { ...pending, wsEventAt }
            pendingTxRef.current = null
            setTxLogs(prev => [log, ...prev].slice(0, 20))
            setStatus(`Game #${newGameId} started: ${((wsEventAt - pending.txSentAt) / 1000).toFixed(3)}s`)
          } else {
            setStatus(`Game #${newGameId} started by another player`)
          }
          fetchBalance()
        })

        contract.on('BallClaimed', (gameIdBn, indexBn, player, ballTypeBn, newScoreBn) => {
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
            if (updated.every(b => b.claimed)) setGameActive(false)
            return updated
          })

          setLeaderboard(prev => {
            const existing = prev.find(e => e.address.toLowerCase() === player.toLowerCase())
            let updated
            if (existing) {
              updated = prev.map(e => e.address.toLowerCase() === player.toLowerCase() ? { ...e, score: newScore } : e)
            } else {
              updated = [...prev, { address: player, score: newScore }]
            }
            return updated.sort((a, b) => b.score - a.score)
          })

          if (address && player.toLowerCase() === address.toLowerCase()) setMyScore(newScore)

          const shortAddr = `${player.slice(0, 6)}...${player.slice(-4)}`
          const pending = pendingClaimsRef.current.get(idx)
          if (pending) {
            const log = { ...pending, wallet: player, wsEventAt }
            pending.wsEventAt = wsEventAt
            setTxLogs(prev => [log, ...prev].slice(0, 20))
            setStatus(`${typeLabel} #${idx} (${pointsLabel}) claimed by ${shortAddr}: ${((wsEventAt - pending.txSentAt) / 1000).toFixed(3)}s → Score: ${newScore}`)
          } else {
            setTxLogs(prev => [{
              action: `${typeLabel.toLowerCase()} #${idx} (${pointsLabel})`,
              wallet: shortAddr, txSentAt: wsEventAt, txConfirmedAt: null, wsEventAt,
            }, ...prev].slice(0, 20))
            setStatus(`${typeLabel} #${idx} (${pointsLabel}) claimed by ${shortAddr} → Score: ${newScore}`)
          }
          fetchBalance()
        })
      } catch (err) {
        console.error('WebSocket connection failed:', err)
        setWsConnected(false)
      }
    }
    setupWs()
    return () => {
      destroyed = true
      if (wsProviderRef.current) { wsProviderRef.current.destroy(); wsProviderRef.current = null }
      setWsConnected(false)
    }
  }, [fetchBalance, address])

  // ─── Raw tx sending ────────────────────────────────────────────────────────

  const sendRawTx = async (action, data, gasLimit = 300000n) => {
    const wallet = getDirectWallet()
    if (!wallet || !cachedParamsRef.current) throw new Error('Wallet or cached params not ready')

    const params = cachedParamsRef.current
    const isClaimAction = action.startsWith('claimBall(')

    if (!isClaimAction) {
      const txSentAt = performance.now()
      const log = { action, wallet: address ?? 'unknown', txSentAt, txConfirmedAt: null, wsEventAt: null }
      pendingTxRef.current = log
    }

    const currentNonce = params.nonce
    params.nonce++

    const signedTx = await wallet.signTransaction({
      to: BALLGAME_ADDRESS, data, nonce: currentNonce, gasLimit,
      maxFeePerGas: params.maxFeePerGas, maxPriorityFeePerGas: params.maxPriorityFeePerGas,
      chainId: CHAIN_ID, type: 2,
    })

    ;(async () => {
      let success = false
      try {
        await rpcProvider.send('eth_sendRawTransaction', [signedTx])
        success = true
      } catch (err) {
        const msg = ((err)?.message || '') + ((err)?.info?.error?.message || '')
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
  }

  const sendMetamaskTx = async (action, callFn) => {
    setStatus('Sign the transaction...')
    const signer = await getSigner()
    const contract = new Contract(BALLGAME_ADDRESS, BALLGAME_ABI, signer)
    const tx = await callFn(contract)
    const txSentAt = performance.now()
    const log = { action, wallet: address ?? 'unknown', txSentAt, txConfirmedAt: null, wsEventAt: null }
    pendingTxRef.current = log
    setStatus('TX submitted, waiting...')
    if (wsProviderRef.current) await wsProviderRef.current.waitForTransaction(tx.hash, 1)
    const txConfirmedAt = performance.now()
    log.txConfirmedAt = txConfirmedAt
    if (!pendingTxRef.current) {
      setTxLogs(prev => {
        const updated = [...prev]
        if (updated[0] && updated[0].action === log.action && updated[0].txConfirmedAt === null) {
          updated[0] = { ...updated[0], txConfirmedAt }
        }
        return updated
      })
    }
    setStatus(`${action} confirmed: ${((txConfirmedAt - txSentAt) / 1000).toFixed(2)}s`)
    await fetchBalance()
  }

  // ─── Wallet actions ────────────────────────────────────────────────────────

  const fundBurner = async (burnerAddress) => {
    if (!ENV_PRIVATE_KEY) { setStatus('Burner created — fund it manually (no funder key in .env)'); return }
    try {
      setStatus('Funding burner wallet...')
      const funder = new Wallet(ENV_PRIVATE_KEY, rpcProvider)
      const [nonce, feeData] = await Promise.all([
        rpcProvider.getTransactionCount(funder.address, 'pending'), rpcProvider.getFeeData(),
      ])
      const signedTx = await funder.signTransaction({
        to: burnerAddress, value: 1000000000000000000n, nonce, gasLimit: 21000n,
        maxFeePerGas: feeData.maxFeePerGas ?? 50000000000n,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 2000000000n,
        chainId: CHAIN_ID, type: 2,
      })
      await rpcProvider.send('eth_sendRawTransaction', [signedTx])
      let attempts = 0
      while (attempts < 20) {
        await new Promise(r => setTimeout(r, 250))
        const bal = await rpcProvider.getBalance(burnerAddress)
        if (bal > 0n) { setBalance(formatEther(bal)); break }
        attempts++
      }
      setStatus('Burner funded with 1 MON!')
    } catch (err) {
      console.error('Failed to fund burner:', err)
      setStatus('Burner created — auto-fund failed, send MON manually')
    }
  }

  const selectBurner = async () => {
    localStorage.setItem(MODE_KEY, 'burner'); setMode('burner'); setMetamaskAddress(null); setBalance(null)
    if (!burnerWallet) {
      const w = createBurnerWallet(); setBurnerWallet(w); setStatus('Burner wallet created'); await fundBurner(w.address)
    } else { setStatus('Burner wallet selected') }
  }

  const selectMetamask = async () => {
    if (!window.ethereum) { setStatus('No wallet found. Install MetaMask.'); return }
    try {
      try {
        await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: MONAD_TESTNET_CHAIN_ID }] })
      } catch (switchErr) {
        if (switchErr.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: MONAD_TESTNET_CHAIN_ID, chainName: 'Monad Testnet',
              nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
              rpcUrls: ['https://testnet-rpc.monad.xyz'],
              blockExplorerUrls: ['https://testnet.monadexplorer.com'],
            }],
          })
        }
      }
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
      localStorage.setItem(MODE_KEY, 'metamask'); setMode('metamask'); setMetamaskAddress(accounts[0]); setBalance(null); setStatus('MetaMask connected')
    } catch (err) {
      setStatus(`MetaMask failed: ${err instanceof Error ? err.message : JSON.stringify(err)}`)
    }
  }

  const generateNewBurner = async () => {
    localStorage.removeItem(STORAGE_KEY)
    const w = createBurnerWallet(); setBurnerWallet(w); setBalance(null); setStatus('New burner wallet generated!')
    await fundBurner(w.address)
  }

  const disconnect = () => {
    localStorage.removeItem(MODE_KEY); setMode('none'); setMetamaskAddress(null); setBalance(null)
    cachedParamsRef.current = null; setStatus('Disconnected')
  }

  // ─── Game actions ──────────────────────────────────────────────────────────

  const callStartGame = async () => {
    setLoading(true)
    try {
      if (mode === 'auto' || mode === 'burner') {
        const data = BALLGAME_IFACE.encodeFunctionData('startGame')
        await sendRawTx('startGame()', data, 1000000n)
      } else {
        await sendMetamaskTx('startGame()', (c) => c.startGame())
      }
    } catch (err) { pendingTxRef.current = null; setStatus(`startGame() failed: ${err}`) }
    finally { setLoading(false) }
  }

  const callClaimBall = useCallback(async (index) => {
    if (claimingRef.current.has(index)) return
    claimingRef.current.add(index)
    const txSentAt = performance.now()
    const log = { action: `claimBall(${index})`, wallet: address ?? 'unknown', txSentAt, txConfirmedAt: null, wsEventAt: null }
    pendingClaimsRef.current.set(index, log)
    try {
      if (mode === 'auto' || mode === 'burner') {
        const data = BALLGAME_IFACE.encodeFunctionData('claimBall', [index])
        await sendRawTx(`claimBall(${index})`, data, 150000n)
      } else {
        await sendMetamaskTx(`claimBall(${index})`, (c) => c.claimBall(index))
      }
    } catch (err) {
      claimingRef.current.delete(index); pendingClaimsRef.current.delete(index)
      pendingTxRef.current = null; setStatus(`claimBall(${index}) failed: ${err}`)
    }
  }, [address, mode])

  const hasBalance = balance !== null && parseFloat(balance) > 0

  // ─── Canvas RAF loop ───────────────────────────────────────────────────────

  // Build coin objects from on-chain balls (keyed by index to avoid duplicates)
  const coinMapRef = useRef(new Map())

  useEffect(() => {
    if (!iconCacheRef.current) iconCacheRef.current = preloadIcons()
  }, [])

  // Sync on-chain balls → canvas coins
  useEffect(() => {
    const map = coinMapRef.current
    // Remove coins for balls that are now claimed
    for (const [idx, coin] of map.entries()) {
      if (balls[idx]?.claimed) {
        map.delete(idx)
      }
    }
    // Add coins for unclaimed balls that don't have a coin yet
    for (let i = 0; i < balls.length; i++) {
      if (!balls[i].claimed && !map.has(i)) {
        map.set(i, makeCoinFromBall(balls[i], i))
      }
    }
  }, [balls])

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    function resize() {
      canvas.width = container.clientWidth
      canvas.height = container.clientHeight
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)

    let rafId
    let lastTs = 0

    function loop(ts) {
      const cv = canvasRef.current
      if (!cv) return
      const ctx = cv.getContext('2d')
      const w = cv.width
      const h = cv.height
      const dt = Math.min(ts - lastTs, 50)
      lastTs = ts
      const now = performance.now()
      const icons = iconCacheRef.current || {}

      // ── Update coin positions based on on-chain ball animation ──────────
      const t = (Date.now() / 1000 + clockOffset) - gameStartTime
      const coinMap = coinMapRef.current

      for (const [idx, coin] of coinMap.entries()) {
        const ball = balls[idx]
        if (!ball || ball.claimed) continue

        // Bouncing animation from BallGame.tsx
        const cycleDuration = 3.0 + (idx % 4) * 0.5
        const launchDelay = (idx % 5) * 0.4
        const elapsed = t - launchDelay

        let targetX, targetY
        if (elapsed < 0) {
          targetX = ball.x
          targetY = 110
        } else {
          const phase = (elapsed % cycleDuration) / cycleDuration
          const peakHeight = 75 + (idx % 3) * 15
          const baseY = 110
          targetY = baseY - peakHeight * 4 * phase * (1 - phase)
          targetX = ball.x + Math.sin(elapsed * 0.6 + idx * 2.0) * 2.5
        }

        // Convert percentage to pixel
        coin.x = (targetX / 100) * w
        coin.y = (targetY / 100) * h
        coin.rotation += coin.rotationSpeed * (dt / 1000)
      }

      // Particles update
      for (const p of particlesRef.current) {
        p.life -= p.decay * dt
        if (!p.isRing) {
          p.vx *= Math.pow(0.92, dt / 16)
          p.vy += 300 * (dt / 1000)
          p.x += p.vx * (dt / 1000)
          p.y += p.vy * (dt / 1000)
        }
      }
      particlesRef.current = particlesRef.current.filter(p => p.life > 0)

      // ── Render ─────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, w, h)

      // Dark background matching the game theme
      ctx.fillStyle = '#1a1a2e'
      ctx.fillRect(0, 0, w, h)

      // Subtle grid
      ctx.strokeStyle = 'rgba(100, 80, 200, 0.05)'
      ctx.lineWidth = 1
      for (let x = 0; x < w; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
      for (let y = 0; y < h; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }

      // Coins
      for (const [, coin] of coinMap) {
        renderCoin(ctx, coin, icons)
      }

      // Particles + shockwave rings
      for (const p of particlesRef.current) {
        ctx.save()
        ctx.globalAlpha = p.life
        if (p.isRing) {
          const r = p.maxRadius * (1 - p.life)
          ctx.strokeStyle = p.color; ctx.lineWidth = 2.5
          ctx.shadowColor = p.color; ctx.shadowBlur = 8
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke()
        } else {
          ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 8
          ctx.beginPath(); ctx.arc(p.x, p.y, p.radius * p.life, 0, Math.PI * 2); ctx.fill()
        }
        ctx.restore()
      }

      // Score popups
      popupsRef.current = popupsRef.current.filter(p => now - p.t < 700)
      for (const p of popupsRef.current) {
        const age = (now - p.t) / 700
        ctx.save()
        ctx.globalAlpha = 1 - age
        ctx.fillStyle = p.isGood ? '#A78BFA' : '#FF5555'
        ctx.font = 'bold 22px monospace'
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(p.text, p.x, p.y - age * 60)
        ctx.restore()
      }

      // Timer — top right corner
      if (gameActive && gameStartTime > 0) {
        const chainElapsed = ((Date.now() / 1000 + clockOffset) - gameStartTime) * 1000
        const remaining = Math.max(0, 30000 - chainElapsed) // 30s game duration on chain
        renderTimer(ctx, remaining, 30000, w - 50, 50)
      }

      // Bad flash
      const flashAge = now - badFlashRef.current
      if (flashAge < 400) {
        ctx.fillStyle = `rgba(255,30,30,${(1 - flashAge / 400) * 0.32})`
        ctx.fillRect(0, 0, w, h)
      }

      rafId = requestAnimationFrame(loop)
    }

    rafId = requestAnimationFrame(loop)

    // ── Click handling: claim ball on canvas click ──────────────────────
    function onPointerDown(e) {
      if (!gameActive || !isConnected || !hasBalance) return
      const rect = canvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const now = performance.now()

      const coinMap = coinMapRef.current
      for (const [idx, coin] of coinMap) {
        if (Math.hypot(px - coin.x, py - coin.y) < coin.radius) {
          // Visual feedback
          const isGood = coin.isGood
          spawnBurst(particlesRef.current, coin.x, coin.y, isGood)
          const points = coin.ballType === 1 ? '+3' : coin.ballType === 2 ? '-5' : '+1'
          popupsRef.current.push({ x: coin.x, y: coin.y, text: points, t: now, isGood })
          if (!isGood) badFlashRef.current = now

          // Remove from canvas immediately
          coinMap.delete(idx)

          // Send on-chain claim
          callClaimBall(idx)
          break
        }
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    return () => {
      cancelAnimationFrame(rafId)
      canvas.removeEventListener('pointerdown', onPointerDown)
      ro.disconnect()
    }
  }, [gameActive, gameStartTime, balls, isConnected, hasBalance, callClaimBall])

  // ─── UI ────────────────────────────────────────────────────────────────────
  const shortAddr = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ''

  return (
    <div ref={containerRef} className="relative w-screen h-screen bg-[#1a1a2e] overflow-hidden select-none">
      {/* Character video — center, 80% height */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
        <video
          src="/character.mp4"
          autoPlay
          loop
          muted
          playsInline
          style={{ height: '80%', objectFit: 'contain', opacity: 0.5 }}
        />
      </div>

      {/* Canvas overlay */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 z-[1]"
        style={{ touchAction: 'none', cursor: 'crosshair' }}
      />

      {/* HUD */}
      <div className="absolute top-4 left-4 right-4 flex items-start justify-between pointer-events-none z-10">
        {/* Left: Score + connection info */}
        <div className="flex flex-col gap-2">
          <div className="bg-black/60 border border-white/10 rounded-2xl px-5 py-4 backdrop-blur-md min-w-[160px]">
            <div className="text-[10px] font-semibold tracking-[0.18em] uppercase text-gray-400 mb-1">Score</div>
            <div className="text-yellow-400 text-4xl font-bold font-mono tabular-nums leading-none">{myScore}</div>
            <div className="text-xs text-gray-400 font-mono mt-2">
              {wsConnected ? <span className="text-green-400">● Live</span> : <span className="text-red-400">● Offline</span>}
              {gameId > 0 && <span className="ml-2">Game #{gameId}</span>}
            </div>
          </div>
        </div>

        {/* Right: Timer is rendered on canvas, but wallet info here */}
        <div className="flex flex-col items-end gap-2">
          {isConnected && (
            <div className="bg-black/60 border border-white/10 rounded-2xl px-4 py-3 backdrop-blur-md text-right">
              <div className="text-[10px] font-semibold tracking-[0.18em] uppercase text-gray-400 mb-1">
                {mode === 'auto' ? 'Private Key' : mode === 'burner' ? 'Burner' : 'MetaMask'}
              </div>
              <div className="text-xs text-white/80 font-mono">{shortAddr}</div>
              <div className="text-xs text-green-400 font-mono mt-1">{balance ? `${parseFloat(balance).toFixed(4)} MON` : '...'}</div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar: buttons */}
      <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between z-10">
        {/* Left: Leaderboard + Speed Log buttons */}
        <div className="flex gap-2 pointer-events-auto">
          <button
            onClick={() => setShowLeaderboard(!showLeaderboard)}
            className="bg-black/60 hover:bg-black/80 border border-white/10 text-white text-xs font-semibold px-4 py-2 rounded-xl backdrop-blur-md transition-all"
          >
            Leaderboard
          </button>
          <button
            onClick={() => setShowSpeedLog(!showSpeedLog)}
            className="bg-black/60 hover:bg-black/80 border border-white/10 text-white text-xs font-semibold px-4 py-2 rounded-xl backdrop-blur-md transition-all"
          >
            Speed Log
          </button>
        </div>

        {/* Right: Game controls */}
        <div className="flex gap-2 pointer-events-auto">
          {mode === 'none' ? (
            <>
              {ENV_PRIVATE_KEY && (
                <button
                  onClick={() => { localStorage.setItem(MODE_KEY, 'auto'); setMode('auto'); setStatus('Private key wallet connected') }}
                  className="bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all"
                >
                  Private Key
                </button>
              )}
              <button onClick={selectBurner} className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all">
                Burner
              </button>
              <button onClick={selectMetamask} className="bg-orange-600 hover:bg-orange-500 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all">
                MetaMask
              </button>
            </>
          ) : (
            <>
              {!gameActive && (
                <button
                  onClick={callStartGame}
                  disabled={loading || !isConnected || !hasBalance}
                  className="bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed text-black text-sm font-bold px-6 py-2.5 rounded-xl transition-all shadow-lg shadow-yellow-400/30"
                >
                  {loading ? 'Starting...' : 'Start Game'}
                </button>
              )}
              {gameActive && (
                <div className="bg-green-500/20 border border-green-400/30 text-green-400 text-xs font-semibold px-4 py-2 rounded-xl">
                  Game Active
                </div>
              )}
              {mode === 'burner' && (
                <button onClick={generateNewBurner} className="bg-black/60 hover:bg-black/80 border border-white/10 text-white text-xs px-3 py-2 rounded-xl transition-all">
                  New Wallet
                </button>
              )}
              <button onClick={disconnect} className="bg-red-600/80 hover:bg-red-500 text-white text-xs px-3 py-2 rounded-xl transition-all">
                Disconnect
              </button>
            </>
          )}
        </div>
      </div>

      {/* Status bar */}
      {status && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 bg-black/70 border border-white/10 rounded-xl px-4 py-2 backdrop-blur-md">
          <span className="text-xs text-gray-300 font-mono">{status}</span>
        </div>
      )}

      {/* Leaderboard overlay */}
      {showLeaderboard && (
        <div className="absolute top-20 left-4 z-20 bg-black/80 border border-white/10 rounded-2xl p-4 backdrop-blur-md w-80 max-h-[60vh] overflow-y-auto pointer-events-auto">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-white text-sm font-bold">Leaderboard</h3>
            <button onClick={() => setShowLeaderboard(false)} className="text-gray-400 hover:text-white text-lg leading-none">&times;</button>
          </div>
          {leaderboard.length === 0 ? (
            <p className="text-gray-500 text-xs">No players yet</p>
          ) : (
            <div className="text-xs font-mono space-y-1">
              {leaderboard.map((entry, i) => {
                const short = `${entry.address.slice(0, 6)}...${entry.address.slice(-4)}`
                const isMe = address && entry.address.toLowerCase() === address.toLowerCase()
                return (
                  <div key={entry.address} className={`flex justify-between py-1.5 px-2 rounded-lg ${isMe ? 'bg-yellow-500/10' : ''}`}>
                    <span className={`${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-orange-400' : 'text-gray-500'}`}>
                      #{i + 1}
                    </span>
                    <span className={isMe ? 'text-yellow-400' : 'text-white/80'}>
                      {short} {isMe ? '(you)' : ''}
                    </span>
                    <span className="text-green-400 font-bold">{entry.score} pts</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Speed Log overlay */}
      {showSpeedLog && (
        <div className="absolute top-20 left-4 z-20 bg-black/80 border border-white/10 rounded-2xl p-4 backdrop-blur-md w-[420px] max-h-[60vh] overflow-y-auto pointer-events-auto">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-white text-sm font-bold">Speed Log</h3>
            <button onClick={() => setShowSpeedLog(false)} className="text-gray-400 hover:text-white text-lg leading-none">&times;</button>
          </div>
          {txLogs.length === 0 ? (
            <p className="text-gray-500 text-xs">No transactions yet</p>
          ) : (
            <div className="text-[11px] font-mono space-y-0.5">
              <div className="grid grid-cols-4 gap-1 text-gray-500 pb-1 border-b border-white/10 mb-1">
                <span>Action</span><span>Player</span><span>RPC</span><span>WS</span>
              </div>
              {txLogs.map((log, i) => {
                const confirmMs = log.txConfirmedAt ? ((log.txConfirmedAt - log.txSentAt) / 1000).toFixed(3) : '\u2014'
                const wsMs = log.wsEventAt ? ((log.wsEventAt - log.txSentAt) / 1000).toFixed(3) : '\u2014'
                const shortW = log.wallet.length > 10 ? `${log.wallet.slice(0, 6)}...${log.wallet.slice(-4)}` : log.wallet
                return (
                  <div key={i} className="grid grid-cols-4 gap-1 py-1 border-b border-white/5">
                    <span className="text-purple-300 truncate">{log.action}</span>
                    <span className="text-white/70 truncate">{shortW}</span>
                    <span className="text-green-400">{confirmMs}s</span>
                    <span className="text-blue-400">{wsMs}s</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Wallet not connected overlay */}
      {mode === 'none' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-black/60 backdrop-blur-sm">
          <h1 className="text-5xl font-bold font-mono mb-4 text-center leading-tight">
            <span className="text-yellow-400">Monad</span>{' '}
            <span className="text-purple-400">Ball Game</span>
          </h1>
          <p className="text-gray-400 text-sm text-center max-w-xs mb-8">
            Connect a wallet to start claiming on-chain balls!
          </p>
          <div className="flex gap-3">
            {ENV_PRIVATE_KEY && (
              <button
                onClick={() => { localStorage.setItem(MODE_KEY, 'auto'); setMode('auto'); setStatus('Private key wallet connected') }}
                className="bg-purple-600 hover:bg-purple-500 text-white font-bold px-6 py-3 rounded-xl transition-all"
              >
                Private Key
              </button>
            )}
            <button onClick={selectBurner} className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-6 py-3 rounded-xl transition-all">
              Burner Wallet
            </button>
            <button onClick={selectMetamask} className="bg-orange-600 hover:bg-orange-500 text-white font-bold px-6 py-3 rounded-xl transition-all">
              MetaMask
            </button>
          </div>
        </div>
      )}

      {/* No balance warning */}
      {isConnected && !hasBalance && mode !== 'none' && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 bg-black/80 border border-red-500/30 rounded-2xl p-6 backdrop-blur-md text-center max-w-sm">
          <p className="text-red-400 text-sm font-semibold mb-2">No MON Balance</p>
          <p className="text-gray-400 text-xs mb-3">Send testnet MON to your address to start playing:</p>
          <p className="text-white/80 text-xs font-mono break-all bg-black/40 rounded-lg p-2">{address}</p>
        </div>
      )}
    </div>
  )
}
