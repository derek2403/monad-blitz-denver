import { useState, useEffect, useCallback, useRef } from 'react'
import { JsonRpcProvider, BrowserProvider, Wallet, Contract, Interface, WebSocketProvider, formatEther, Signer } from 'ethers'

const BALLGAME_ADDRESS = '0xE17722A663E72f876baFe1F73dE6e6e02358Ba65'

const BALL_COUNT = 50

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
    'function scores(address) view returns (uint256)',
    'event GameStarted(uint256 indexed gameId, uint256 startTime, uint16[50] xs, uint16[50] ys, uint8[50] ballTypes)',
    'event BallClaimed(uint256 indexed gameId, uint8 index, address player, uint8 ballType, uint256 newScore)',
    'event GameEnded(uint256 indexed gameId, address endedBy)',
    'event BallsRegenerated(uint256 indexed gameId, uint256 startTime, uint16[50] xs, uint16[50] ys, uint8[50] ballTypes)',
]

const BALLGAME_IFACE = new Interface(BALLGAME_ABI)
const CHAIN_ID = 10143

const MONAD_RPC_URL = 'https://monad-testnet.g.alchemy.com/v2/p3LF9TmoLQFqlPs6DcFxH'
const MONAD_WS_URL = 'wss://monad-testnet.g.alchemy.com/v2/p3LF9TmoLQFqlPs6DcFxH'
const MONAD_TESTNET_CHAIN_ID = '0x279F'

const STORAGE_KEY = 'monad-ballgame-burner-key'
const MODE_KEY = 'monad-ballgame-mode'

type WalletMode = 'none' | 'burner' | 'metamask' | 'auto'

const ENV_PRIVATE_KEY = import.meta.env.VITE_PRIVATE_KEY as string | undefined

// Ball type: 0=Normal, 1=Special, 2=Bomb
const BALL_TYPE_COLORS: Record<number, string> = {
    0: '#3b82f6', // blue - normal
    1: '#eab308', // gold - special
    2: '#ef4444', // red - bomb
}
const BALL_TYPE_LABELS: Record<number, string> = {
    0: '',
    1: '*',
    2: '!',
}
const BALL_TYPE_POINTS: Record<number, string> = {
    0: '+1',
    1: '+3',
    2: '-5',
}

interface BallState {
    x: number
    y: number
    ballType: number
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

interface LeaderboardEntry {
    address: string
    score: number
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

// clock offset: difference between chain time and local clock (ms precision)
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
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
    const [myScore, setMyScore] = useState(0)
    const [isFalling, setIsFalling] = useState(false)
    const containerRef = useRef<HTMLDivElement | null>(null)
    const wsProviderRef = useRef<WebSocketProvider | null>(null)
    const pendingTxRef = useRef<TxLog | null>(null)
    const pendingClaimsRef = useRef<Map<number, TxLog>>(new Map())
    const cachedParamsRef = useRef<CachedTxParams | null>(null)
    // track all known players for leaderboard
    const knownPlayersRef = useRef<Set<string>>(new Set())
    // pending new balls from regenerate (shown after falling animation)
    const pendingNewBallsRef = useRef<{ balls: BallState[], startTime: number } | null>(null)

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

    // --- leaderboard: refresh scores for all known players ---
    const refreshLeaderboard = useCallback(async () => {
        const players = Array.from(knownPlayersRef.current)
        if (players.length === 0) return
        try {
            const scorePromises = players.map(p => readContract.getScore(p))
            const scores = await Promise.all(scorePromises)
            const entries: LeaderboardEntry[] = players
                .map((addr, i) => ({ address: addr, score: Number(scores[i]) }))
                .sort((a, b) => b.score - a.score)
            setLeaderboard(entries)
        } catch (err) {
            console.error('Failed to refresh leaderboard:', err)
        }
    }, [])

