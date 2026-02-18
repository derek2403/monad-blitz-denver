import { useState, useEffect, useRef } from 'react'
import { Wallet, JsonRpcProvider } from 'ethers'
import { Form, Input, Checkbox, Button } from '@heroui/react'
import Ballpit from '../components/Ballpit'

const STORAGE_KEY = 'monad-ballgame-burner-key'
const MONAD_RPC_URL = 'https://monad-testnet.g.alchemy.com/v2/6U7t79S89NhHIspqDQ7oKGRWp5ZOfsNj'
const rpcProvider = new JsonRpcProvider(MONAD_RPC_URL)

function loadWallet(): { address: string; privateKey: string } | null {
  const pk = localStorage.getItem(STORAGE_KEY)
  if (!pk) return null
  const w = new Wallet(pk, rpcProvider)
  return { address: w.address, privateKey: w.privateKey }
}

function createWallet(): { address: string; privateKey: string } {
  const w = Wallet.createRandom()
  localStorage.setItem(STORAGE_KEY, w.privateKey)
  return { address: w.address, privateKey: w.privateKey }
}

interface LandingProps {
  onAdmin: () => void
}

export default function Landing({ onAdmin }: LandingProps) {
  const [walletOpen, setWalletOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [wallet, setWallet] = useState<{ address: string; privateKey: string } | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)
  const [copiedAddr, setCopiedAddr] = useState(false)
  const [savedKey, setSavedKey] = useState(false)
  const [understandPrizes, setUnderstandPrizes] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [countdown, setCountdown] = useState(0)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const existing = loadWallet()
    if (existing) setWallet(existing)
  }, [])

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [])

  const handlePlay = () => {
    if (!wallet) {
      const w = createWallet()
      setWallet(w)
    }
    setWalletOpen(true)
  }

  const handleRegenerate = () => {
    setConfirmOpen(true)
  }

  const handleConfirmRegenerate = () => {
    setConfirmOpen(false)
    setCountdown(3)
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current)
          countdownRef.current = null
          const w = createWallet()
          setWallet(w)
          setRevealed(false)
          setSavedKey(false)
          setUnderstandPrizes(false)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  const copyToClipboard = async (text: string, type: 'key' | 'addr') => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    if (type === 'key') {
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 2000)
    } else {
      setCopiedAddr(true)
      setTimeout(() => setCopiedAddr(false), 2000)
    }
  }

  return (
    <div className="relative w-screen h-screen bg-white overflow-hidden select-none flex flex-col items-center justify-center">
      {/* Ballpit background */}
      <div className="absolute inset-0 z-0">
        <Ballpit
          count={40}
          gravity={0.5}
          friction={0.9975}
          wallBounce={0.95}
          followCursor={true}
          colors={[0x6E54FF, 0x85E6FF, 0xFF8EE4, 0xFFAE45]}
        />
      </div>

      {/* Confirm regenerate overlay */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Are you sure?</h3>
            <p className="text-sm text-gray-500 mb-6">
              Generating a new wallet will replace your current one. If you have won any prizes, you will{' '}
              <span className="text-red-500 font-medium">lose access to those funds</span>{' '}
              unless you have saved your private key.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmOpen(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Go Back
              </button>
              <button
                onClick={handleConfirmRegenerate}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 text-sm font-medium text-white hover:bg-red-600 transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Countdown overlay */}
      {countdown > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="text-7xl font-bold font-mono animate-pulse" style={{ color: '#6E54FF' }}>
              {countdown}
            </div>
            <p className="text-gray-400 text-sm">Generating new wallet...</p>
          </div>
        </div>
      )}

      {/* Wallet modal */}
      {walletOpen && wallet && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-2">
              <h2 className="text-xl font-bold text-gray-900">Your Burner Wallet</h2>
              <button
                onClick={() => setWalletOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <Form
              className="px-6 pb-6 pt-2"
              validationErrors={errors}
              onSubmit={(e) => {
                e.preventDefault()
                const newErrors: Record<string, string> = {}
                if (!savedKey) newErrors.savedKey = 'Please confirm you saved your private key'
                if (!understandPrizes) newErrors.understandPrizes = 'Please confirm you understand'
                if (Object.keys(newErrors).length > 0) {
                  setErrors(newErrors)
                  return
                }
                setErrors({})
                setWalletOpen(false)
              }}
            >
              <div className="flex flex-col gap-6 w-full">
                <Input
                  isReadOnly
                  label="Wallet Address"
                  labelPlacement="outside"
                  value={wallet.address}
                  variant="bordered"
                  classNames={{ input: 'font-mono text-sm' }}
                  endContent={
                    <button
                      type="button"
                      onClick={() => copyToClipboard(wallet.address, 'addr')}
                      className="shrink-0 text-gray-400 hover:text-gray-700 transition-colors"
                    >
                      {copiedAddr ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                      )}
                    </button>
                  }
                  description={copiedAddr ? 'Copied to clipboard!' : undefined}
                />

                <Input
                  isReadOnly
                  label="Private Key"
                  labelPlacement="outside"
                  value={revealed ? wallet.privateKey : '\u2022'.repeat(40)}
                  variant="bordered"
                  classNames={{ input: 'font-mono text-sm' }}
                  endContent={
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setRevealed(r => !r)}
                        className="shrink-0 text-gray-400 hover:text-gray-700 transition-colors"
                      >
                        {revealed ? (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(wallet.privateKey, 'key')}
                        className="shrink-0 text-gray-400 hover:text-gray-700 transition-colors"
                      >
                        {copiedKey ? (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                        )}
                      </button>
                    </div>
                  }
                  description={copiedKey ? 'Copied to clipboard!' : undefined}
                />

                <p className="text-sm text-gray-500">
                  This wallet will be transferred with gas fee so you can play.
                </p>

                <Checkbox
                  isRequired
                  classNames={{ label: 'text-small' }}
                  isSelected={savedKey}
                  onValueChange={setSavedKey}
                  isInvalid={!!errors.savedKey}
                  name="savedKey"
                >
                  I have saved my private key safely
                </Checkbox>

                <Checkbox
                  isRequired
                  classNames={{ label: 'text-small' }}
                  isSelected={understandPrizes}
                  onValueChange={setUnderstandPrizes}
                  isInvalid={!!errors.understandPrizes}
                  name="understandPrizes"
                >
                  I understand prizes will be sent to this wallet, so I will keep my private key safe
                </Checkbox>

                <div className="flex items-center gap-4 pt-2">
                  <Button
                    type="button"
                    variant="bordered"
                    onPress={handleRegenerate}
                    className="flex items-center gap-2 px-6 py-6 rounded-2xl border border-red-200 text-sm font-bold text-red-500 bg-white hover:bg-red-50 shadow-lg shadow-red-500/20 hover:shadow-red-500/40"
                    style={{ fontFamily: "'Roboto Mono', monospace" }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
                    Regenerate
                  </Button>
                  <Button
                    type="submit"
                    isDisabled={!savedKey || !understandPrizes}
                    className="flex-1 px-6 py-6 rounded-2xl text-sm font-bold text-white shadow-lg shadow-[#6E54FF]/30 hover:shadow-[#6E54FF]/50"
                    style={{ fontFamily: "'Roboto Mono', monospace", backgroundColor: '#6E54FF' }}
                  >
                    Continue
                  </Button>
                </div>
              </div>
            </Form>
          </div>
        </div>
      )}

      <div className="relative z-10 flex flex-col items-center gap-8">
        {/* Headline */}
        <h1
          className="text-7xl font-bold italic text-center leading-tight tracking-tight"
          style={{
            fontFamily: "'Britti Sans', sans-serif",
            background: 'linear-gradient(90deg, #6E54FF 0%, #85E6FF 25%, #FF8EE4 50%, #FFAE45 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          The Fastest Ball Game{' '}
          <svg className="inline-block align-baseline" style={{ height: '0.75em', marginBottom: '-0.02em' }} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M39.6349 0C28.1892 0 0 28.4481 0 39.9998C0 51.5514 28.1892 80 39.6349 80C51.0805 80 79.2702 51.551 79.2702 39.9998C79.2702 28.4486 51.081 0 39.6349 0ZM33.4584 62.873C28.6319 61.5457 15.6554 38.6374 16.9708 33.7664C18.2863 28.8952 40.985 15.7995 45.8115 17.127C50.6383 18.4543 63.6148 41.3622 62.2994 46.2334C60.9839 51.1046 38.2849 64.2006 33.4584 62.873Z" fill="#6E54FF"/>
          </svg>
          nchain
        </h1>

        {/* Built on Monad */}
        <div className="flex items-center gap-2.5 mt-2">
          <span className="text-gray-400 text-sm tracking-widest uppercase" style={{ fontFamily: "'Inter', sans-serif" }}>
            Only Possible On
          </span>
          <img src="/Wordmark Black.svg" alt="Monad" className="h-5" />
        </div>

        {/* Play button */}
        <Button
          size="lg"
          className="mt-4 text-lg font-bold px-14 py-7 rounded-2xl text-white shadow-lg shadow-[#6E54FF]/30 hover:shadow-[#6E54FF]/50"
          style={{
            fontFamily: "'Roboto Mono', monospace",
            backgroundColor: '#6E54FF',
          }}
          onPress={handlePlay}
        >
          PLAY
        </Button>

        {/* Admin link (hidden) */}
        <button
          onClick={onAdmin}
          className="mt-4 opacity-0 text-xs cursor-default"
          aria-hidden="true"
        >
          Admin Panel
        </button>
      </div>
    </div>
  )
}
