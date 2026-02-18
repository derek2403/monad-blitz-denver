import { useState } from 'react'
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Input,
  Checkbox,
  Button,
} from '@heroui/react'

interface WalletInfo {
  address: string
  privateKey: string
}

interface WalletModalProps {
  wallet: WalletInfo | null
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** Show checkboxes + Create New Wallet / Continue footer (landing mode) */
  showCheckboxes?: boolean
  onCreateNewWallet?: () => void
  onContinue?: () => void
}

export default function WalletModal({
  wallet,
  isOpen,
  onOpenChange,
  showCheckboxes = false,
  onCreateNewWallet,
  onContinue,
}: WalletModalProps) {
  const [showPrivateKey, setShowPrivateKey] = useState(false)
  const [storedSafely, setStoredSafely] = useState(false)
  const [understandPrizes, setUnderstandPrizes] = useState(false)

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader className="flex flex-col gap-1" style={{ fontFamily: "'Britti Sans', sans-serif" }}>
              <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', letterSpacing: '0.18em', color: '#9ca3af', fontWeight: 400 }}>
                // YOUR BURNER WALLET
              </span>
              <span className="text-small font-normal text-default-500" style={{ fontFamily: "'Inter', sans-serif" }}>
                It will be prefunded, just enjoy the game!
              </span>
            </ModalHeader>
            <ModalBody>
              <div className="flex flex-col gap-4">
                {/* Wallet address */}
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

                {/* Private key */}
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

                {showCheckboxes && (
                  <>
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
                  </>
                )}
              </div>
            </ModalBody>
            <ModalFooter>
              {showCheckboxes ? (
                <>
                  <Button
                    className="bg-red-500 text-white"
                    style={{ fontFamily: "'Roboto Mono', monospace" }}
                    onPress={onCreateNewWallet}
                  >
                    Create New Wallet
                  </Button>
                  <Button
                    color="primary"
                    isDisabled={!storedSafely || !understandPrizes}
                    style={{ fontFamily: "'Roboto Mono', monospace" }}
                    onPress={onContinue}
                  >
                    Continue
                  </Button>
                </>
              ) : (
                <>
                  {onCreateNewWallet && (
                    <Button
                      className="bg-red-500 text-white"
                      style={{ fontFamily: "'Roboto Mono', monospace" }}
                      onPress={onCreateNewWallet}
                    >
                      Create New Wallet
                    </Button>
                  )}
                  <Button
                    variant="bordered"
                    style={{ fontFamily: "'Roboto Mono', monospace" }}
                    onPress={onClose}
                  >
                    Close
                  </Button>
                </>
              )}
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}