    // fetch my score
    const fetchMyScore = useCallback(async () => {
        if (!address) return
        try {
            const s = await readContract.getScore(address)
            setMyScore(Number(s))
        } catch { /* ignore */ }
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
                const addr = claimedBy[i]
                const isClaimed = addr !== '0x0000000000000000000000000000000000000000'
                if (isClaimed) knownPlayersRef.current.add(addr)
                newBalls.push({
                    x: Number(xs[i]) / 10,
                    y: Number(ys[i]) / 10,
                    ballType: Number(ballTypes[i]),
                    claimed: isClaimed || isFinished,
                    claimedBy: isClaimed ? addr : null,
                })
            }
            setBalls(newBalls)
            setGameActive(!isFinished)
        } catch (err) {
            console.error('Failed to fetch game state:', err)
        }
    }, [])

    useEffect(() => { fetchGameState() }, [fetchGameState])
    useEffect(() => { if (address) fetchBalance() }, [address, fetchBalance])
    useEffect(() => { if (address) { knownPlayersRef.current.add(address); fetchMyScore() } }, [address, fetchMyScore])

    // poll game state as fallback for WS sync
    useEffect(() => {
        if (!gameActive || isFalling) return
        const interval = setInterval(fetchGameState, 3000)
        return () => clearInterval(interval)
    }, [gameActive, isFalling, fetchGameState])

    // refresh leaderboard periodically
    useEffect(() => {
        refreshLeaderboard()
        const interval = setInterval(refreshLeaderboard, 5000)
        return () => clearInterval(interval)
    }, [refreshLeaderboard])

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

                contract.on('GameStarted', (gameIdBn, startTimeBn, xs, ys, ballTypes) => {
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
                    for (let i = 0; i < BALL_COUNT; i++) {
                        newBalls.push({
                            x: Number(xs[i]) / 10,
                            y: Number(ys[i]) / 10,
                            ballType: Number(ballTypes[i]),
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

                contract.on('BallClaimed', (_gameIdBn, indexBn, player, ballTypeBn, newScoreBn) => {
                    const wsEventAt = performance.now()
                    const idx = Number(indexBn)
                    const ballType = Number(ballTypeBn)
                    const newScore = Number(newScoreBn)
                    const typeLabel = ballType === 1 ? 'Special' : ballType === 2 ? 'Bomb' : 'Normal'
                    const pointsLabel = BALL_TYPE_POINTS[ballType]

                    // track player for leaderboard
                    knownPlayersRef.current.add(player)

                    setBalls(prev => {
                        const updated = [...prev]
                        if (updated[idx]) {
                            updated[idx] = { ...updated[idx], claimed: true, claimedBy: player }
                        }
                        const allClaimed = updated.every(b => b.claimed)
                        if (allClaimed) setGameActive(false)
                        return updated
                    })

                    // update leaderboard entry for this player immediately
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

                    // update my score if it's me
                    if (address && player.toLowerCase() === address.toLowerCase()) {
                        setMyScore(newScore)
                    }

                    const shortAddr = `${player.slice(0, 6)}...${player.slice(-4)}`
                    const pending = pendingClaimsRef.current.get(idx)
                    if (pending) {
                        const log: TxLog = { ...pending, wallet: player, wsEventAt }
                        pending.wsEventAt = wsEventAt
                        setTxLogs(prev => [log, ...prev].slice(0, 20))
                        setStatus(`${typeLabel} #${idx} (${pointsLabel}) claimed by ${shortAddr}: ${((wsEventAt - pending.txSentAt) / 1000).toFixed(3)}s → Score: ${newScore}`)
                    } else {
                        setTxLogs(prev => [{
                            action: `${typeLabel.toLowerCase()} #${idx} (${pointsLabel})`,
                            wallet: shortAddr,
                            txSentAt: wsEventAt,
                            txConfirmedAt: null,
                            wsEventAt,
                        }, ...prev].slice(0, 20))
                        setStatus(`${typeLabel} #${idx} (${pointsLabel}) claimed by ${shortAddr} → Score: ${newScore}`)
                    }

                    fetchBalance()
                })
                contract.on('BallsRegenerated', (_gameIdBn, startTimeBn, xs, ys, ballTypes) => {
                    calibrateClock()
                    claimingRef.current.clear()
                    pendingClaimsRef.current.clear()

                    const newStartTime = Number(startTimeBn)
                    const newBalls: BallState[] = []
                    for (let i = 0; i < BALL_COUNT; i++) {
                        newBalls.push({
                            x: Number(xs[i]) / 10,
                            y: Number(ys[i]) / 10,
                            ballType: Number(ballTypes[i]),
                            claimed: false,
                            claimedBy: null,
                        })
                    }

                    // If not already falling (other clients), start falling now
                    const alreadyFalling = fallingStartRef.current > 0
                    if (!alreadyFalling) {
                        fallingStartRef.current = Date.now()
                        setIsFalling(true)
                        setStatus('Balls falling...')
                    }

                    // Show new balls after remaining fall time (2s total)
                    const elapsed = Date.now() - fallingStartRef.current
                    const remaining = Math.max(0, 2000 - elapsed)

                    setTimeout(() => {
                        setGameStartTime(newStartTime)
                        setGameActive(true)
                        setIsFalling(false)
                        fallingStartRef.current = 0
                        setBalls(newBalls)
                        pendingNewBallsRef.current = null
                        setStatus('New balls generated!')
                    }, remaining)

                    fetchBalance()
                })

                contract.on('GameEnded', (_gameIdBn, _endedBy) => {
                    setGameActive(false)
                    setBalls(prev => prev.map(b => ({ ...b, claimed: true })))
                    setStatus('Game ended!')
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
    }, [fetchBalance, address])

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
                await sendRawTx('startGame()', data, 1000000n)
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

    const callRegenerateBalls = async () => {
        setLoading(true)
        fallingStartRef.current = Date.now()
        setIsFalling(true)
        setStatus('Balls falling...')

        try {
            if (mode === 'auto' || mode === 'burner') {
                const data = BALLGAME_IFACE.encodeFunctionData('regenerateBalls')
                await sendRawTx('regenerateBalls()', data, 1000000n)
            } else {
                await sendMetamaskTx('regenerateBalls()', (c) => c.regenerateBalls())
            }
            setStatus('Generating new balls...')
        } catch (err) {
            pendingTxRef.current = null
            setIsFalling(false)
            fallingStartRef.current = 0
            setStatus(`regenerateBalls() failed: ${err}`)
        } finally {
            setLoading(false)
        }
    }

    const callEndGame = async () => {
        setLoading(true)
        try {
            if (mode === 'auto' || mode === 'burner') {
                const data = BALLGAME_IFACE.encodeFunctionData('endGame')
                await sendRawTx('endGame()', data, 300000n)
            } else {
                await sendMetamaskTx('endGame()', (c) => c.endGame())
            }
            setGameActive(false)
            setBalls(prev => prev.map(b => ({ ...b, claimed: true })))
            setStatus('Game ended!')
        } catch (err) {
            pendingTxRef.current = null
            setStatus(`endGame() failed: ${err}`)
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

    // --- fullscreen toggle with orientation lock ---
    const toggleFullscreen = useCallback(async () => {
        const el = containerRef.current
        if (!el) return
        if (!document.fullscreenElement) {
            try {
                await el.requestFullscreen()
                try { await (screen.orientation as any).lock('landscape') } catch { /* unsupported */ }
            } catch { /* fullscreen denied */ }
        } else {
            try { await (screen.orientation as any).unlock() } catch { /* ignore */ }
            await document.exitFullscreen()
        }
    }, [])

    useEffect(() => {
        const handler = () => setIsFullscreen(!!document.fullscreenElement)
        document.addEventListener('fullscreenchange', handler)
        return () => document.removeEventListener('fullscreenchange', handler)
    }, [])

    // --- ball animation ---
    const [animOffset, setAnimOffset] = useState<{ dx: number; dy: number }[]>([])
    const animRef = useRef<number>(0)

    const fallingStartRef = useRef<number>(0)

    useEffect(() => {
        if (balls.length === 0 || !gameActive) {
            setAnimOffset([])
            cancelAnimationFrame(animRef.current)
            return
        }

        if (isFalling && fallingStartRef.current === 0) {
            fallingStartRef.current = Date.now()
        }
        if (!isFalling) {
            fallingStartRef.current = 0
        }

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

    return (
        <div
            ref={containerRef}
            style={{
                padding: isFullscreen ? 0 : '2rem',
                maxWidth: isFullscreen ? '100%' : '800px',
                margin: '0 auto',
                textAlign: 'center',
                backgroundColor: isFullscreen ? '#1a1a2e' : undefined,
                height: isFullscreen ? '100vh' : undefined,
                overflow: 'hidden',
                position: 'relative',
            }}
        >
            {!isFullscreen && (
                <>
                    <h1>Monad Ball Game</h1>
                    <p style={{ color: '#888', fontSize: '0.85rem' }}>
                        Contract: <code>{BALLGAME_ADDRESS}</code>
                    </p>
                    <p style={{ fontSize: '0.75rem', color: wsConnected ? '#4ade80' : '#f87171' }}>
                        {wsConnected ? 'Live updates via WebSocket' : 'WebSocket disconnected'}
                    </p>
                    {isConnected && (
                        <p style={{ fontSize: '0.9rem', margin: '0.5rem 0', color: '#eab308' }}>
                            Your Score: <strong>{myScore}</strong> pts
                        </p>
                    )}
                </>
            )}

            {/* Wallet selection */}
            {!isFullscreen && (
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
            )}

            {/* Game area */}
            <div style={{ margin: isFullscreen ? 0 : '1rem 0', height: isFullscreen ? '100%' : undefined }}>
                {!isFullscreen && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.85rem', color: '#888' }}>
                            {gameId > 0 ? `Game #${gameId}` : 'No games yet'}
                            {gameActive && ' (active)'}
                            {gameId > 0 && !gameActive && ' (finished)'}
                        </span>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                                onClick={callStartGame}
                                disabled={loading || !isConnected || !hasBalance || gameActive}
                            >
                                {gameActive ? 'Game in Progress' : 'Start New Game'}
                            </button>
                            {gameActive && (
                                <button
                                    onClick={callRegenerateBalls}
                                    disabled={loading || !isConnected || !hasBalance || isFalling}
                                    style={{ backgroundColor: '#8b5cf6', borderColor: '#7c3aed' }}
                                >
                                    {isFalling ? 'Regenerating...' : 'New Balls'}
                                </button>
                            )}
                            {gameActive && (
                                <button
                                    onClick={callEndGame}
                                    disabled={loading || !isConnected || !hasBalance}
                                    style={{ backgroundColor: '#ef4444', borderColor: '#dc2626' }}
                                >
                                    End Game
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Ball type legend */}
                {!isFullscreen && gameActive && (
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', marginBottom: '0.5rem', fontSize: '0.75rem' }}>
                        <span><span style={{ color: BALL_TYPE_COLORS[0] }}>&#9679;</span> Normal (+1pt)</span>
                        <span><span style={{ color: BALL_TYPE_COLORS[1] }}>&#9733;</span> Special (+3pt)</span>
                        <span><span style={{ color: BALL_TYPE_COLORS[2] }}>&#9679;</span> Bomb (-5pt)</span>
                    </div>
                )}

                {/* Ball field */}
                <div style={{
                    position: 'relative',
                    width: '100%',
                    height: isFullscreen ? '100vh' : '500px',
                    border: isFullscreen ? 'none' : '1px solid #333',
                    borderRadius: isFullscreen ? 0 : '12px',
                    backgroundColor: '#1a1a2e',
                    overflow: 'hidden',
                }}>
                    <button
                        onClick={toggleFullscreen}
                        style={{
                            position: 'absolute',
                            top: '0.5rem',
                            right: '0.5rem',
                            background: 'rgba(255,255,255,0.15)',
                            border: '1px solid rgba(255,255,255,0.25)',
                            borderRadius: '6px',
                            color: '#fff',
                            padding: '0.3em 0.7em',
                            fontSize: '0.75rem',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            zIndex: 10,
                            touchAction: 'manipulation',
                        }}
                    >
                        {isFullscreen ? 'Exit' : 'Fullscreen'}
                    </button>

                    {/* Score overlay in fullscreen */}
                    {isFullscreen && isConnected && (
                        <div style={{
                            position: 'absolute',
                            top: '0.5rem',
                            left: '0.5rem',
                            color: '#eab308',
                            fontSize: '1rem',
                            fontWeight: 'bold',
                            zIndex: 10,
                            textShadow: '0 0 8px rgba(0,0,0,0.8)',
                        }}>
                            Score: {myScore}
                        </div>
                    )}

                    {balls.map((ball, i) => {
                        if (ball.claimed) return null
                        const offset = animOffset[i] || { dx: 0, dy: 0 }
                        const bx = ball.x + offset.dx
                        const by = ball.y + offset.dy
                        const color = BALL_TYPE_COLORS[ball.ballType] ?? BALL_TYPE_COLORS[0]
                        const isBomb = ball.ballType === 2
                        const isSpecial = ball.ballType === 1
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
                                    width: isBomb ? '38px' : isSpecial ? '36px' : '32px',
                                    height: isBomb ? '38px' : isSpecial ? '36px' : '32px',
                                    borderRadius: '50%',
                                    border: isSpecial ? '2px solid #fde047' : isBomb ? '2px solid #fca5a5' : '2px solid rgba(255,255,255,0.3)',
                                    backgroundColor: color,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: isSpecial ? '0.85rem' : isBomb ? '0.9rem' : '0.7rem',
                                    fontWeight: 'bold',
                                    color: '#fff',
                                    padding: 0,
                                    boxShadow: isSpecial
                                        ? `0 0 16px #eab30888, 0 0 30px #eab30844`
                                        : isBomb
                                            ? `0 0 16px #ef444488, 0 0 30px #ef444444`
                                            : `0 0 12px ${color}88`,
                                    touchAction: 'manipulation',
                                    WebkitTapHighlightColor: 'transparent',
                                    userSelect: 'none',
                                }}
                            >
                                {isBomb ? BALL_TYPE_POINTS[2] : isSpecial ? BALL_TYPE_LABELS[1] : i}
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

            {!isFullscreen && status && (
                <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: '#aaa' }}>{status}</p>
            )}

            {/* Leaderboard */}
            {!isFullscreen && leaderboard.length > 0 && (
                <div style={{ marginTop: '2rem', textAlign: 'left' }}>
                    <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Leaderboard</h3>
                    <div style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '0.5fr 2fr 1fr', gap: '0.25rem', padding: '0.5rem', borderBottom: '1px solid #333', color: '#888' }}>
                            <span>#</span>
                            <span>Player</span>
                            <span>Score</span>
                        </div>
                        {leaderboard.map((entry, i) => {
                            const shortAddr = `${entry.address.slice(0, 6)}...${entry.address.slice(-4)}`
                            const isMe = address && entry.address.toLowerCase() === address.toLowerCase()
                            return (
                                <div key={entry.address} style={{
                                    display: 'grid',
                                    gridTemplateColumns: '0.5fr 2fr 1fr',
                                    gap: '0.25rem',
                                    padding: '0.5rem',
                                    borderBottom: '1px solid #222',
                                    backgroundColor: isMe ? 'rgba(234, 179, 8, 0.1)' : undefined,
                                }}>
                                    <span style={{ color: i === 0 ? '#eab308' : i === 1 ? '#94a3b8' : i === 2 ? '#cd7c32' : '#888' }}>
                                        {i + 1}
                                    </span>
                                    <span style={{ color: isMe ? '#eab308' : '#e2e8f0' }}>
                                        {shortAddr} {isMe ? '(you)' : ''}
                                    </span>
                                    <span style={{ color: '#4ade80', fontWeight: 'bold' }}>{entry.score} pts</span>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {/* Speed log */}
            {!isFullscreen && txLogs.length > 0 && (
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
