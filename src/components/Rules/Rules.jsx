import { useState } from 'react'

const HARDCODED_ADDRESS = '0x6173b42c3e4b8f9a1d2e7c5f8b3a9d4e6173e2b5'
const SHORT_ADDRESS = '0x6173...e2b5'

function WalletButton() {
  const [connected, setConnected] = useState(false)

  if (connected) {
    return (
      <button
        onClick={() => setConnected(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'rgba(255,255,255,0.92)',
          border: '1px solid rgba(0,0,0,0.08)',
          borderRadius: '999px',
          padding: '6px 14px 6px 6px',
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          fontSize: '0.85rem',
          fontWeight: 700,
          color: '#111',
          fontFamily: 'monospace',
        }}
      >
        <img
          src={`https://api.dicebear.com/7.x/pixel-art/svg?seed=${HARDCODED_ADDRESS}`}
          alt="avatar"
          style={{ width: 28, height: 28, borderRadius: '50%', background: '#e5e7eb' }}
        />
        {SHORT_ADDRESS}
      </button>
    )
  }

  return (
    <button
      onClick={() => setConnected(true)}
      style={{
        background: '#fff',
        border: '1px solid rgba(131,110,249,0.5)',
        borderRadius: '999px',
        padding: '8px 18px',
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(131,110,249,0.12)',
        fontSize: '0.85rem',
        fontWeight: 700,
        color: '#6d28d9',
      }}
    >
      Connect Wallet
    </button>
  )
}

const COINS = [
  { icon: '◆', sub: 'MONAD', bg: '#836ef9', pts: '+3', x: 10, delay: 0,   dur: 2.9, size: 62 },
  { icon: '₿', sub: 'BTC',   bg: '#F7931A', pts: '+1', x: 28, delay: 0.7, dur: 3.3, size: 52 },
  { icon: 'Ξ', sub: 'ETH',   bg: '#627EEA', pts: '+1', x: 48, delay: 1.3, dur: 2.7, size: 52 },
  { icon: '◆', sub: 'MONAD', bg: '#836ef9', pts: '+3', x: 68, delay: 0.3, dur: 3.1, size: 62 },
  { icon: '✕', sub: 'FTX',   bg: '#ef4444', pts: '–5', x: 84, delay: 1.9, dur: 2.5, size: 48 },
  { icon: '☽', sub: 'LUNA',  bg: '#ef4444', pts: '–5', x: 18, delay: 2.3, dur: 3.0, size: 48 },
  { icon: '₿', sub: 'BTC',   bg: '#F7931A', pts: '+1', x: 58, delay: 0.5, dur: 2.8, size: 52 },
  { icon: '◆', sub: 'MONAD', bg: '#836ef9', pts: '+3', x: 38, delay: 1.8, dur: 3.2, size: 62 },
  { icon: 'Ξ', sub: 'ETH',   bg: '#627EEA', pts: '+1', x: 76, delay: 2.6, dur: 2.9, size: 52 },
  { icon: '✕', sub: 'FTX',   bg: '#ef4444', pts: '–5', x: 5,  delay: 1.1, dur: 2.6, size: 48 },
  { icon: '◆', sub: 'MONAD', bg: '#836ef9', pts: '+3', x: 91, delay: 0.9, dur: 3.4, size: 62 },
  { icon: '₿', sub: 'BTC',   bg: '#F7931A', pts: '+1', x: 22, delay: 2.9, dur: 2.7, size: 52 },
  { icon: '☽', sub: 'LUNA',  bg: '#ef4444', pts: '–5', x: 43, delay: 0.2, dur: 3.0, size: 48 },
  { icon: 'Ξ', sub: 'ETH',   bg: '#627EEA', pts: '+1', x: 63, delay: 1.6, dur: 2.5, size: 52 },
]

const BRACKET = 18

function Corner({ top, left, right, bottom }) {
  const style = {
    position: 'absolute',
    width: 24, height: 24,
    ...(top    != null ? { top:    top }    : {}),
    ...(left   != null ? { left:   left }   : {}),
    ...(right  != null ? { right:  right }  : {}),
    ...(bottom != null ? { bottom: bottom } : {}),
  }
  const h = { position: 'absolute', height: 2, width: BRACKET, background: '#111' }
  const v = { position: 'absolute', width: 2, height: BRACKET, background: '#111' }
  return (
    <div style={style}>
      <div style={{ ...h, top: 0, left: 0 }} />
      <div style={{ ...v, top: 0, left: 0 }} />
    </div>
  )
}

