import { useState, useEffect } from 'react'
import { Wallet, JsonRpcProvider, formatEther, Contract, WebSocketProvider } from 'ethers'
import WalletChip from '../components/WalletChip'
import WalletModal from '../components/WalletModal'

const MONAD_RPC_URL = 'https://monad-testnet.g.alchemy.com/v2/6U7t79S89NhHIspqDQ7oKGRWp5ZOfsNj'
const MONAD_WS_URL = 'wss://monad-testnet.g.alchemy.com/v2/6U7t79S89NhHIspqDQ7oKGRWp5ZOfsNj'
const BALLGAME_ADDRESS = '0xE17722A663E72f876baFe1F73dE6e6e02358Ba65'
const STORAGE_KEY = 'monad-ballgame-burner-key'
const CHAIN_ID = 10143
const ENV_PRIVATE_KEY = import.meta.env.VITE_PRIVATE_KEY as string | undefined

const BALLGAME_ABI = [
  'function currentGameId() view returns (uint256)',
  'function isGameActive() view returns (bool)',
  'event GameStarted(uint256 indexed gameId, uint256 startTime, uint16[50] xs, uint16[50] ys, uint8[50] ballTypes)',
  'event GameEnded(uint256 indexed gameId, address endedBy)',
]

const rpcProvider = new JsonRpcProvider(MONAD_RPC_URL)

const BRACKET = 18

const COINS = [
  { img: '/icons/monad.png', sub: 'MON', pts: '+3', x: 10, delay: 0,   dur: 2.9, size: 62 },
  { img: '/icons/btc.png',   sub: 'BTC',   pts: '+1', x: 28, delay: 0.7, dur: 3.3, size: 52 },
  { img: '/icons/eth.png',   sub: 'ETH',   pts: '+1', x: 48, delay: 1.3, dur: 2.7, size: 52 },
  { img: '/icons/monad.png', sub: 'MONAD', pts: '+3', x: 68, delay: 0.3, dur: 3.1, size: 62 },
  { img: '/icons/ftx.png',   sub: 'FTX',   pts: '–5', x: 84, delay: 1.9, dur: 2.5, size: 48 },
  { img: '/icons/terra.png', sub: 'LUNA',  pts: '–5', x: 18, delay: 2.3, dur: 3.0, size: 48 },
  { img: '/icons/btc.png',   sub: 'BTC',   pts: '+1', x: 58, delay: 0.5, dur: 2.8, size: 52 },
  { img: '/icons/monad.png', sub: 'MONAD', pts: '+3', x: 38, delay: 1.8, dur: 3.2, size: 62 },
  { img: '/icons/eth.png',   sub: 'ETH',   pts: '+1', x: 76, delay: 2.6, dur: 2.9, size: 52 },
  { img: '/icons/ftx.png',   sub: 'FTX',   pts: '–5', x: 5,  delay: 1.1, dur: 2.6, size: 48 },
  { img: '/icons/monad.png', sub: 'MONAD', pts: '+3', x: 91, delay: 0.9, dur: 3.4, size: 62 },
  { img: '/icons/btc.png',   sub: 'BTC',   pts: '+1', x: 22, delay: 2.9, dur: 2.7, size: 52 },
  { img: '/icons/terra.png', sub: 'LUNA',  pts: '–5', x: 43, delay: 0.2, dur: 3.0, size: 48 },
  { img: '/icons/eth.png',   sub: 'ETH',   pts: '+1', x: 63, delay: 1.6, dur: 2.5, size: 52 },
]

function Corner({ top, left, right, bottom }: { top?: number; left?: number; right?: number; bottom?: number }) {
  const style: React.CSSProperties = {
    position: 'absolute',
    width: 24, height: 24,
    ...(top    != null ? { top }    : {}),
    ...(left   != null ? { left }   : {}),
    ...(right  != null ? { right }  : {}),
    ...(bottom != null ? { bottom } : {}),
  }
  const h: React.CSSProperties = { position: 'absolute', height: 2, width: BRACKET, background: '#111' }
  const v: React.CSSProperties = { position: 'absolute', width: 2, height: BRACKET, background: '#111' }
  return (
    <div style={style}>
      <div style={{ ...h, top: 0, left: 0 }} />
      <div style={{ ...v, top: 0, left: 0 }} />
    </div>
  )
}

interface LobbyProps {
  onGameStart: (wallet: Wallet) => void
}

