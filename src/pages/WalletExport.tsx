import { useState, useEffect, useRef } from 'react'
import { Wallet, JsonRpcProvider } from 'ethers'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  Card,
  CardBody,
  Chip,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Tooltip,
  useDisclosure,
} from '@heroui/react'

// --- SVG Icons ---
const CopyIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
)
const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)
const EyeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)
const EyeOffIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
)
const WalletIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12V7H5a2 2 0 010-4h14v4" />
    <path d="M3 5v14a2 2 0 002 2h16v-5" />
    <path d="M18 12a2 2 0 100 4h4v-4z" />
  </svg>
)
const ShieldIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
)
const AlertIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
)
const ArrowLeftIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
)
const PlusIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)
const KeyIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </svg>
)

const STORAGE_KEY = 'monad-ballgame-burner-key'
const MONAD_RPC_URL = 'https://monad-testnet.g.alchemy.com/v2/6U7t79S89NhHIspqDQ7oKGRWp5ZOfsNj'
const rpcProvider = new JsonRpcProvider(MONAD_RPC_URL)

function loadWallet(): { address: string; privateKey: string } | null {
  const pk = localStorage.getItem(STORAGE_KEY)
  if (!pk) return null
  const w = new Wallet(pk, rpcProvider)
  return { address: w.address, privateKey: w.privateKey }
}

function generateWallet(): { address: string; privateKey: string } {
  const w = Wallet.createRandom()
  localStorage.setItem(STORAGE_KEY, w.privateKey)
  return { address: w.address, privateKey: w.privateKey }
}

