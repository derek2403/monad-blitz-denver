import { useState, useEffect, useCallback, useRef } from 'react'
import { JsonRpcProvider, BrowserProvider, Wallet, Contract, Interface, WebSocketProvider, formatEther, Signer } from 'ethers'

const BALLGAME_ADDRESS = '0x5dDbAd38E6312Ab2274612D4f847F3Ca27240921'

const BALLGAME_ABI = [
  'function currentGameId() view returns (uint256)',
  'function startGame()',
  'function claimBall(uint8 index)',
  'function getGamePositions(uint256 gameId) view returns (uint16[10] xs, uint16[10] ys)',
  'function getGameClaims(uint256 gameId) view returns (address[10] claimedBy, uint8 claimedCount)',
  'function getGameStartTime(uint256 gameId) view returns (uint256)',
  'function isGameActive() view returns (bool)',
  'event GameStarted(uint256 indexed gameId, uint256 startTime, uint16[10] xs, uint16[10] ys)',
  'event BallClaimed(uint256 indexed gameId, uint8 index, address player)',
]

const BALLGAME_IFACE = new Interface(BALLGAME_ABI)
const CHAIN_ID = 10143

const MONAD_RPC_URL = 'https://monad-testnet.g.alchemy.com/v2/6U7t79S89NhHIspqDQ7oKGRWp5ZOfsNj'
const MONAD_WS_URL = 'wss://monad-testnet.g.alchemy.com/v2/6U7t79S89NhHIspqDQ7oKGRWp5ZOfsNj'
const MONAD_TESTNET_CHAIN_ID = '0x279F'

const STORAGE_KEY = 'monad-ballgame-burner-key'
const MODE_KEY = 'monad-ballgame-mode'

type WalletMode = 'none' | 'burner' | 'metamask' | 'auto'

const ENV_PRIVATE_KEY = import.meta.env.VITE_PRIVATE_KEY as string | undefined

const BALL_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e', '#14b8a6',
]

interface BallState {
  x: number
  y: number
  claimed: boolean
  claimedBy: string | null
}

interface TxLog {
  action: string
  wallet: string
  txSentAt: number
  txConfirmedAt: number | null
  wsEventAt: number | null
}

interface CachedTxParams {
  nonce: number
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
}

const rpcProvider = new JsonRpcProvider(MONAD_RPC_URL)
const readContract = new Contract(BALLGAME_ADDRESS, BALLGAME_ABI, rpcProvider)

function loadBurnerWallet(): Wallet | null {
  const privateKey = localStorage.getItem(STORAGE_KEY)
  if (!privateKey) return null
  return new Wallet(privateKey, rpcProvider)
}

function createBurnerWallet(): Wallet {
  const wallet = Wallet.createRandom()
  localStorage.setItem(STORAGE_KEY, wallet.privateKey)
  return new Wallet(wallet.privateKey, rpcProvider)
}

// clock offset: difference between chain time and local clock
let clockOffset = 0
async function calibrateClock() {
  try {
    const block = await rpcProvider.getBlock('latest')
    if (block) {
      // block.timestamp is seconds, Date.now() is ms
      clockOffset = block.timestamp - Math.floor(Date.now() / 1000)
    }
  } catch { /* ignore */ }
}
calibrateClock()