export default function Lobby({ onGameStart }: LobbyProps) {
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [balance, setBalance] = useState<string | null>(null)
  const [status, setStatus] = useState('Creating your burner wallet...')
  const [waitingForGame, setWaitingForGame] = useState(false)
  const [walletModalOpen, setWalletModalOpen] = useState(false)

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
      ; (async () => {
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
              setStatus('')
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

  return (
    <div style={{
      minHeight: '100vh',
      width: '100vw',
      background: '#fff',
      display: 'grid',
      gridTemplateColumns: '52% 48%',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      overflow: 'hidden',
    }}>
      <style>{`
        @keyframes coinFall {
          0%   { transform: translateY(-90px) rotate(0deg) scale(0.8); opacity: 0; }
          8%   { opacity: 1; }
          88%  { opacity: 1; }
          100% { transform: translateY(105vh) rotate(540deg) scale(1); opacity: 0; }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .rule-row { animation: fadeUp 0.5s ease both; }
        .rule-row:nth-child(1) { animation-delay: 0.05s; }
        .rule-row:nth-child(2) { animation-delay: 0.15s; }
        .rule-row:nth-child(3) { animation-delay: 0.25s; }
        @keyframes spin {
          0%   { transform: rotate(0deg); }
          25%  { transform: rotate(90deg); }
          100% { transform: rotate(90deg); }
        }
      `}</style>

      {/* ── LEFT PANEL ── */}
      <div style={{
        padding: '3rem 3.5rem',
        borderRight: '1px solid #e5e7eb',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'auto',
      }}>
        {/* Wallet chip — top right */}
        <div style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', zIndex: 20 }}>
          <WalletChip address={wallet?.address ?? ''} onPress={() => setWalletModalOpen(true)} />
        </div>

        <p style={{ fontFamily: "'Roboto Mono', monospace", fontSize: '0.75rem', letterSpacing: '0.18em', color: '#9ca3af', marginBottom: '1.2rem' }}>
          // GAME RULES
        </p>

        <h1 style={{ fontFamily: "'Britti Sans', sans-serif", fontSize: '3.8rem', fontWeight: 900, lineHeight: 1.05, margin: '0 0 1.4rem', letterSpacing: '-0.04em', color: '#0a0a0a' }}>
          Click & Win.
        </h1>

        <p style={{ fontFamily: "'Inter', sans-serif", color: '#6b7280', fontSize: '1rem', lineHeight: 1.75, margin: '0 0 2rem', maxWidth: '380px' }}>
          Tap the right coins, rack up points, and walk away with real money. Fast, simple, addictive.
        </p>

        {/* Numbered rules */}
        <div style={{ borderTop: '1px solid #e5e7eb', marginBottom: '2rem' }}>
          {[
            ['01', 'CLICK AS MANY COINS AS POSSIBLE'],
            ['02', 'MORE COINS = MORE POINTS'],
            ['03', 'MORE POINTS = MORE MONEY'],
          ].map(([num, text]) => (
            <div key={num} className="rule-row" style={{
              display: 'flex', alignItems: 'center', gap: '1rem',
              padding: '0.9rem 0', borderBottom: '1px solid #e5e7eb',
            }}>
              <span style={{ fontFamily: "'Roboto Mono', monospace", fontSize: '0.8rem', color: '#d1d5db', minWidth: '22px' }}>{num}</span>
              <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
              <span style={{ fontFamily: "'Inter', sans-serif", fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.1em', color: '#111' }}>{text}</span>
            </div>
          ))}
        </div>

        {/* Tips row */}
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
          {['⚡ Click fast', '🚫 Avoid bad coins', '🤑 Earn money'].map(tip => (
            <span key={tip} style={{
              fontFamily: "'Inter', sans-serif", fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.06em',
              background: '#0a0a0a', color: '#fff',
              borderRadius: '999px', padding: '0.35rem 0.9rem',
            }}>{tip}</span>
          ))}
        </div>

        {/* Waiting for game */}
        {waitingForGame && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', marginTop: '1rem' }}>
            <span style={{ color: '#0a0a0a', fontSize: '1.8rem', fontWeight: 900, fontFamily: "'Britti Sans', sans-serif", letterSpacing: '-0.02em' }}>
              Waiting for admin to start the game
            </span>
            <img
              src="/Logomark.svg"
              alt="Loading"
              style={{
                width: 36,
                height: 36,
                animation: 'spin 2s linear infinite',
              }}
            />
          </div>
        )}
      </div>

      {/* ── RIGHT PANEL ── */}
      <div style={{
        position: 'relative',
        overflow: 'hidden',
        background: '#fafafa',
        backgroundImage: 'radial-gradient(circle, #d1d5db 1px, transparent 1px)',
        backgroundSize: '26px 26px',
      }}>
        {/* Corner brackets */}
        <Corner top={20} left={20} />
        <div style={{ position: 'absolute', top: 20, right: 20, width: 24, height: 24 }}>
          <div style={{ position: 'absolute', top: 0, right: 0, width: BRACKET, height: 2, background: '#111' }} />
          <div style={{ position: 'absolute', top: 0, right: 0, width: 2, height: BRACKET, background: '#111' }} />
        </div>
        <div style={{ position: 'absolute', bottom: 20, left: 20, width: 24, height: 24 }}>
          <div style={{ position: 'absolute', bottom: 0, left: 0, width: BRACKET, height: 2, background: '#111' }} />
          <div style={{ position: 'absolute', bottom: 0, left: 0, width: 2, height: BRACKET, background: '#111' }} />
        </div>
        <div style={{ position: 'absolute', bottom: 20, right: 20, width: 24, height: 24 }}>
          <div style={{ position: 'absolute', bottom: 0, right: 0, width: BRACKET, height: 2, background: '#111' }} />
          <div style={{ position: 'absolute', bottom: 0, right: 0, width: 2, height: BRACKET, background: '#111' }} />
        </div>

        {/* Labels */}
        <p style={{ position: 'absolute', top: 24, right: 50, fontFamily: "'Roboto Mono', monospace", fontSize: '0.7rem', letterSpacing: '0.12em', color: '#9ca3af', margin: 0 }}>
          // 001
        </p>
        <p style={{ position: 'absolute', bottom: 24, left: 50, fontFamily: "'Roboto Mono', monospace", fontSize: '0.7rem', letterSpacing: '0.12em', color: '#9ca3af', margin: 0 }}>
          // COLLECT
        </p>

        {/* Center glow blob */}
        <div style={{
          position: 'absolute',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 240, height: 240,
          background: 'radial-gradient(circle, rgba(131,110,249,0.15) 0%, transparent 70%)',
          borderRadius: '50%',
          pointerEvents: 'none',
        }} />

        {/* Points overlay card */}
        <div style={{
          position: 'absolute',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10,
          width: '80%',
          background: 'rgba(255,255,255,0.72)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          borderRadius: '20px',
          border: '1px solid rgba(255,255,255,0.9)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.10)',
          padding: '1.6rem 1.8rem',
        }}>
          <p style={{ fontFamily: "'Roboto Mono', monospace", fontSize: '0.72rem', letterSpacing: '0.18em', color: '#9ca3af', margin: '0 0 1.2rem' }}>
            // POINTS SYSTEM
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
            {/* Level 1: MONAD */}
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem',
              background: 'rgba(250,245,255,0.85)', borderRadius: '14px', border: '1px solid #e9d5ff',
              padding: '0.8rem 1.4rem', width: '100%',
            }}>
              <img src="/icons/monad.png" alt="MONAD" style={{ width: 48, height: 48, borderRadius: '50%' }} />
              <span style={{ fontFamily: "'Inter', sans-serif", fontWeight: 800, fontSize: '0.9rem', color: '#111' }}>MON</span>
              <span style={{ fontWeight: 800, fontSize: '1rem', color: '#7c3aed', fontFamily: "'Roboto Mono', monospace" }}>+ 3 pts</span>
            </div>
            {/* Level 2: BTC & ETH */}
            <div style={{ display: 'flex', gap: '0.6rem', width: '100%' }}>
              {[
                { name: 'BTC', icon: '/icons/btc.png' },
                { name: 'ETH', icon: '/icons/eth.png' },
              ].map(c => (
                <div key={c.name} style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem',
                  background: 'rgba(250,245,255,0.85)', borderRadius: '14px', border: '1px solid #e9d5ff',
                  padding: '0.7rem 0.6rem',
                }}>
                  <img src={c.icon} alt={c.name} style={{ width: 40, height: 40, borderRadius: '50%' }} />
                  <span style={{ fontFamily: "'Inter', sans-serif", fontWeight: 800, fontSize: '0.82rem', color: '#111' }}>{c.name}</span>
                  <span style={{ fontWeight: 800, fontSize: '0.9rem', color: '#7c3aed', fontFamily: "'Roboto Mono', monospace" }}>+ 1 pt</span>
                </div>
              ))}
            </div>
            {/* Level 3: FTX & LUNA */}
            <div style={{ display: 'flex', gap: '0.6rem', width: '100%' }}>
              {[
                { name: 'FTX', icon: '/icons/ftx.png' },
                { name: 'LUNA', icon: '/icons/terra.png' },
              ].map(c => (
                <div key={c.name} style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem',
                  background: 'rgba(255,241,242,0.85)', borderRadius: '14px', border: '1px solid #fecdd3',
                  padding: '0.7rem 0.6rem',
                }}>
                  <img src={c.icon} alt={c.name} style={{ width: 40, height: 40, borderRadius: '50%' }} />
                  <span style={{ fontFamily: "'Inter', sans-serif", fontWeight: 800, fontSize: '0.82rem', color: '#111' }}>{c.name}</span>
                  <span style={{ fontWeight: 800, fontSize: '0.9rem', color: '#dc2626', fontFamily: "'Roboto Mono', monospace" }}>– 5 pts</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Falling coins */}
        {COINS.map((c, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: `${c.x}%`,
            top: 0,
            width: c.size,
            height: c.size,
            animation: `coinFall ${c.dur}s ease-in ${c.delay}s infinite`,
            pointerEvents: 'none',
            zIndex: 1,
          }}>
            <img src={c.img} alt={c.sub} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
          </div>
        ))}
      </div>

      {/* Wallet modal (no checkboxes) */}
      <WalletModal
        wallet={wallet ? { address: wallet.address, privateKey: wallet.privateKey } : null}
        isOpen={walletModalOpen}
        onOpenChange={setWalletModalOpen}
      />
    </div>
  )
}