export default function WalletExport() {
  const navigate = useNavigate()
  const { isOpen, onOpen, onClose } = useDisclosure()
  const [wallet, setWallet] = useState<{ address: string; privateKey: string } | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)
  const [copiedAddr, setCopiedAddr] = useState(false)
  const [justGenerated, setJustGenerated] = useState(false)
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

  const handleGenerateClick = () => {
    if (wallet) {
      onOpen()
    } else {
      doGenerate()
    }
  }

  const handleConfirmGenerate = () => {
    onClose()
    setCountdown(3)

    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current)
          countdownRef.current = null
          doGenerate()
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  const doGenerate = () => {
    const w = generateWallet()
    setWallet(w)
    setRevealed(false)
    setJustGenerated(true)
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
    <div className="relative w-screen h-screen bg-[#0a0a1a] overflow-hidden select-none flex flex-col items-center justify-center px-8">
      {/* Confirmation Modal */}
      <Modal isOpen={isOpen} onClose={onClose} backdrop="blur" classNames={{
        base: 'bg-[#141428] border border-red-500/30',
        header: 'border-b border-white/5',
        footer: 'border-t border-white/5',
      }}>
        <ModalContent>
          <ModalHeader className="flex flex-col items-center gap-2 pt-6">
            <div className="text-red-400">
              <AlertIcon />
            </div>
            <span className="text-white font-bold text-lg">Are you sure?</span>
          </ModalHeader>
          <ModalBody className="text-center px-6">
            <p className="text-gray-400 text-sm">
              Generating a new account will replace your current wallet. If you have won any prizes, you will{' '}
              <span className="text-red-400 font-semibold">lose access to those funds</span>{' '}
              unless you have saved your private key.
            </p>
          </ModalBody>
          <ModalFooter className="flex gap-3 px-6 pb-6">
            <Button
              variant="bordered"
              className="flex-1 border-white/10 text-white"
              onPress={onClose}
            >
              GO BACK
            </Button>
            <Button
              color="danger"
              className="flex-1 font-bold"
              onPress={handleConfirmGenerate}
            >
              CONFIRM
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Countdown overlay */}
      {countdown > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="flex flex-col items-center gap-4">
            <div className="text-7xl font-bold font-mono text-yellow-400 animate-pulse">
              {countdown}
            </div>
            <p className="text-gray-400 text-sm">Generating new account...</p>
          </div>
        </div>
      )}

      <div className="flex flex-col items-center gap-5 max-w-md w-full">
        <Chip variant="flat" size="sm" classNames={{ base: 'bg-white/5', content: 'text-gray-400 text-[10px] font-semibold tracking-[0.25em] uppercase' }}>
          <span className="flex items-center gap-1.5"><WalletIcon /> Wallet</span>
        </Chip>
        <h1 className="text-4xl font-bold font-mono text-purple-400">YOUR ACCOUNT</h1>

        {!wallet ? (
          <>
            <p className="text-gray-400 text-sm text-center">
              Generate a new account to get started. No funding needed — if you win, prizes will be sent directly to this wallet.
            </p>
            <Button
              color="warning"
              size="lg"
              className="font-bold text-black px-10"
              startContent={<PlusIcon />}
              onPress={handleGenerateClick}
            >
              GENERATE NEW ACCOUNT
            </Button>
          </>
        ) : (
          <>
            {justGenerated && (
              <Card classNames={{ base: 'w-full bg-green-500/10 border border-green-400/30' }}>
                <CardBody className="text-center py-3 px-4">
                  <p className="text-green-400 text-sm font-semibold mb-1">Account created!</p>
                  <p className="text-gray-400 text-xs">
                    This is your burner wallet. No funding needed — if you win, prizes will be sent directly here.
                  </p>
                </CardBody>
              </Card>
            )}

            {/* Address */}
            <Card classNames={{ base: 'w-full bg-black/30 border border-white/10 backdrop-blur-md' }}>
              <CardBody className="gap-2 p-4">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-xs uppercase tracking-widest flex items-center gap-1.5">
                    <WalletIcon /> Wallet Address
                  </span>
                  <Tooltip content={copiedAddr ? 'Copied!' : 'Copy address'} placement="top">
                    <Button
                      isIconOnly
                      size="sm"
                      variant="flat"
                      className="bg-purple-600 text-white min-w-8 h-7"
                      onPress={() => copyToClipboard(wallet.address, 'addr')}
                    >
                      {copiedAddr ? <CheckIcon /> : <CopyIcon />}
                    </Button>
                  </Tooltip>
                </div>
                <div className="text-white/80 text-xs font-mono break-all bg-black/30 rounded-lg p-3">
                  {wallet.address}
                </div>
              </CardBody>
            </Card>

            {/* Private Key */}
            <Card classNames={{ base: 'w-full bg-black/30 border border-white/10 backdrop-blur-md' }}>
              <CardBody className="gap-2 p-4">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-xs uppercase tracking-widest flex items-center gap-1.5">
                    <KeyIcon /> Private Key
                  </span>
                  <div className="flex gap-1.5">
                    <Tooltip content={revealed ? 'Hide key' : 'Reveal key'} placement="top">
                      <Button
                        isIconOnly
                        size="sm"
                        variant="flat"
                        className="bg-white/10 text-white min-w-8 h-7"
                        onPress={() => setRevealed(!revealed)}
                      >
                        {revealed ? <EyeOffIcon /> : <EyeIcon />}
                      </Button>
                    </Tooltip>
                    <Tooltip content={copiedKey ? 'Copied!' : 'Copy key'} placement="top">
                      <Button
                        isIconOnly
                        size="sm"
                        variant="flat"
                        className="bg-purple-600 text-white min-w-8 h-7"
                        onPress={() => copyToClipboard(wallet.privateKey, 'key')}
                      >
                        {copiedKey ? <CheckIcon /> : <CopyIcon />}
                      </Button>
                    </Tooltip>
                  </div>
                </div>
                <div className="text-xs font-mono break-all bg-black/30 rounded-lg p-3">
                  {revealed ? (
                    <span className="text-yellow-400">{wallet.privateKey}</span>
                  ) : (
                    <span className="text-white/40">{'*'.repeat(66)}</span>
                  )}
                </div>
              </CardBody>
            </Card>

            {/* Warning */}
            <Card classNames={{ base: 'w-full bg-red-500/10 border border-red-500/30' }}>
              <CardBody className="py-2.5 px-4 flex-row items-center gap-2 justify-center">
                <span className="text-red-400"><ShieldIcon /></span>
                <p className="text-red-400 text-xs font-semibold">
                  Keep your private key safe! Never share it publicly.
                </p>
              </CardBody>
            </Card>

            {/* Generate new */}
            <Button
              color="warning"
              className="font-bold text-black px-8"
              startContent={<PlusIcon />}
              onPress={handleGenerateClick}
            >
              GENERATE NEW ACCOUNT
            </Button>
          </>
        )}

        <Button
          variant="bordered"
          className="border-white/10 text-white"
          startContent={<ArrowLeftIcon />}
          onPress={() => navigate('/Landing')}
        >
          BACK TO HOME
        </Button>
      </div>
    </div>
  )
}
