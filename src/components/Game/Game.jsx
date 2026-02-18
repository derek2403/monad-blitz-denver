import { useEffect, useRef, useState, useCallback } from 'react'
import {
  COIN_CONFIG, GOOD_TYPES, BAD_TYPES,
  COIN_RADIUS,
} from './constants'
import {
  JsonRpcProvider, Contract, Interface, WebSocketProvider, formatEther,
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
const MONAD_RPC_URL = 'https://monad-testnet.g.alchemy.com/v2/p3LF9TmoLQFqlPs6DcFxH'
const MONAD_WS_URL = 'wss://monad-testnet.g.alchemy.com/v2/p3LF9TmoLQFqlPs6DcFxH'

const BALL_TYPE_POINTS = { 0: '+1', 1: '+3', 2: '-5' }

const rpcProvider = new JsonRpcProvider(MONAD_RPC_URL)
const readContract = new Contract(BALLGAME_ADDRESS, BALLGAME_ABI, rpcProvider)

let clockOffset = 0
async function calibrateClock() {
  try {
    const block = await rpcProvider.getBlock('latest')
    if (block) clockOffset = block.timestamp - Math.floor(Date.now() / 1000)
  } catch { /* ignore */ }
}
calibrateClock()

// ─── Icon helpers ──────────────────────────────────────────────────────────────

const ICON_MAP = {
  bitcoin: '/icons/btc.png', ethereum: '/icons/eth.png', monad: '/icons/monad.png',
  pizzadao: '/icons/pizzadao.png', ftx: '/icons/ftx.png', terra: '/icons/terra.png',
}

function preloadIcons() {
  const cache = {}
  for (const [key, src] of Object.entries(ICON_MAP)) {
    const img = new Image(); img.src = src; cache[key] = img
  }
  return cache
}

// ─── Particles ─────────────────────────────────────────────────────────────────

const BURST_COLORS_GOOD = ['#FFD700', '#A78BFA', '#60EFFF', '#FFFFFF']
const BURST_COLORS_BAD  = ['#FF4444', '#FF8800', '#FFDD00', '#FF2222']

function spawnBurst(particles, x, y, isGood) {
  const colors = isGood ? BURST_COLORS_GOOD : BURST_COLORS_BAD
  const count  = isGood ? 12 : 10
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4
    const speed = 120 + Math.random() * 220
    particles.push({
      x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 60,
      life: 1.0, decay: 0.0018 + Math.random() * 0.001,
      color: colors[Math.floor(Math.random() * colors.length)], radius: 3 + Math.random() * 4,
    })
  }
  particles.push({
    x, y, vx: 0, vy: 0, life: 1.0, decay: 0.004,
    color: isGood ? '#A78BFA' : '#FF4444', radius: 0, isRing: true, maxRadius: COIN_RADIUS * 2.2,
  })
}

// ─── Coin helpers ──────────────────────────────────────────────────────────────

let _coinId = 0

function makeCoinFromBall(ball, index) {
  const isBad = ball.ballType === 2
  const pool = isBad ? BAD_TYPES : (ball.ballType === 1 ? ['monad'] : GOOD_TYPES)
  const type = pool[Math.floor(Math.random() * pool.length)]
  return {
    id: _coinId++, type, index,
    x: 0, y: 0, vx: 0, vy: 0,
    rotation: Math.random() * Math.PI * 2, rotationSpeed: (Math.random() - 0.5) * 6,
    radius: COIN_RADIUS, isGood: !isBad, ballType: ball.ballType,
    claimed: false, pctX: ball.x, pctY: ball.y,
  }
}

