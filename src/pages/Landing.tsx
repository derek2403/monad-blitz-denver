import { useState, useEffect, useRef } from 'react'
import { Wallet, JsonRpcProvider } from 'ethers'
import {
  Button,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Input,
  Checkbox,
  useDisclosure,
} from '@heroui/react'
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
  const [wallet, setWallet] = useState<{ address: string; privateKey: string } | null>(null)
  const { isOpen, onOpen, onOpenChange } = useDisclosure()
  const [showPrivateKey, setShowPrivateKey] = useState(false)
  const [storedSafely, setStoredSafely] = useState(false)
  const [understandPrizes, setUnderstandPrizes] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [countdown, setCountdown] = useState(3)

  useEffect(() => {
    const existing = loadWallet()
    if (existing) setWallet(existing)
  }, [])

  const handlePlay = () => {
    if (!wallet) {
      const w = createWallet()
      setWallet(w)
    }
    onOpen()
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Start countdown when confirm modal opens
  useEffect(() => {
    if (!showConfirm) {
      setCountdown(3)
      setGenerating(false)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }
    setGenerating(true)
    setCountdown(3)
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!)
          timerRef.current = null
          setGenerating(false)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [showConfirm])

  const handleConfirmGenerate = () => {
    const w = createWallet()
    setWallet(w)
    setStoredSafely(false)
    setUnderstandPrizes(false)
    setShowPrivateKey(false)
    setShowConfirm(false)
  }

  const handleBackFromConfirm = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setGenerating(false)
    setCountdown(3)
    setShowConfirm(false)
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
          The Fastest PVP Ball Game{' '}
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

      {/* Wallet Modal */}
      <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
        <ModalContent>
          {() => (
            <>
              <ModalHeader className="flex flex-col gap-1" style={{ fontFamily: "'Britti Sans', sans-serif" }}>
                Your Burner Wallet
                <span className="text-small font-normal text-default-500" style={{ fontFamily: "'Inter', sans-serif" }}>It will be prefunded, just enjoy the game!</span>
              </ModalHeader>
              <ModalBody>
                <div className="flex flex-col gap-4">
                  <Input
                    isReadOnly
                    label="Wallet Address"
                    value={wallet?.address ?? ''}
                    classNames={{ input: "font-mono", label: "font-sans" }}
                    style={{ fontFamily: "'Roboto Mono', monospace" }}
                    endContent={
                      <button
                        type="button"
                        className="focus:outline-none"
                        onClick={() => copyToClipboard(wallet?.address ?? '')}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-default-400 hover:text-default-600"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                      </button>
                    }
                  />

                  <Input
                    isReadOnly
                    label="Private Key"
                    value={wallet?.privateKey ?? ''}
                    type={showPrivateKey ? 'text' : 'password'}
                    classNames={{ input: "font-mono", label: "font-sans" }}
                    style={{ fontFamily: "'Roboto Mono', monospace" }}
                    endContent={
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="focus:outline-none"
                          onClick={() => setShowPrivateKey(!showPrivateKey)}
                        >
                          {showPrivateKey ? (
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-default-400 hover:text-default-600"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" x2="23" y1="1" y2="23"/></svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-default-400 hover:text-default-600"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                          )}
                        </button>
                        <button
                          type="button"
                          className="focus:outline-none"
                          onClick={() => copyToClipboard(wallet?.privateKey ?? '')}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-default-400 hover:text-default-600"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </button>
                      </div>
                    }
                  />

                  <Checkbox
                    isSelected={storedSafely}
                    onValueChange={setStoredSafely}
                    classNames={{ label: 'text-small' }}
                    style={{ fontFamily: "'Inter', sans-serif" }}
                  >
                    I have stored my private key safely
                  </Checkbox>

                  <Checkbox
                    isSelected={understandPrizes}
                    onValueChange={setUnderstandPrizes}
                    classNames={{ label: 'text-small' }}
                    style={{ fontFamily: "'Inter', sans-serif" }}
                  >
                    I understand that prizes will be sent to this burner wallet, so I will keep it safely
                  </Checkbox>
                </div>
              </ModalBody>
              <ModalFooter>
                <Button
                  className="bg-red-500 text-white"
                  style={{ fontFamily: "'Roboto Mono', monospace" }}
                  onPress={() => setShowConfirm(true)}
                >
                  Create New Wallet
                </Button>
                <Button
                  color="primary"
                  isDisabled={!storedSafely || !understandPrizes}
                  style={{ fontFamily: "'Roboto Mono', monospace" }}
                  onPress={() => {
                    // TODO: proceed to game
                  }}
                >
                  Continue
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Confirm New Wallet Modal */}
      <Modal isOpen={showConfirm} onOpenChange={(open) => { if (!open) handleBackFromConfirm() }}>
        <ModalContent>
          {() => (
            <>
              <ModalHeader style={{ fontFamily: "'Britti Sans', sans-serif" }}>Generate New Wallet?</ModalHeader>
              <ModalBody>
                <p className="text-default-600" style={{ fontFamily: "'Inter', sans-serif" }}>
                  This will replace your current burner wallet with a brand new one. Make sure you have saved your current private key if needed.
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="bordered" style={{ fontFamily: "'Roboto Mono', monospace" }} onPress={handleBackFromConfirm}>
                  Back
                </Button>
                <Button
                  color="danger"
                  isDisabled={generating}
                  style={{ fontFamily: "'Roboto Mono', monospace" }}
                  onPress={handleConfirmGenerate}
                >
                  {generating ? `Wait (${countdown}s)` : 'OK, Generate'}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  )
}