export default function Rules() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#fff',
      display: 'grid',
      gridTemplateColumns: '52% 48%',
      fontFamily: 'system-ui, -apple-system, sans-serif',
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
        .pts-row { animation: fadeUp 0.5s ease both; }
        .pts-row:nth-child(1) { animation-delay: 0.35s; }
        .pts-row:nth-child(2) { animation-delay: 0.45s; }
        .pts-row:nth-child(3) { animation-delay: 0.55s; }
      `}</style>

      {/* ── LEFT PANEL ── */}
      <div style={{
        padding: '5rem 4rem',
        borderRight: '1px solid #e5e7eb',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        position: 'relative',
      }}>
        <div style={{ position: 'absolute', top: '1.5rem', right: '1.5rem' }}>
          <WalletButton />
        </div>
        <p style={{ fontFamily: 'monospace', fontSize: '0.75rem', letterSpacing: '0.18em', color: '#9ca3af', marginBottom: '1.2rem' }}>
          // GAME RULES
        </p>

        <h1 style={{ fontSize: '3.8rem', fontWeight: 900, lineHeight: 1.05, margin: '0 0 1.4rem', letterSpacing: '-0.04em', color: '#0a0a0a' }}>
          Click & Win.
        </h1>

        <p style={{ color: '#6b7280', fontSize: '1rem', lineHeight: 1.75, margin: '0 0 3rem', maxWidth: '380px' }}>
          Tap the right coins, rack up points, and walk away with real money. Fast, simple, addictive.
        </p>

        {/* Numbered rules */}
        <div style={{ borderTop: '1px solid #e5e7eb', marginBottom: '2.5rem' }}>
          {[
            ['01', 'CLICK AS MANY COINS AS POSSIBLE'],
            ['02', 'MORE COINS = MORE POINTS'],
            ['03', 'MORE POINTS = MORE MONEY'],
          ].map(([num, text]) => (
            <div key={num} className="rule-row" style={{
              display: 'flex', alignItems: 'center', gap: '1rem',
              padding: '0.9rem 0', borderBottom: '1px solid #e5e7eb',
            }}>
              <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#d1d5db', minWidth: '22px' }}>{num}</span>
              <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
              <span style={{ fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.1em', color: '#111' }}>{text}</span>
            </div>
          ))}
        </div>

        {/* Tips row */}
        <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          {['⚡ Click fast', '🚫 Avoid bad coins', '🤑 Earn money'].map(tip => (
            <span key={tip} style={{
              fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.06em',
              background: '#0a0a0a', color: '#fff',
              borderRadius: '999px', padding: '0.35rem 0.9rem',
            }}>{tip}</span>
          ))}
        </div>
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
        <Corner top={20}  left={20}  />
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
        <p style={{ position: 'absolute', top: 24, right: 50, fontFamily: 'monospace', fontSize: '0.7rem', letterSpacing: '0.12em', color: '#9ca3af', margin: 0 }}>
          // 001
        </p>
        <p style={{ position: 'absolute', bottom: 24, left: 50, fontFamily: 'monospace', fontSize: '0.7rem', letterSpacing: '0.12em', color: '#9ca3af', margin: 0 }}>
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
          <p style={{ fontFamily: 'monospace', fontSize: '0.72rem', letterSpacing: '0.18em', color: '#9ca3af', margin: '0 0 1rem' }}>
            // POINTS SYSTEM
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {[
              { coin: 'MONAD',      pts: '+ 3 pts', good: true,  dot: '#836ef9' },
              { coin: 'BTC / ETH',  pts: '+ 1 pt',  good: true,  dot: '#F7931A' },
              { coin: 'FTX / LUNA', pts: '– 5 pts', good: false, dot: '#ef4444' },
            ].map(({ coin, pts, good, dot }) => (
              <div key={coin} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '0.6rem 0.9rem',
                background: good ? 'rgba(250,245,255,0.85)' : 'rgba(255,241,242,0.85)',
                borderRadius: '10px',
                border: `1px solid ${good ? '#e9d5ff' : '#fecdd3'}`,
              }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '0.88rem' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: dot, display: 'inline-block', flexShrink: 0 }} />
                  {coin}
                </span>
                <span style={{ fontWeight: 800, fontSize: '0.88rem', color: good ? '#7c3aed' : '#dc2626', fontFamily: 'monospace' }}>
                  {pts}
                </span>
              </div>
            ))}
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
            borderRadius: '50%',
            background: c.bg,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: `0 4px 20px ${c.bg}66`,
            animation: `coinFall ${c.dur}s ease-in ${c.delay}s infinite`,
            pointerEvents: 'none',
            zIndex: 1,
          }}>
            <span style={{ fontSize: c.size * 0.34, lineHeight: 1, color: '#fff', fontWeight: 900 }}>{c.icon}</span>
            <span style={{ fontSize: c.size * 0.16, color: 'rgba(255,255,255,0.85)', fontWeight: 700, letterSpacing: '0.04em', marginTop: 1 }}>{c.sub}</span>
            <span style={{ fontSize: c.size * 0.17, color: '#fff', fontWeight: 900, fontFamily: 'monospace', marginTop: 1 }}>{c.pts}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
