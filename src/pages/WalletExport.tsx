import { useState, useEffect, useRef } from 'react'
import { Wallet, JsonRpcProvider } from 'ethers'
import {
  Form,
  Input,
  Button,
  Checkbox,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
} from '@heroui/react'

const STORAGE_KEY = 'monad-ballgame-burner-key'
const MONAD_RPC_URL = 'https://monad-testnet.g.alchemy.com/v2/6U7t79S89NhHIspqDQ7oKGRWp5ZOfsNj'
const rpcProvider = new JsonRpcProvider(MONAD_RPC_URL)

function loadWallet(): { address: string; privateKey: string } | null {
  const pk = localStorage.getItem(STORAGE_KEY)
  if (!pk) return null
  const w = new Wallet(pk, rpcProvider)
  return { address: w.address, privateKey: w.privateKey }
}

function generateWalletData(): { address: string; privateKey: string } {
  const w = Wallet.createRandom()
  localStorage.setItem(STORAGE_KEY, w.privateKey)
  return { address: w.address, privateKey: w.privateKey }
}

interface WalletExportProps {
  onDone?: () => void
}

export default function WalletExport({ onDone }: WalletExportProps) {
  const { isOpen, onOpen, onClose } = useDisclosure()
  const [wallet, setWallet] = useState<{ address: string; privateKey: string } | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)
  const [copiedAddr, setCopiedAddr] = useState(false)
  const [savedKey, setSavedKey] = useState(false)
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
    const w = generateWalletData()
    setWallet(w)
    setRevealed(false)
    setSavedKey(false)
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

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onDone?.()
  }

  return (
    <>
      {/* Confirmation Modal */}
      <Modal isOpen={isOpen} onClose={onClose} backdrop="blur">
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">Are you sure?</ModalHeader>
          <ModalBody>
            <p className="text-small text-default-500">
              Generating a new account will replace your current wallet. If you have won any prizes, you will{' '}
              <span className="text-danger font-semibold">lose access to those funds</span>{' '}
              unless you have saved your private key.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="bordered" onPress={onClose}>
              Go Back
            </Button>
            <Button color="danger" onPress={handleConfirmGenerate}>
              Confirm
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Countdown overlay */}
      {countdown > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80">
          <div className="flex flex-col items-center gap-4">
            <div className="text-7xl font-bold font-mono text-primary animate-pulse">
              {countdown}
            </div>
            <p className="text-default-500 text-small">Generating new account...</p>
          </div>
        </div>
      )}

      <Form
        className="w-full justify-center items-center space-y-4"
        onSubmit={onSubmit}
      >
        <div className="flex flex-col gap-4 max-w-md">
          {!wallet ? (
            <>
              <p className="text-small text-default-500 text-center">
                Generate a burner wallet to get started. No funding needed — if you win, prizes are sent directly here.
              </p>
              <Button className="w-full" color="primary" onPress={handleGenerateClick}>
                Generate New Account
              </Button>
            </>
          ) : (
            <>
              <Input
                isReadOnly
                label="Wallet Address"
                labelPlacement="outside"
                name="address"
                value={wallet.address}
                placeholder="Your wallet address"
                description={copiedAddr ? 'Copied to clipboard!' : undefined}
                endContent={
                  <button type="button" className="focus:outline-none" onClick={() => copyToClipboard(wallet.address, 'addr')}>
                    {copiedAddr ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                    )}
                  </button>
                }
              />

              <Input
                isReadOnly
                label="Private Key"
                labelPlacement="outside"
                name="privateKey"
                type={revealed ? 'text' : 'password'}
                value={wallet.privateKey}
                placeholder="Your private key"
                description={copiedKey ? 'Copied to clipboard!' : 'Never share your private key with anyone.'}
                endContent={
                  <div className="flex gap-2">
                    <button type="button" className="focus:outline-none" onClick={() => setRevealed(r => !r)}>
                      {revealed ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      )}
                    </button>
                    <button type="button" className="focus:outline-none" onClick={() => copyToClipboard(wallet.privateKey, 'key')}>
                      {copiedKey ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                      )}
                    </button>
                  </div>
                }
              />

              <Checkbox
                classNames={{
                  label: "text-small",
                }}
                name="savedKey"
                isSelected={savedKey}
                onValueChange={setSavedKey}
              >
                I have saved my private key safely
              </Checkbox>

              <div className="flex gap-4">
                <Button className="w-full" color="primary" type="submit" isDisabled={!savedKey}>
                  Continue
                </Button>
                <Button variant="bordered" onPress={handleGenerateClick}>
                  Regenerate
                </Button>
              </div>
            </>
          )}
        </div>
      </Form>
    </>
  )
}
