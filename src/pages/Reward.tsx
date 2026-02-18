import { useState, useEffect, useRef } from 'react'
import redPacketImg from '../assets/red-packet.png'
import redPacketOpenImg from '../assets/red-packet-open.png'
import WalletModal from '../components/WalletModal'

const COLORS = ['#FFD700', '#FF4444', '#FF9900', '#FF6B6B', '#FFF176', '#FF80AB', '#69F0AE', '#40C4FF']

function randomBetween(a: number, b: number) {
  return a + Math.random() * (b - a)
}

interface LeaderboardEntry {
  address: string
  score: number
}

function calculatePrize(leaderboard: LeaderboardEntry[], myAddress: string): number {
  const rank = leaderboard.findIndex(e => e.address.toLowerCase() === myAddress.toLowerCase()) + 1
  if (rank === 1) return 10
  if (rank === 2) return 2
  if (rank === 3) return 1
  const numParticipants = leaderboard.length
  if (numParticipants <= 0) return 0
  return Math.min(7 / numParticipants, 0.5)
}

interface RewardProps {
  leaderboard: LeaderboardEntry[]
  myAddress: string
  walletPrivateKey: string
  onBackToLobby: () => void
}

export default function Reward({ leaderboard, myAddress, walletPrivateKey, onBackToLobby }: RewardProps) {
  const [opened, setOpened] = useState(false)
  const [showAmount, setShowAmount] = useState(false)
  const [ribbons, setRibbons] = useState<{ id: string }[]>([])
  const [circles, setCircles] = useState<{ id: string }[]>([])
  const [shake, setShake] = useState(false)
  const [walletModalOpen, setWalletModalOpen] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const prize = calculatePrize(leaderboard, myAddress)
  const myRank = leaderboard.findIndex(e => e.address.toLowerCase() === myAddress.toLowerCase()) + 1

  function handleOpen() {
    if (opened) return
    setShake(true)
    setTimeout(() => {
      setShake(false)
      setOpened(true)
      spawnRibbons()
      setTimeout(() => setShowAmount(true), 400)
    }, 400)
  }

  function spawnRibbons() {
    const ribbonCount = 40
    const circleCount = 20
    setRibbons(Array.from({ length: ribbonCount }, (_, i) => ({ id: `r-${Date.now()}-${i}` })))
    setCircles(Array.from({ length: circleCount }, (_, i) => ({ id: `c-${Date.now()}-${i}` })))

    let wave = 0
    intervalRef.current = setInterval(() => {
      wave++
      if (wave >= 3) {
        if (intervalRef.current) clearInterval(intervalRef.current)
        return
      }
      setRibbons(prev => [
        ...prev,
        ...Array.from({ length: 20 }, (_, i) => ({ id: `r-w${wave}-${i}` })),
      ])
      setCircles(prev => [
        ...prev,
        ...Array.from({ length: 10 }, (_, i) => ({ id: `c-w${wave}-${i}` })),
      ])
    }, 700)
  }

  useEffect(() => () => {
    if (intervalRef.current) clearInterval(intervalRef.current)
  }, [])

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100vw',
        background: 'linear-gradient(160deg, #1a0000 0%, #8B0000 50%, #3a0000 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      <style>{`
        @keyframes ribbonFall {
          0%   { transform: translateY(0) rotate(var(--r, 0deg)) scaleX(1);   opacity: 1; }
          70%  { opacity: 1; }
          100% { transform: translateY(110vh) rotate(calc(var(--r, 0deg) + 360deg)) scaleX(0.6); opacity: 0; }
        }
        @keyframes shake {
          0%,100% { transform: translateX(0) rotate(0deg); }
          20%     { transform: translateX(-8px) rotate(-3deg); }
          40%     { transform: translateX(8px) rotate(3deg); }
          60%     { transform: translateX(-6px) rotate(-2deg); }
          80%     { transform: translateX(6px) rotate(2deg); }
        }
        @keyframes popIn {
          0%   { opacity: 0; transform: scale(0.3) translateY(30px); }
          60%  { transform: scale(1.15) translateY(-8px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes glow {
          0%,100% { box-shadow: 0 0 18px 4px rgba(255,215,0,0.7); }
          50%      { box-shadow: 0 0 32px 10px rgba(255,215,0,1); }
        }
        @keyframes buttonPulse {
          0%,100% { transform: translate(-50%, -50%) scale(1);   box-shadow: 0 0 10px 2px rgba(255,215,0,0.8); }
          50%      { transform: translate(-50%, -50%) scale(1.07); box-shadow: 0 0 18px 5px rgba(255,215,0,1); }
        }
        @keyframes shimmer {
          0%   { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes float {
          0%,100% { transform: translateY(0px); }
          50%      { transform: translateY(-12px); }
        }
      `}</style>

      {/* Ribbon particles */}
      {ribbons.map(r => (
        <div
          key={r.id}
          style={{
            position: 'fixed',
            left: `${randomBetween(5, 95)}vw`,
            top: `-${randomBetween(10, 30)}px`,
            width: `${randomBetween(8, 16)}px`,
            height: `${randomBetween(20, 40)}px`,
            background: COLORS[Math.floor(Math.random() * COLORS.length)],
            borderRadius: '3px',
            opacity: 1,
            animation: `ribbonFall ${randomBetween(1.4, 2.8)}s ease-in ${randomBetween(0, 0.8)}s forwards`,
            transform: `rotate(${randomBetween(-45, 45)}deg)`,
            zIndex: 50,
            pointerEvents: 'none',
          }}
        />
      ))}
      {circles.map(c => (
        <div
          key={c.id}
          style={{
            position: 'fixed',
            left: `${randomBetween(5, 95)}vw`,
            top: `-${randomBetween(10, 30)}px`,
            width: `${randomBetween(8, 14)}px`,
            height: `${randomBetween(8, 14)}px`,
            background: COLORS[Math.floor(Math.random() * COLORS.length)],
            borderRadius: '50%',
            opacity: 1,
            animation: `ribbonFall ${randomBetween(1.6, 3.0)}s ease-in ${randomBetween(0, 1.0)}s forwards`,
            zIndex: 50,
            pointerEvents: 'none',
          }}
        />
      ))}

      {/* Title */}
      <h1
        style={{
          color: '#FFD700',
          fontSize: '1.6rem',
          fontWeight: 800,
          letterSpacing: '0.08em',
          marginBottom: '2rem',
          textShadow: '0 0 16px rgba(255,215,0,0.6)',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
        }}
      >
        {opened ? '🎉 Congratulations! 🎉' : '✨ You received a Red Packet! ✨'}
      </h1>

      {/* Rank badge */}
      {myRank > 0 && (
        <div
          style={{
            color: 'rgba(255,215,0,0.7)',
            fontSize: '0.9rem',
            marginBottom: '1.5rem',
            fontFamily: 'system-ui, sans-serif',
            letterSpacing: '0.08em',
          }}
        >
          Rank #{myRank} of {leaderboard.length}
        </div>
      )}

      {/* Packet wrapper */}
      <div
        style={{
          position: 'relative',
          width: 'fit-content',
          animation: shake
            ? 'shake 0.4s ease'
            : 'float 3s ease-in-out infinite',
          cursor: opened ? 'default' : 'pointer',
        }}
        onClick={handleOpen}
      >
        <img
          src={opened ? redPacketOpenImg : redPacketImg}
          alt="red packet"
          style={{
            width: '260px',
            maxWidth: '80vw',
            display: 'block',
            transition: 'opacity 0.3s',
            filter: opened ? 'drop-shadow(0 0 24px rgba(255,215,0,0.5))' : 'none',
          }}
        />

        {/* Open button */}
        {!opened && (
          <button
            style={{
              position: 'absolute',
              top: '30%',
              left: '52.5%',
              transform: 'translate(-50%, -50%)',
              background: 'linear-gradient(135deg, #FFE566 0%, #FFD700 50%, #FFA800 100%)',
              border: 'none',
              borderRadius: '50px',
              padding: '11px 28px',
              fontSize: '1rem',
              fontWeight: 800,
              color: '#8B0000',
              cursor: 'pointer',
              animation: 'buttonPulse 1.4s ease-in-out infinite',
              letterSpacing: '0.05em',
              fontFamily: 'system-ui, sans-serif',
              whiteSpace: 'nowrap',
              zIndex: 2,
            }}
            onClick={e => { e.stopPropagation(); handleOpen() }}
          >
            Open
          </button>
        )}
      </div>

      {/* Amount reveal */}
      {showAmount && (
        <div
          style={{
            marginTop: '2rem',
            animation: 'popIn 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              background: 'linear-gradient(90deg, #FFD700, #FFF9C4, #FFD700)',
              backgroundSize: '200% auto',
              animation: 'shimmer 2s linear infinite',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontSize: '3.5rem',
              fontWeight: 900,
              fontFamily: 'system-ui, sans-serif',
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}
          >
            ${prize.toFixed(2)}
          </div>
          <div
            style={{
              color: 'rgba(255,215,0,0.7)',
              fontSize: '0.95rem',
              marginTop: '0.5rem',
              fontFamily: 'system-ui, sans-serif',
              letterSpacing: '0.08em',
            }}
          >
            WON
          </div>

          {/* Export wallet button */}
          <button
            onClick={() => setWalletModalOpen(true)}
            style={{
              marginTop: '1.5rem',
              background: 'linear-gradient(135deg, #FFE566 0%, #FFD700 50%, #FFA800 100%)',
              border: 'none',
              borderRadius: '16px',
              padding: '12px 32px',
              fontSize: '0.95rem',
              fontWeight: 800,
              color: '#8B0000',
              cursor: 'pointer',
              letterSpacing: '0.05em',
              fontFamily: 'system-ui, sans-serif',
              boxShadow: '0 0 16px rgba(255,215,0,0.4)',
            }}
          >
            EXPORT WALLET TO CLAIM
          </button>
        </div>
      )}

      {/* Tap hint */}
      {!opened && (
        <p
          style={{
            color: 'rgba(255,215,0,0.5)',
            marginTop: '1.8rem',
            fontSize: '0.85rem',
            fontFamily: 'system-ui, sans-serif',
            letterSpacing: '0.1em',
          }}
        >
          tap to open
        </p>
      )}

      {/* Back to lobby button */}
      <button
        onClick={onBackToLobby}
        style={{
          marginTop: '1.5rem',
          background: 'transparent',
          border: '1px solid rgba(255,215,0,0.4)',
          borderRadius: '16px',
          padding: '10px 28px',
          fontSize: '0.85rem',
          fontWeight: 700,
          color: 'rgba(255,215,0,0.7)',
          cursor: 'pointer',
          letterSpacing: '0.05em',
          fontFamily: 'system-ui, sans-serif',
          zIndex: 10,
        }}
      >
        BACK TO LOBBY
      </button>

      {/* Wallet modal */}
      <WalletModal
        wallet={{ address: myAddress, privateKey: walletPrivateKey }}
        isOpen={walletModalOpen}
        onOpenChange={setWalletModalOpen}
      />
    </div>
  )
}