function BallGame() {
  const [gameId, setGameId] = useState(0)
  const [gameStartTime, setGameStartTime] = useState(0)
  const [balls, setBalls] = useState<BallState[]>([])
  const [gameActive, setGameActive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [wsConnected, setWsConnected] = useState(false)
  const [balance, setBalance] = useState<string | null>(null)
  const [txLogs, setTxLogs] = useState<TxLog[]>([])
  const wsProviderRef = useRef<WebSocketProvider | null>(null)
  const pendingTxRef = useRef<TxLog | null>(null)
  const pendingClaimsRef = useRef<Map<number, TxLog>>(new Map())
  const cachedParamsRef = useRef<CachedTxParams | null>(null)

  const [mode, setMode] = useState<WalletMode>(() => {
    return (localStorage.getItem(MODE_KEY) as WalletMode) || 'none'
  })
  const [burnerWallet, setBurnerWallet] = useState<Wallet | null>(() => loadBurnerWallet())
  const [metamaskAddress, setMetamaskAddress] = useState<string | null>(null)
  const [autoWallet] = useState<Wallet | null>(() => {
    if (!ENV_PRIVATE_KEY) return null
    return new Wallet(ENV_PRIVATE_KEY, rpcProvider)
  })

  const address = mode === 'auto' ? autoWallet?.address ?? null
    : mode === 'burner' ? burnerWallet?.address ?? null
    : metamaskAddress
  const isConnected = mode !== 'none' && address !== null

  const getDirectWallet = useCallback((): Wallet | null => {
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

  const getSigner = useCallback(async (): Promise<Signer> => {
    if (!window.ethereum) throw new Error('No wallet found')
    const provider = new BrowserProvider(window.ethereum)
    return provider.getSigner()
  }, [])

  const fetchBalance = useCallback(async () => {
    if (!address) return
    try {
      const bal = await rpcProvider.getBalance(address)
      setBalance(formatEther(bal))
    } catch (err) {
      console.error('Failed to fetch balance:', err)
    }
  }, [address])

  // --- fetch game state ---

  const fetchGameState = useCallback(async () => {
    try {
      const id = await readContract.currentGameId()
      const gameIdNum = Number(id)
      setGameId(gameIdNum)

      if (gameIdNum === 0) {
        setBalls([])
        setGameActive(false)
        return
      }

      const [positions, claims, startTime] = await Promise.all([
        readContract.getGamePositions(gameIdNum),
        readContract.getGameClaims(gameIdNum),
        readContract.getGameStartTime(gameIdNum),
      ])

      setGameStartTime(Number(startTime))
      const [xs, ys] = positions
      const [claimedBy, claimedCount] = claims

      const newBalls: BallState[] = []
      for (let i = 0; i < 10; i++) {
        newBalls.push({
          x: Number(xs[i]) / 10,
          y: Number(ys[i]) / 10,
          claimed: claimedBy[i] !== '0x0000000000000000000000000000000000000000',
          claimedBy: claimedBy[i] !== '0x0000000000000000000000000000000000000000'
            ? claimedBy[i]
            : null,
        })
      }
      setBalls(newBalls)
      setGameActive(Number(claimedCount) < 10)
    } catch (err) {
      console.error('Failed to fetch game state:', err)
    }
  }, [])

  useEffect(() => { fetchGameState() }, [fetchGameState])
  useEffect(() => { if (address) fetchBalance() }, [address, fetchBalance])

  // poll game state as fallback for WS sync
  useEffect(() => {
    if (!gameActive) return
    const interval = setInterval(fetchGameState, 3000)
    return () => clearInterval(interval)
  }, [gameActive, fetchGameState])

  // auto-detect MetaMask on mount
  useEffect(() => {
    if (mode !== 'metamask' || !window.ethereum) return
    window.ethereum
      .request({ method: 'eth_accounts' })
      .then((accounts) => {
        const accs = accounts as string[]
        if (accs.length > 0) setMetamaskAddress(accs[0])
      })
      .catch(console.error)

    const handleAccountsChanged = (accounts: unknown) => {
      const accs = accounts as string[]
      if (accs.length === 0) setMetamaskAddress(null)
      else setMetamaskAddress(accs[0])
    }

    window.ethereum.on?.('accountsChanged', handleAccountsChanged)
    return () => {
      window.ethereum?.removeListener?.('accountsChanged', handleAccountsChanged)
    }
  }, [mode])

  // --- WebSocket listener ---
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

        contract.on('GameStarted', (gameIdBn, startTimeBn, xs, ys) => {
          const wsEventAt = performance.now()
          const newGameId = Number(gameIdBn)
          // re-calibrate clock on each new game for tighter sync
          calibrateClock()
          // clear stale claim guards from previous game
          claimingRef.current.clear()
          pendingClaimsRef.current.clear()

          setGameId(newGameId)
          setGameStartTime(Number(startTimeBn))
          setGameActive(true)

          const newBalls: BallState[] = []
          for (let i = 0; i < 10; i++) {
            newBalls.push({
              x: Number(xs[i]) / 10,
              y: Number(ys[i]) / 10,
              claimed: false,
              claimedBy: null,
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

        contract.on('BallClaimed', (gameIdBn, indexBn, player) => {
          const wsEventAt = performance.now()
          const idx = Number(indexBn)

          setBalls(prev => {
            const updated = [...prev]
            if (updated[idx]) {
              updated[idx] = { ...updated[idx], claimed: true, claimedBy: player }
            }
            const allClaimed = updated.every(b => b.claimed)
            if (allClaimed) setGameActive(false)
            return updated
          })

          const shortAddr = `${player.slice(0, 6)}...${player.slice(-4)}`
          const pending = pendingClaimsRef.current.get(idx)
          if (pending) {
            // use on-chain player address (the actual winner), not our wallet
            const log: TxLog = { ...pending, wallet: player, wsEventAt }
            // don't delete from map yet — RPC .then() still needs it for txConfirmedAt
            pending.wsEventAt = wsEventAt
            setTxLogs(prev => [log, ...prev].slice(0, 20))
            setStatus(`Ball #${idx} claimed by ${shortAddr}: ${((wsEventAt - pending.txSentAt) / 1000).toFixed(3)}s`)
          } else {
            setTxLogs(prev => [{
              action: `ball #${idx}`,
              wallet: shortAddr,
              txSentAt: wsEventAt,
              txConfirmedAt: null,
              wsEventAt,
            }, ...prev].slice(0, 20))
            setStatus(`Ball #${idx} claimed by ${shortAddr}`)
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
      if (wsProviderRef.current) {
        wsProviderRef.current.destroy()
        wsProviderRef.current = null
      }
      setWsConnected(false)
    }
  }, [fetchBalance])

  // --- raw tx: sign locally, 1 RPC call, auto-retry on nonce error ---
  const sendRawTx = async (action: string, data: string, gasLimit: bigint = 300000n) => {
    const wallet = getDirectWallet()
    if (!wallet || !cachedParamsRef.current) {
      throw new Error('Wallet or cached params not ready')
    }

    const params = cachedParamsRef.current
    const isClaimAction = action.startsWith('claimBall(')

    if (!isClaimAction) {
      const txSentAt = performance.now()
      const log: TxLog = { action, wallet: address ?? 'unknown', txSentAt, txConfirmedAt: null, wsEventAt: null }
      pendingTxRef.current = log
    }

    const currentNonce = params.nonce
    params.nonce++

    const signedTx = await wallet.signTransaction({
      to: BALLGAME_ADDRESS,
      data,
      nonce: currentNonce,
      gasLimit,
      maxFeePerGas: params.maxFeePerGas,
      maxPriorityFeePerGas: params.maxPriorityFeePerGas,
      chainId: CHAIN_ID,
      type: 2,
    })

    // fire-and-forget with auto-retry on nonce error
    ;(async () => {
      let success = false
      try {
        await rpcProvider.send('eth_sendRawTransaction', [signedTx])
        success = true
      } catch (err: unknown) {
        const msg = ((err as Error)?.message || '') + ((err as { info?: { error?: { message?: string } } })?.info?.error?.message || '')
        if (msg.toLowerCase().includes('nonce')) {
          // nonce stale — refresh and retry once
          try {
            await refreshCachedParams()
            if (cachedParamsRef.current) {
              const freshNonce = cachedParamsRef.current.nonce
              cachedParamsRef.current.nonce++
              const retryTx = await wallet.signTransaction({
                to: BALLGAME_ADDRESS, data,
                nonce: freshNonce, gasLimit,
                maxFeePerGas: cachedParamsRef.current.maxFeePerGas,
                maxPriorityFeePerGas: cachedParamsRef.current.maxPriorityFeePerGas,
                chainId: CHAIN_ID, type: 2,
              })
              await rpcProvider.send('eth_sendRawTransaction', [retryTx])
              success = true
            }
          } catch {
            // retry also failed
          }
        }

        if (!success) {
          if (isClaimAction) {
            const match = action.match(/claimBall\((\d+)\)/)
            const idx = match ? Number(match[1]) : -1
            pendingClaimsRef.current.delete(idx)
            claimingRef.current.delete(idx)
          } else {
            pendingTxRef.current = null
          }
          setStatus(`${action} failed: ${msg || err}`)
          refreshCachedParams()
          return
        }
      }

      // RPC accepted the tx
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

  // --- MetaMask tx ---
  const sendMetamaskTx = async (action: string, callFn: (contract: Contract) => Promise<{ hash: string }>) => {
    setStatus('Sign the transaction...')
    const signer = await getSigner()
    const contract = new Contract(BALLGAME_ADDRESS, BALLGAME_ABI, signer)
    const tx = await callFn(contract)

    const txSentAt = performance.now()
    const log: TxLog = { action, wallet: address ?? 'unknown', txSentAt, txConfirmedAt: null, wsEventAt: null }
    pendingTxRef.current = log
    setStatus('TX submitted, waiting...')

    const ws = wsProviderRef.current
    if (ws) {
      await ws.waitForTransaction(tx.hash, 1)
    }

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

  // --- wallet actions ---

  const fundBurner = async (burnerAddress: string) => {
    if (!ENV_PRIVATE_KEY) {
      setStatus('Burner created — fund it manually (no funder key in .env)')
      return
    }
    try {
      setStatus('Funding burner wallet...')
      const funder = new Wallet(ENV_PRIVATE_KEY, rpcProvider)
      const [nonce, feeData] = await Promise.all([
        rpcProvider.getTransactionCount(funder.address, 'pending'),
        rpcProvider.getFeeData(),
      ])
      const signedTx = await funder.signTransaction({
        to: burnerAddress,
        value: 1000000000000000000n,
        nonce,
        gasLimit: 21000n,
        maxFeePerGas: feeData.maxFeePerGas ?? 50000000000n,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 2000000000n,
        chainId: CHAIN_ID,
        type: 2,
      })
      await rpcProvider.send('eth_sendRawTransaction', [signedTx])
      let attempts = 0
      while (attempts < 20) {
        await new Promise(r => setTimeout(r, 250))
        const bal = await rpcProvider.getBalance(burnerAddress)
        if (bal > 0n) {
          setBalance(formatEther(bal))
          break
        }
        attempts++
      }
      setStatus('Burner funded with 1 MON!')
    } catch (err) {
      console.error('Failed to fund burner:', err)
      setStatus('Burner created — auto-fund failed, send MON manually')
    }
  }

  const selectBurner = async () => {
    localStorage.setItem(MODE_KEY, 'burner')
    setMode('burner')
    setMetamaskAddress(null)
    setBalance(null)
    if (!burnerWallet) {
      const w = createBurnerWallet()
      setBurnerWallet(w)
      setStatus('Burner wallet created')
      await fundBurner(w.address)
    } else {
      setStatus('Burner wallet selected')
    }
  }

  const selectMetamask = async () => {
    if (!window.ethereum) {
      setStatus('No wallet found. Install MetaMask.')
      return
    }
    try {
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: MONAD_TESTNET_CHAIN_ID }],
        })
      } catch (switchErr: unknown) {
        const code = (switchErr as { code?: number }).code
        if (code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: MONAD_TESTNET_CHAIN_ID,
              chainName: 'Monad Testnet',
              nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
              rpcUrls: ['https://testnet-rpc.monad.xyz'],
              blockExplorerUrls: ['https://testnet.monadexplorer.com'],
            }],
          })
        }
      }
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[]
      localStorage.setItem(MODE_KEY, 'metamask')
      setMode('metamask')
      setMetamaskAddress(accounts[0])
      setBalance(null)
      setStatus('MetaMask connected')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err)
      setStatus(`MetaMask failed: ${msg}`)
    }
  }

  const generateNewBurner = async () => {
    localStorage.removeItem(STORAGE_KEY)
    const w = createBurnerWallet()
    setBurnerWallet(w)
    setBalance(null)
    setStatus('New burner wallet generated!')
    await fundBurner(w.address)
  }

  const disconnect = () => {
    localStorage.removeItem(MODE_KEY)
    setMode('none')
    setMetamaskAddress(null)
    setBalance(null)
    cachedParamsRef.current = null
    setStatus('Disconnected')
  }

  // --- game actions ---

  const callStartGame = async () => {
    setLoading(true)
    try {
      if (mode === 'auto' || mode === 'burner') {
        const data = BALLGAME_IFACE.encodeFunctionData('startGame')
        await sendRawTx('startGame()', data)
      } else {
        await sendMetamaskTx('startGame()', (c) => c.startGame())
      }
    } catch (err) {
      pendingTxRef.current = null
      setStatus(`startGame() failed: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  const claimingRef = useRef<Set<number>>(new Set())

  const callClaimBall = async (index: number) => {
    if (claimingRef.current.has(index)) return
    claimingRef.current.add(index)

    const txSentAt = performance.now()
    const log: TxLog = { action: `claimBall(${index})`, wallet: address ?? 'unknown', txSentAt, txConfirmedAt: null, wsEventAt: null }
    pendingClaimsRef.current.set(index, log)

    try {
      if (mode === 'auto' || mode === 'burner') {
        const data = BALLGAME_IFACE.encodeFunctionData('claimBall', [index])
        await sendRawTx(`claimBall(${index})`, data, 150000n)
      } else {
        await sendMetamaskTx(`claimBall(${index})`, (c) => c.claimBall(index))
      }
    } catch (err) {
      claimingRef.current.delete(index)
      pendingClaimsRef.current.delete(index)
      pendingTxRef.current = null
      setStatus(`claimBall(${index}) failed: ${err}`)
    }
  }

  const hasBalance = balance !== null && parseFloat(balance) > 0

  // --- ball animation: each ball floats around its base position ---
  const [animOffset, setAnimOffset] = useState<{ dx: number; dy: number }[]>([])
  const animRef = useRef<number>(0)

  useEffect(() => {
    if (balls.length === 0 || !gameActive) {
      setAnimOffset([])
      cancelAnimationFrame(animRef.current)
      return
    }

    const animate = () => {
      // t = seconds since game started, synced to chain clock
      const t = (Date.now() / 1000 + clockOffset) - gameStartTime

      const offsets = balls.map((ball, i) => {
        // Fruit-ninja style: parabolic arc launching from bottom
        const cycleDuration = 3.0 + (i % 4) * 0.5     // 3.0–4.5s per cycle
        const launchDelay = (i % 5) * 0.4              // stagger 0–1.6s
        const elapsed = t - launchDelay
        if (elapsed < 0) return { dx: 0, dy: 110 - ball.y }

        const phase = (elapsed % cycleDuration) / cycleDuration  // 0→1
        // parabola: 4*p*(1-p) peaks at 1.0 when p=0.5
        const peakHeight = 75 + (i % 3) * 15           // 75–105% travel upward
        const baseY = 110                               // starts below screen
        const targetY = baseY - peakHeight * 4 * phase * (1 - phase)

        // slight horizontal drift, deterministic from chain time
        const dx = Math.sin(elapsed * 0.6 + i * 2.0) * 2.5
        const dy = targetY - ball.y

        return { dx, dy }
      })
      setAnimOffset(offsets)
      animRef.current = requestAnimationFrame(animate)
    }

    animRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animRef.current)
  }, [balls, gameActive, gameStartTime])

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
      <h1>Monad Ball Game</h1>
      <p style={{ color: '#888', fontSize: '0.85rem' }}>
        Contract: <code>{BALLGAME_ADDRESS}</code>
      </p>
      <p style={{ fontSize: '0.75rem', color: wsConnected ? '#4ade80' : '#f87171' }}>
        {wsConnected ? 'Live updates via WebSocket' : 'WebSocket disconnected'}
      </p>

      {/* Wallet selection */}
      <div style={{ margin: '1rem 0', padding: '1rem', borderRadius: '8px', border: '1px solid #333' }}>
        {mode === 'none' ? (
          <>
            <p style={{ fontSize: '0.85rem', color: '#888', margin: '0 0 1rem' }}>
              Choose a wallet to start playing
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              {ENV_PRIVATE_KEY && (
                <button onClick={() => { localStorage.setItem(MODE_KEY, 'auto'); setMode('auto'); setStatus('Private key wallet connected') }}>
                  Private Key
                </button>
              )}
              <button onClick={selectBurner}>Burner</button>
              <button onClick={selectMetamask}>MetaMask</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.75rem', color: '#888' }}>
                {mode === 'auto' ? 'Private Key' : mode === 'burner' ? 'Burner' : 'MetaMask'}
                {(mode === 'auto' || mode === 'burner') && ' (raw tx)'}
              </span>
              <button onClick={disconnect} style={{ fontSize: '0.7rem', padding: '0.2em 0.6em' }}>
                Disconnect
              </button>
            </div>
            <p style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>
              <code>{address}</code>
            </p>
            <p style={{ fontSize: '0.85rem', margin: '0.5rem 0' }}>
              Balance: <strong>{balance ?? '...'} MON</strong>
            </p>
            {!hasBalance && (
              <p style={{ fontSize: '0.75rem', color: '#f87171' }}>
                Send testnet MON to the address above to start playing
              </p>
            )}
            {mode === 'burner' && (
              <button onClick={generateNewBurner} style={{ fontSize: '0.75rem', padding: '0.3em 0.8em', marginTop: '0.5rem' }}>
                Generate New Wallet
              </button>
            )}
          </>
        )}
      </div>

      {/* Game area */}
      <div style={{ margin: '1rem 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.85rem', color: '#888' }}>
            {gameId > 0 ? `Game #${gameId}` : 'No games yet'}
            {gameActive && ' (active)'}
            {gameId > 0 && !gameActive && ' (finished)'}
          </span>
          <button
            onClick={callStartGame}
            disabled={loading || !isConnected || !hasBalance || gameActive}
          >
            {gameActive ? 'Game in Progress' : 'Start New Game'}
          </button>
        </div>

        {/* Ball field */}
        <div style={{
          position: 'relative',
          width: '100%',
          height: '500px',
          border: '1px solid #333',
          borderRadius: '12px',
          backgroundColor: '#1a1a2e',
          overflow: 'hidden',
        }}>
          {balls.map((ball, i) => {
            if (ball.claimed) return null
            const offset = animOffset[i] || { dx: 0, dy: 0 }
            const bx = ball.x + offset.dx
            const by = ball.y + offset.dy
            return (
              <button
                key={i}
                onClick={() => callClaimBall(i)}
                disabled={!isConnected || !hasBalance}
                style={{
                  position: 'absolute',
                  left: `${bx}%`,
                  top: `${by}%`,
                  transform: 'translate(-50%, -50%)',
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  border: '2px solid rgba(255,255,255,0.3)',
                  backgroundColor: BALL_COLORS[i],
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.85rem',
                  fontWeight: 'bold',
                  color: '#fff',
                  padding: 0,
                  boxShadow: `0 0 12px ${BALL_COLORS[i]}88`,
                }}
              >
                {i}
              </button>
            )
          })}

          {balls.length === 0 && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              color: '#555',
              fontSize: '1.2rem',
            }}>
              Start a game to spawn balls
            </div>
          )}

          {balls.length > 0 && balls.every(b => b.claimed) && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              color: '#4ade80',
              fontSize: '1.2rem',
            }}>
              All balls claimed! Start a new game.
            </div>
          )}
        </div>
      </div>

      {status && (
        <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: '#aaa' }}>{status}</p>
      )}

      {/* Speed log */}
      {txLogs.length > 0 && (
        <div style={{ marginTop: '2rem', textAlign: 'left' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Speed Log</h3>
          <div style={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.5fr 1fr 1fr', gap: '0.25rem', padding: '0.5rem', borderBottom: '1px solid #333', color: '#888' }}>
              <span>Action</span>
              <span>Player</span>
              <span>RPC Response</span>
              <span>WS Event</span>
            </div>
            {txLogs.map((log, i) => {
              const confirmMs = log.txConfirmedAt ? ((log.txConfirmedAt - log.txSentAt) / 1000).toFixed(3) : '\u2014'
              const wsMs = log.wsEventAt ? ((log.wsEventAt - log.txSentAt) / 1000).toFixed(3) : '\u2014'
              const shortWallet = log.wallet.length > 10 ? `${log.wallet.slice(0, 6)}...${log.wallet.slice(-4)}` : log.wallet
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.5fr 1fr 1fr', gap: '0.25rem', padding: '0.5rem', borderBottom: '1px solid #222' }}>
                  <span style={{ color: '#c4b5fd' }}>{log.action}</span>
                  <span style={{ color: '#e2e8f0' }}>{shortWallet}</span>
                  <span style={{ color: '#4ade80' }}>{confirmMs}s</span>
                  <span style={{ color: '#38bdf8' }}>{wsMs}s</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default BallGame
