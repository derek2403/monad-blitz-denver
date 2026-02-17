import { useState, useEffect, useCallback } from 'react'
import { Wallet, JsonRpcProvider, formatEther, Contract, WebSocketProvider, Interface } from 'ethers'

const MONAD_RPC_URL = 'https://monad-testnet.g.alchemy.com/v2/6U7t79S89NhHIspqDQ7oKGRWp5ZOfsNj'
const MONAD_WS_URL = 'wss://monad-testnet.g.alchemy.com/v2/6U7t79S89NhHIspqDQ7oKGRWp5ZOfsNj'
const BALLGAME_ADDRESS = '0xcd03Cf204057882d3E54142D0E17322F77f6Cc4C'
const STORAGE_KEY = 'monad-ballgame-burner-key'
const CHAIN_ID = 10143
const ENV_PRIVATE_KEY = import.meta.env.VITE_PRIVATE_KEY as string | undefined

const BALLGAME_ABI = [
  'function currentGameId() view returns (uint256)',
  'function isGameActive() view returns (bool)',
  'event GameStarted(uint256 indexed gameId, uint256 startTime, uint16[50] xs, uint16[50] ys, uint8[50] ballTypes)',
]

const rpcProvider = new JsonRpcProvider(MONAD_RPC_URL)

interface LobbyProps {
  onGameStart: (wallet: Wallet) => void
}

export default function Lobby({ onGameStart }: LobbyProps) {
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [balance, setBalance] = useState<string | null>(null)
  const [status, setStatus] = useState('Creating your burner wallet...')
  const [waitingForGame, setWaitingForGame] = useState(false)

  // Create or load burner wallet on mount
  useEffect(() => {
    let w: Wallet
    const existing = localStorage.getItem(STORAGE_KEY)
    if (existing) {
      w = new Wallet(existing, rpcProvider)
      setStatus('Burner wallet loaded')
    } else {
      const fresh = Wallet.createRandom()
      localStorage.setItem(STORAGE_KEY, fresh.privateKey)
      w = new Wallet(fresh.privateKey, rpcProvider)
      setStatus('Burner wallet created!')
    }
    setWallet(w)

    // Fund if env key available
    if (ENV_PRIVATE_KEY) {
      ;(async () => {
        try {
          setStatus('Funding your wallet...')
          const funder = new Wallet(ENV_PRIVATE_KEY, rpcProvider)
          const [nonce, feeData] = await Promise.all([
            rpcProvider.getTransactionCount(funder.address, 'pending'),
            rpcProvider.getFeeData(),
          ])
          const signedTx = await funder.signTransaction({
            to: w.address,
            value: 1000000000000000000n,
            nonce,
            gasLimit: 21000n,
            maxFeePerGas: feeData.maxFeePerGas ?? 50000000000n,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 2000000000n,
            chainId: CHAIN_ID,
            type: 2,
          })
          await rpcProvider.send('eth_sendRawTransaction', [signedTx])
          // Poll for balance
          for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 250))
            const bal = await rpcProvider.getBalance(w.address)
            if (bal > 0n) {
              setBalance(formatEther(bal))
              setStatus('Wallet funded! Waiting for admin to start game...')
              break
            }
          }
        } catch {
          setStatus('Auto-fund failed. Send MON manually to your address.')
        }
      })()
    } else {
      setStatus('Wallet ready. Send MON to your address, then wait for admin to start.')
    }
  }, [])

  // Fetch balance periodically
  useEffect(() => {
    if (!wallet) return
    const fetch = async () => {
      try {
        const bal = await rpcProvider.getBalance(wallet.address)
        setBalance(formatEther(bal))
      } catch { /* ignore */ }
    }
    fetch()
    const id = setInterval(fetch, 5000)
    return () => clearInterval(id)
  }, [wallet])

  // Listen for GameStarted event via WebSocket
  useEffect(() => {
    if (!wallet) return
    let destroyed = false
    let wsProvider: WebSocketProvider | null = null

    const listen = async () => {
      try {
        wsProvider = new WebSocketProvider(MONAD_WS_URL)
        await wsProvider.ready
        if (destroyed) { wsProvider.destroy(); return }

        setWaitingForGame(true)

        const contract = new Contract(BALLGAME_ADDRESS, BALLGAME_ABI, wsProvider)
        contract.on('GameStarted', () => {
          if (!destroyed) onGameStart(wallet)
        })

        // Also check if a game is already active
        const readContract = new Contract(BALLGAME_ADDRESS, BALLGAME_ABI, rpcProvider)
        const active = await readContract.isGameActive()
        if (active && !destroyed) {
          onGameStart(wallet)
        }
      } catch (err) {
        console.error('WS failed in lobby:', err)
      }
    }

    listen()
    return () => {
      destroyed = true
      wsProvider?.destroy()
    }
  }, [wallet, onGameStart])

  const shortAddr = wallet ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}` : ''

  return (
    <div className="relative w-screen h-screen bg-[#0a0a1a] overflow-hidden select-none flex">
      {/* Left side: Lobby info */}
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        <div className="max-w-md w-full flex flex-col items-center gap-6">
          <h1 className="text-4xl font-bold font-mono text-center">
            <span className="text-yellow-400">Game</span>{' '}
            <span className="text-purple-400">Lobby</span>
          </h1>

          {/* Wallet card */}
          <div className="w-full bg-black/40 border border-white/10 rounded-2xl p-6 backdrop-blur-md">
            <div className="text-[10px] font-semibold tracking-[0.18em] uppercase text-gray-400 mb-3">Your Burner Wallet</div>
            <div className="text-white/80 text-sm font-mono break-all bg-black/30 rounded-lg p-3 mb-4">
              {wallet?.address ?? 'Loading...'}
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-xs">Balance</span>
              <span className="text-green-400 font-mono font-bold text-lg">
                {balance ? `${parseFloat(balance).toFixed(4)} MON` : '...'}
              </span>
            </div>
          </div>

          {/* Status */}
          <div className="text-center">
            <p className="text-gray-300 text-sm">{status}</p>
            {waitingForGame && (
              <div className="mt-4 flex items-center justify-center gap-2">
                <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                <span className="text-yellow-400 text-sm font-semibold">Waiting for admin to start the game...</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right side: Rules image */}
      <div className="w-[400px] flex items-center justify-center p-8 border-l border-white/5">
        <div className="w-full h-full rounded-2xl overflow-hidden bg-black/30 border border-white/10 flex items-center justify-center">
          <img
            src="/rules.png"
            alt="Game Rules"
            className="w-full h-full object-contain p-4"
            onError={(e) => {
              // Fallback if rules.png doesn't exist yet
              const target = e.target as HTMLImageElement
              target.style.display = 'none'
              target.parentElement!.innerHTML = `
                <div class="text-center p-8">
                  <div class="text-2xl mb-4">📋</div>
                  <h3 class="text-white font-bold text-lg mb-4">Game Rules</h3>
                  <div class="text-gray-400 text-sm text-left space-y-2">
                    <p>🔵 Normal balls = +1 point</p>
                    <p>⭐ Special balls = +3 points</p>
                    <p>💣 Bomb balls = -5 points</p>
                    <p>⏱ Click fast to claim balls!</p>
                    <p>🏆 Top scorers win prizes!</p>
                  </div>
                </div>
              `
            }}
          />
        </div>
      </div>
    </div>
  )
}