function renderCoin(ctx, coin, iconCache) {
  const cfg = COIN_CONFIG[coin.type]
  const icon = iconCache[coin.type]
  ctx.save()
  ctx.translate(coin.x, coin.y)
  ctx.rotate(coin.rotation)
  ctx.shadowColor = cfg.glow
  ctx.shadowBlur = 20
  if (icon && icon.complete && icon.naturalWidth > 0) {
    const size = coin.radius * 2
    ctx.beginPath(); ctx.arc(0, 0, coin.radius, 0, Math.PI * 2); ctx.closePath(); ctx.clip()
    ctx.drawImage(icon, -size / 2, -size / 2, size, size)
    ctx.shadowBlur = 0
    ctx.strokeStyle = cfg.glow; ctx.lineWidth = 2.5
    ctx.beginPath(); ctx.arc(0, 0, coin.radius, 0, Math.PI * 2); ctx.stroke()
  } else {
    ctx.beginPath(); ctx.arc(0, 0, coin.radius, 0, Math.PI * 2)
    ctx.fillStyle = cfg.bg; ctx.fill()
    ctx.strokeStyle = cfg.glow; ctx.lineWidth = 2; ctx.stroke()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#fff'
    ctx.font = `bold ${Math.round(coin.radius * 0.82)}px monospace`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(cfg.symbol, 0, 0)
  }
  if (!coin.isGood) {
    ctx.strokeStyle = '#FF4444'; ctx.lineWidth = 2.5; ctx.shadowBlur = 0
    const hw = coin.radius * 0.48
    ctx.beginPath(); ctx.moveTo(-hw, -coin.radius + 9); ctx.lineTo(hw, -coin.radius + 9); ctx.stroke()
  }
  ctx.restore()
}

function renderTimer(ctx, remaining, total, x, y) {
  const seconds = Math.ceil(remaining / 1000)
  const progress = remaining / total
  const r = 28
  const isLow = remaining < 3000
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 5
  ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, Math.PI * 1.5); ctx.stroke()
  const color = isLow ? '#FF4444' : '#A78BFA'
  ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.shadowColor = color; ctx.shadowBlur = isLow ? 14 : 6
  ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2); ctx.stroke()
  ctx.shadowBlur = 0
  ctx.fillStyle = isLow ? '#FF4444' : '#fff'
  ctx.font = 'bold 20px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(seconds, x, y)
  ctx.restore()
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function Game({ wallet, onGameEnd }) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const iconCacheRef = useRef(null)
  const particlesRef = useRef([])
  const popupsRef = useRef([])
  const badFlashRef = useRef(0)

  const address = wallet.address

  const [gameId, setGameId] = useState(0)
  const [gameStartTime, setGameStartTime] = useState(0)
  const [balls, setBalls] = useState([])
  const [gameActive, setGameActive] = useState(false)
  const [status, setStatus] = useState('')
  const [wsConnected, setWsConnected] = useState(false)
  const [balance, setBalance] = useState(null)
  const [txLogs, setTxLogs] = useState([])
  const [leaderboard, setLeaderboard] = useState([])
  const [myScore, setMyScore] = useState(0)
  const [showSpeedLog, setShowSpeedLog] = useState(false)

  const wsProviderRef = useRef(null)
  const pendingTxRef = useRef(null)
  const pendingClaimsRef = useRef(new Map())
  const cachedParamsRef = useRef(null)
  const knownPlayersRef = useRef(new Set())
  const claimingRef = useRef(new Set())
  const gameEndedRef = useRef(false)

  const refreshCachedParams = useCallback(async () => {
    try {
      const [nonce, feeData] = await Promise.all([
        rpcProvider.getTransactionCount(wallet.address, 'pending'), rpcProvider.getFeeData(),
      ])
      cachedParamsRef.current = {
        nonce, maxFeePerGas: feeData.maxFeePerGas ?? 50000000000n,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 2000000000n,
      }
    } catch (err) { console.error('Failed to cache tx params:', err); cachedParamsRef.current = null }
  }, [wallet])

  useEffect(() => { refreshCachedParams() }, [refreshCachedParams])

  const fetchBalance = useCallback(async () => {
    try { const bal = await rpcProvider.getBalance(address); setBalance(formatEther(bal)) } catch { /* ignore */ }
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

  const fetchMyScore = useCallback(async () => {
    try { const s = await readContract.getScore(address); setMyScore(Number(s)) } catch { /* ignore */ }
  }, [address])

  const fetchGameState = useCallback(async () => {
    try {
      const id = await readContract.currentGameId()
      const gameIdNum = Number(id)
      setGameId(gameIdNum)
      if (gameIdNum === 0) { setBalls([]); setGameActive(false); return }
      const [positions, ballTypes, claims, startTime] = await Promise.all([
        readContract.getGamePositions(gameIdNum), readContract.getGameBallTypes(gameIdNum),
        readContract.getGameClaims(gameIdNum), readContract.getGameStartTime(gameIdNum),
      ])
      setGameStartTime(Number(startTime))
      const [xs, ys] = positions; const [claimedBy, claimedCount] = claims
      const newBalls = []
      for (let i = 0; i < BALL_COUNT; i++) {
        const addr = claimedBy[i]
        const isClaimed = addr !== '0x0000000000000000000000000000000000000000'
        if (isClaimed) knownPlayersRef.current.add(addr)
        newBalls.push({ x: Number(xs[i]) / 10, y: Number(ys[i]) / 10, ballType: Number(ballTypes[i]), claimed: isClaimed, claimedBy: isClaimed ? addr : null })
      }
      setBalls(newBalls)
      const active = Number(claimedCount) < BALL_COUNT
      setGameActive(active)
      if (!active && !gameEndedRef.current) gameEndedRef.current = true
    } catch (err) { console.error('Failed to fetch game state:', err) }
  }, [])

  useEffect(() => { fetchGameState() }, [fetchGameState])
  useEffect(() => { fetchBalance() }, [fetchBalance])
  useEffect(() => { knownPlayersRef.current.add(address); fetchMyScore() }, [address, fetchMyScore])
  useEffect(() => { const id = setInterval(fetchGameState, 3000); return () => clearInterval(id) }, [fetchGameState])
  useEffect(() => { refreshLeaderboard(); const id = setInterval(refreshLeaderboard, 5000); return () => clearInterval(id) }, [refreshLeaderboard])

  // Detect game end → transition
  useEffect(() => {
    if (!gameActive && gameEndedRef.current && leaderboard.length > 0) {
      const timer = setTimeout(() => onGameEnd(leaderboard, myScore, txLogs), 3000)
      return () => clearTimeout(timer)
    }
  }, [gameActive, leaderboard, myScore, txLogs, onGameEnd])

  // WebSocket
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
          const wsEventAt = performance.now(); const newGameId = Number(gameIdBn)
          calibrateClock(); claimingRef.current.clear(); pendingClaimsRef.current.clear()
          setGameId(newGameId); setGameStartTime(Number(startTimeBn)); setGameActive(true); gameEndedRef.current = false
          const newBalls = []
          for (let i = 0; i < BALL_COUNT; i++) newBalls.push({ x: Number(xs[i]) / 10, y: Number(ys[i]) / 10, ballType: Number(ballTypes[i]), claimed: false, claimedBy: null })
          setBalls(newBalls)
          if (pendingTxRef.current) {
            const pending = pendingTxRef.current; pendingTxRef.current = null
            setTxLogs(prev => [{ ...pending, wsEventAt }, ...prev].slice(0, 20))
            setStatus(`Game #${newGameId} started: ${((wsEventAt - pending.txSentAt) / 1000).toFixed(3)}s`)
          } else setStatus(`Game #${newGameId} started`)
          fetchBalance()
        })

        contract.on('BallClaimed', (gameIdBn, indexBn, player, ballTypeBn, newScoreBn) => {
          const wsEventAt = performance.now(); const idx = Number(indexBn); const ballType = Number(ballTypeBn); const newScore = Number(newScoreBn)
          const typeLabel = ballType === 1 ? 'Special' : ballType === 2 ? 'Bomb' : 'Normal'
          const pointsLabel = BALL_TYPE_POINTS[ballType]
          knownPlayersRef.current.add(player)
          setBalls(prev => {
            const updated = [...prev]
            if (updated[idx]) updated[idx] = { ...updated[idx], claimed: true, claimedBy: player }
            if (updated.every(b => b.claimed)) { setGameActive(false); gameEndedRef.current = true }
            return updated
          })
          setLeaderboard(prev => {
            const existing = prev.find(e => e.address.toLowerCase() === player.toLowerCase())
            let updated = existing ? prev.map(e => e.address.toLowerCase() === player.toLowerCase() ? { ...e, score: newScore } : e) : [...prev, { address: player, score: newScore }]
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
            setTxLogs(prev => [{ action: `${typeLabel.toLowerCase()} #${idx} (${pointsLabel})`, wallet: shortAddr, txSentAt: wsEventAt, txConfirmedAt: null, wsEventAt }, ...prev].slice(0, 20))
            setStatus(`${typeLabel} #${idx} (${pointsLabel}) by ${shortAddr} → Score: ${newScore}`)
          }
          fetchBalance()
        })
      } catch (err) { console.error('WS failed:', err); setWsConnected(false) }
    }
    setupWs()
    return () => { destroyed = true; wsProviderRef.current?.destroy(); wsProviderRef.current = null; setWsConnected(false) }
  }, [fetchBalance, address])

  // ─── Raw tx ────────────────────────────────────────────────────────────────

  const sendRawTx = async (action, data, gasLimit = 300000n) => {
    if (!cachedParamsRef.current) throw new Error('Cached params not ready')
    const params = cachedParamsRef.current
    const isClaimAction = action.startsWith('claimBall(')
    if (!isClaimAction) pendingTxRef.current = { action, wallet: address, txSentAt: performance.now(), txConfirmedAt: null, wsEventAt: null }
    const currentNonce = params.nonce; params.nonce++
    const signedTx = await wallet.signTransaction({ to: BALLGAME_ADDRESS, data, nonce: currentNonce, gasLimit, maxFeePerGas: params.maxFeePerGas, maxPriorityFeePerGas: params.maxPriorityFeePerGas, chainId: CHAIN_ID, type: 2 })
    ;(async () => {
      let success = false
      try { await rpcProvider.send('eth_sendRawTransaction', [signedTx]); success = true }
      catch (err) {
        const msg = ((err)?.message || '') + ((err)?.info?.error?.message || '')
        if (msg.toLowerCase().includes('nonce')) {
          try {
            await refreshCachedParams()
            if (cachedParamsRef.current) {
              const fn = cachedParamsRef.current.nonce; cachedParamsRef.current.nonce++
              const retry = await wallet.signTransaction({ to: BALLGAME_ADDRESS, data, nonce: fn, gasLimit, maxFeePerGas: cachedParamsRef.current.maxFeePerGas, maxPriorityFeePerGas: cachedParamsRef.current.maxPriorityFeePerGas, chainId: CHAIN_ID, type: 2 })
              await rpcProvider.send('eth_sendRawTransaction', [retry]); success = true
            }
          } catch { /* retry failed */ }
        }
        if (!success) {
          if (isClaimAction) { const m = action.match(/claimBall\((\d+)\)/); const idx = m ? Number(m[1]) : -1; pendingClaimsRef.current.delete(idx); claimingRef.current.delete(idx) }
          else pendingTxRef.current = null
          setStatus(`${action} failed: ${msg || err}`); refreshCachedParams(); return
        }
      }
      const txConfirmedAt = performance.now()
      if (isClaimAction) {
        const m = action.match(/claimBall\((\d+)\)/); const idx = m ? Number(m[1]) : -1
        const p = pendingClaimsRef.current.get(idx); if (p) p.txConfirmedAt = txConfirmedAt
        setTxLogs(prev => { const e = prev.find(l => l.action === action && !l.txConfirmedAt); return e ? prev.map(l => l === e ? { ...l, txConfirmedAt } : l) : prev })
        if (p?.wsEventAt) pendingClaimsRef.current.delete(idx)
      } else if (pendingTxRef.current) pendingTxRef.current.txConfirmedAt = txConfirmedAt
    })()
  }

  const callClaimBall = useCallback(async (index) => {
    if (claimingRef.current.has(index)) return
    claimingRef.current.add(index)
    pendingClaimsRef.current.set(index, { action: `claimBall(${index})`, wallet: address, txSentAt: performance.now(), txConfirmedAt: null, wsEventAt: null })
    try {
      const data = BALLGAME_IFACE.encodeFunctionData('claimBall', [index])
      await sendRawTx(`claimBall(${index})`, data, 150000n)
    } catch (err) { claimingRef.current.delete(index); pendingClaimsRef.current.delete(index); setStatus(`claimBall(${index}) failed: ${err}`) }
  }, [address, wallet])

  // ─── Canvas ────────────────────────────────────────────────────────────────

  const coinMapRef = useRef(new Map())
  useEffect(() => { if (!iconCacheRef.current) iconCacheRef.current = preloadIcons() }, [])

  useEffect(() => {
    const map = coinMapRef.current
    for (const [idx] of map.entries()) { if (balls[idx]?.claimed) map.delete(idx) }
    for (let i = 0; i < balls.length; i++) { if (!balls[i].claimed && !map.has(i)) map.set(i, makeCoinFromBall(balls[i], i)) }
  }, [balls])

  useEffect(() => {
    const canvas = canvasRef.current; const container = containerRef.current
    if (!canvas || !container) return
    function resize() { canvas.width = container.clientWidth; canvas.height = container.clientHeight }
    resize(); const ro = new ResizeObserver(resize); ro.observe(container)

    let rafId, lastTs = 0
    function loop(ts) {
      const cv = canvasRef.current; if (!cv) return
      const ctx = cv.getContext('2d'); const w = cv.width; const h = cv.height
      const dt = Math.min(ts - lastTs, 50); lastTs = ts; const now = performance.now()
      const icons = iconCacheRef.current || {}; const t = (Date.now() / 1000 + clockOffset) - gameStartTime
      const coinMap = coinMapRef.current

      for (const [idx, coin] of coinMap.entries()) {
        const ball = balls[idx]; if (!ball || ball.claimed) continue
        const cycleDuration = 3.0 + (idx % 4) * 0.5; const launchDelay = (idx % 5) * 0.4; const elapsed = t - launchDelay
        let targetX, targetY
        if (elapsed < 0) { targetX = ball.x; targetY = 110 }
        else { const phase = (elapsed % cycleDuration) / cycleDuration; targetY = 110 - (75 + (idx % 3) * 15) * 4 * phase * (1 - phase); targetX = ball.x + Math.sin(elapsed * 0.6 + idx * 2.0) * 2.5 }
        coin.x = (targetX / 100) * w; coin.y = (targetY / 100) * h; coin.rotation += coin.rotationSpeed * (dt / 1000)
      }

      for (const p of particlesRef.current) { p.life -= p.decay * dt; if (!p.isRing) { p.vx *= Math.pow(0.92, dt / 16); p.vy += 300 * (dt / 1000); p.x += p.vx * (dt / 1000); p.y += p.vy * (dt / 1000) } }
      particlesRef.current = particlesRef.current.filter(p => p.life > 0)

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = 'rgba(26, 26, 46, 0.3)'; ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = 'rgba(100, 80, 200, 0.05)'; ctx.lineWidth = 1
      for (let x = 0; x < w; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
      for (let y = 0; y < h; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }

      for (const [, coin] of coinMap) renderCoin(ctx, coin, icons)

      for (const p of particlesRef.current) {
        ctx.save(); ctx.globalAlpha = p.life
        if (p.isRing) { const r = p.maxRadius * (1 - p.life); ctx.strokeStyle = p.color; ctx.lineWidth = 2.5; ctx.shadowColor = p.color; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke() }
        else { ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(p.x, p.y, p.radius * p.life, 0, Math.PI * 2); ctx.fill() }
        ctx.restore()
      }

      popupsRef.current = popupsRef.current.filter(p => now - p.t < 700)
      for (const p of popupsRef.current) { const age = (now - p.t) / 700; ctx.save(); ctx.globalAlpha = 1 - age; ctx.fillStyle = p.isGood ? '#A78BFA' : '#FF5555'; ctx.font = 'bold 22px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.text, p.x, p.y - age * 60); ctx.restore() }

      if (gameActive && gameStartTime > 0) {
        const chainElapsed = ((Date.now() / 1000 + clockOffset) - gameStartTime) * 1000
        renderTimer(ctx, Math.max(0, 30000 - chainElapsed), 30000, w - 50, 50)
      }

      const flashAge = now - badFlashRef.current
      if (flashAge < 400) { ctx.fillStyle = `rgba(255,30,30,${(1 - flashAge / 400) * 0.32})`; ctx.fillRect(0, 0, w, h) }
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)

    function onPointerDown(e) {
      if (!gameActive) return
      const rect = canvas.getBoundingClientRect(); const px = e.clientX - rect.left; const py = e.clientY - rect.top; const now = performance.now()
      for (const [idx, coin] of coinMapRef.current) {
        if (Math.hypot(px - coin.x, py - coin.y) < coin.radius) {
          spawnBurst(particlesRef.current, coin.x, coin.y, coin.isGood)
          popupsRef.current.push({ x: coin.x, y: coin.y, text: coin.ballType === 1 ? '+3' : coin.ballType === 2 ? '-5' : '+1', t: now, isGood: coin.isGood })
          if (!coin.isGood) badFlashRef.current = now
          coinMapRef.current.delete(idx); callClaimBall(idx); break
        }
      }
    }
    canvas.addEventListener('pointerdown', onPointerDown)
    return () => { cancelAnimationFrame(rafId); canvas.removeEventListener('pointerdown', onPointerDown); ro.disconnect() }
  }, [gameActive, gameStartTime, balls, callClaimBall])

  const shortAddr = `${address.slice(0, 6)}...${address.slice(-4)}`

  return (
    <div ref={containerRef} className="relative w-screen h-screen bg-[#1a1a2e] overflow-hidden select-none">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
        <video src="/character.mp4" autoPlay loop muted playsInline style={{ height: '80%', objectFit: 'contain', opacity: 0.4 }} />
      </div>
      <canvas ref={canvasRef} className="absolute inset-0 z-[1]" style={{ touchAction: 'none', cursor: 'crosshair' }} />

      {/* HUD */}
      <div className="absolute top-4 left-4 right-4 flex items-start justify-between pointer-events-none z-10">
        <div className="bg-black/60 border border-white/10 rounded-2xl px-5 py-4 backdrop-blur-md min-w-[160px]">
          <div className="text-[10px] font-semibold tracking-[0.18em] uppercase text-gray-400 mb-1">Score</div>
          <div className="text-yellow-400 text-4xl font-bold font-mono tabular-nums leading-none">{myScore}</div>
          <div className="text-xs text-gray-400 font-mono mt-2">
            {wsConnected ? <span className="text-green-400">● Live</span> : <span className="text-red-400">● Offline</span>}
            {gameId > 0 && <span className="ml-2">Game #{gameId}</span>}
          </div>
        </div>
        <div className="bg-black/60 border border-white/10 rounded-2xl px-4 py-3 backdrop-blur-md text-right">
          <div className="text-[10px] font-semibold tracking-[0.18em] uppercase text-gray-400 mb-1">Burner</div>
          <div className="text-xs text-white/80 font-mono">{shortAddr}</div>
          <div className="text-xs text-green-400 font-mono mt-1">{balance ? `${parseFloat(balance).toFixed(4)} MON` : '...'}</div>
        </div>
      </div>

      <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between z-10">
        <div className="flex gap-2 pointer-events-auto">
          <button onClick={() => setShowSpeedLog(!showSpeedLog)} className="bg-black/60 hover:bg-black/80 border border-white/10 text-white text-xs font-semibold px-4 py-2 rounded-xl backdrop-blur-md transition-all">Speed Log</button>
        </div>
        {gameActive && <div className="bg-green-500/20 border border-green-400/30 text-green-400 text-xs font-semibold px-4 py-2 rounded-xl">Game Active — Click the coins!</div>}
        {!gameActive && gameEndedRef.current && <div className="bg-yellow-500/20 border border-yellow-400/30 text-yellow-400 text-xs font-semibold px-4 py-2 rounded-xl">Game Over — Loading results...</div>}
      </div>

      {status && <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 bg-black/70 border border-white/10 rounded-xl px-4 py-2 backdrop-blur-md"><span className="text-xs text-gray-300 font-mono">{status}</span></div>}

      {showSpeedLog && (
        <div className="absolute top-20 left-4 z-20 bg-black/80 border border-white/10 rounded-2xl p-4 backdrop-blur-md w-[420px] max-h-[60vh] overflow-y-auto pointer-events-auto">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-white text-sm font-bold">Speed Log</h3>
            <button onClick={() => setShowSpeedLog(false)} className="text-gray-400 hover:text-white text-lg leading-none">&times;</button>
          </div>
          {txLogs.length === 0 ? <p className="text-gray-500 text-xs">No transactions yet</p> : (
            <div className="text-[11px] font-mono space-y-0.5">
              <div className="grid grid-cols-4 gap-1 text-gray-500 pb-1 border-b border-white/10 mb-1"><span>Action</span><span>Player</span><span>RPC</span><span>WS</span></div>
              {txLogs.map((log, i) => {
                const cMs = log.txConfirmedAt ? ((log.txConfirmedAt - log.txSentAt) / 1000).toFixed(3) : '\u2014'
                const wMs = log.wsEventAt ? ((log.wsEventAt - log.txSentAt) / 1000).toFixed(3) : '\u2014'
                const sw = log.wallet.length > 10 ? `${log.wallet.slice(0, 6)}...${log.wallet.slice(-4)}` : log.wallet
                return (<div key={i} className="grid grid-cols-4 gap-1 py-1 border-b border-white/5"><span className="text-purple-300 truncate">{log.action}</span><span className="text-white/70 truncate">{sw}</span><span className="text-green-400">{cMs}s</span><span className="text-blue-400">{wMs}s</span></div>)
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
