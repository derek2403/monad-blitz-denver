import { useState, useEffect, useCallback, useRef } from 'react'
import { JsonRpcProvider, BrowserProvider, Wallet, Contract, Interface, WebSocketProvider, formatEther, Signer } from 'ethers'

const COUNTER_ADDRESS = '0x7B60257377bC34F12E451DE2e9eBe7Fc99974c5b'

const COUNTER_ABI = [
  'function x() view returns (uint256)',
  'function inc()',
  'function incBy(uint256 by)',
  'event Increment(uint256 by)',
]

const COUNTER_IFACE = new Interface(COUNTER_ABI)
const CHAIN_ID = 10143

const MONAD_RPC_URL = 'https://monad-testnet.g.alchemy.com/v2/p3LF9TmoLQFqlPs6DcFxH'
const MONAD_WS_URL = 'wss://monad-testnet.g.alchemy.com/v2/p3LF9TmoLQFqlPs6DcFxH'
const MONAD_TESTNET_CHAIN_ID = '0x279F'

const STORAGE_KEY = 'monad-counter-burner-key'
const MODE_KEY = 'monad-counter-mode'

type WalletMode = 'none' | 'burner' | 'metamask' | 'auto'

const ENV_PRIVATE_KEY = import.meta.env.VITE_PRIVATE_KEY as string | undefined

interface TxLog {
  action: string
  wallet: string
  txSentAt: number
  txConfirmedAt: number | null
  wsEventAt: number | null
}

interface CachedTxParams {
  nonce: number
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
}

// single shared provider + read contract (optimization #3)
const rpcProvider = new JsonRpcProvider(MONAD_RPC_URL)
const readContract = new Contract(COUNTER_ADDRESS, COUNTER_ABI, rpcProvider)

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

function Counter() {
  const [count, setCount] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [incByValue, setIncByValue] = useState('1')
  const [status, setStatus] = useState('')
  const [wsConnected, setWsConnected] = useState(false)
  const [balance, setBalance] = useState<string | null>(null)
  const [txLogs, setTxLogs] = useState<TxLog[]>([])
  const wsProviderRef = useRef<WebSocketProvider | null>(null)
  const pendingTxRef = useRef<TxLog | null>(null)
  const cachedParamsRef = useRef<CachedTxParams | null>(null)

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

  const fetchCount = useCallback(async () => {
    try {
      const value = await readContract.x()
      setCount(value.toString())
    } catch (err) {
      console.error('Failed to fetch count:', err)
    }
  }, [])

  useEffect(() => { fetchCount() }, [fetchCount])
  useEffect(() => { if (address) fetchBalance() }, [address, fetchBalance])

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

  // WebSocket listener — this is the primary "mined" signal (optimization #2)
  useEffect(() => {
    let destroyed = false

    const setupWs = async () => {
      try {
        const wsProvider = new WebSocketProvider(MONAD_WS_URL)
        wsProviderRef.current = wsProvider

        await wsProvider.ready
        if (destroyed) { wsProvider.destroy(); return }
        setWsConnected(true)

        const contract = new Contract(COUNTER_ADDRESS, COUNTER_ABI, wsProvider)
        contract.on('Increment', (by) => {
          const wsEventAt = performance.now()
          console.log(`Live: Increment(${by}) at ${wsEventAt.toFixed(0)}ms`)

          // optimistic counter update — no extra RPC read needed (#4)
          setCount(prev => prev !== null ? (BigInt(prev) + BigInt(by)).toString() : prev)

          if (pendingTxRef.current) {
            const pending = pendingTxRef.current
            const log = { ...pending, wsEventAt }
            pendingTxRef.current = null
            setTxLogs(prev => [log, ...prev].slice(0, 10))
            // show mined time from WS — the real speed
            setStatus(`${pending.action} mined: ${((wsEventAt - pending.txSentAt) / 1000).toFixed(3)}s`)
          } else {
            setTxLogs(prev => [{
              action: `ext incBy(${by})`,
              wallet: 'external',
              txSentAt: wsEventAt,
              txConfirmedAt: null,
              wsEventAt,
            }, ...prev].slice(0, 10))
          }

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
  }, [fetchBalance])

  // --- raw tx: sign locally, 1 RPC call ---
  const sendRawTx = async (action: string, data: string) => {
    const wallet = getDirectWallet()
    if (!wallet || !cachedParamsRef.current) {
      throw new Error('Wallet or cached params not ready')
    }

    const params = cachedParamsRef.current

    // sign locally — zero RPC calls
    const signedTx = await wallet.signTransaction({
      to: COUNTER_ADDRESS,
      data,
      nonce: params.nonce,
      gasLimit: 100000n,
      maxFeePerGas: params.maxFeePerGas,
      maxPriorityFeePerGas: params.maxPriorityFeePerGas,
      chainId: CHAIN_ID,
      type: 2,
    })

    // bump local nonce immediately
    params.nonce++

    // start timing RIGHT BEFORE the single RPC call
    const txSentAt = performance.now()
    const log: TxLog = { action, wallet: address ?? 'unknown', txSentAt, txConfirmedAt: null, wsEventAt: null }
    pendingTxRef.current = log

    // ONE RPC call — don't await receipt, WS event is our "mined" signal
    rpcProvider.send('eth_sendRawTransaction', [signedTx]).then(() => {
      const txConfirmedAt = performance.now()
      log.txConfirmedAt = txConfirmedAt
      // if WS already fired, update the existing log
      if (!pendingTxRef.current) {
        setTxLogs(prev => {
          const updated = [...prev]
          if (updated[0] && updated[0].action === log.action && updated[0].txConfirmedAt === null) {
            updated[0] = { ...updated[0], txConfirmedAt }
          }
          return updated
        })
      }
    }).catch((err) => {
      pendingTxRef.current = null
      setStatus(`${action} failed: ${err}`)
      refreshCachedParams()
    })
  }

  // --- MetaMask tx: use WS waitForTransaction instead of polling tx.wait() (#1) ---
  const sendMetamaskTx = async (action: string, callFn: (contract: Contract) => Promise<{ hash: string }>) => {
    setStatus('Sign the transaction...')
    const signer = await getSigner()
    const contract = new Contract(COUNTER_ADDRESS, COUNTER_ABI, signer)
    const tx = await callFn(contract)

    // start timing AFTER tx is signed & broadcast
    const txSentAt = performance.now()
    const log: TxLog = { action, wallet: address ?? 'unknown', txSentAt, txConfirmedAt: null, wsEventAt: null }
    pendingTxRef.current = log
    setStatus('TX submitted, waiting...')

    // use WS provider for confirmation — much faster than polling tx.wait()
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
    setStatus(`${action} — confirmed: ${((txConfirmedAt - txSentAt) / 1000).toFixed(2)}s`)
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
        value: 1000000000000000000n, // 1 MON
        nonce,
        gasLimit: 21000n,
        maxFeePerGas: feeData.maxFeePerGas ?? 50000000000n,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 2000000000n,
        chainId: CHAIN_ID,
        type: 2,
      })
      await rpcProvider.send('eth_sendRawTransaction', [signedTx])
      // wait for confirmation via WS
      const ws = wsProviderRef.current
      if (ws) {
        // poll balance until it arrives (WS won't emit an event for simple transfers)
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
      }
      setStatus('Burner funded with 0.005 MON!')
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

  // --- tx actions ---

  const callInc = async () => {
    setLoading(true)
    try {
      if (mode === 'auto' || mode === 'burner') {
        const data = COUNTER_IFACE.encodeFunctionData('inc')
        await sendRawTx('inc()', data)
      } else {
        await sendMetamaskTx('inc()', (c) => c.inc())
      }
    } catch (err) {
      pendingTxRef.current = null
      setStatus(`inc() failed: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  const callIncBy = async () => {
    const val = parseInt(incByValue)
    if (!val || val <= 0) {
      setStatus('Value must be a positive number')
      return
    }
    setLoading(true)
    try {
      if (mode === 'auto' || mode === 'burner') {
        const data = COUNTER_IFACE.encodeFunctionData('incBy', [val])
        await sendRawTx(`incBy(${val})`, data)
      } else {
        await sendMetamaskTx(`incBy(${val})`, (c) => c.incBy(val))
      }
    } catch (err) {
      pendingTxRef.current = null
      setStatus(`incBy() failed: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  const hasBalance = balance !== null && parseFloat(balance) > 0

  return (
    <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
      <h1>Monad Counter</h1>
      <p style={{ color: '#888', fontSize: '0.85rem' }}>
        Contract: <code>{COUNTER_ADDRESS}</code>
      </p>
      <p style={{ fontSize: '0.75rem', color: wsConnected ? '#4ade80' : '#f87171' }}>
        {wsConnected ? 'Live updates via WebSocket' : 'WebSocket disconnected'}
      </p>

      {/* Wallet selection */}
      <div style={{ margin: '1rem 0', padding: '1rem', borderRadius: '8px', border: '1px solid #333' }}>
        {mode === 'none' ? (
          <>
            <p style={{ fontSize: '0.85rem', color: '#888', margin: '0 0 1rem' }}>
              Choose a wallet to start transacting
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
                Send testnet MON to the address above to start transacting
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

      {/* Counter display */}
      <div style={{ margin: '2rem 0' }}>
        <h2 style={{ fontSize: '4rem', margin: '0.5rem 0' }}>{count ?? '...'}</h2>
        <p style={{ color: '#888' }}>Current counter value</p>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button onClick={callInc} disabled={loading || !isConnected || !hasBalance}>
          inc()
        </button>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          <input
            type="number"
            min="1"
            value={incByValue}
            onChange={(e) => setIncByValue(e.target.value)}
            style={{ width: '60px', padding: '0.5em', borderRadius: '8px', border: '1px solid #444', textAlign: 'center' }}
          />
          <button onClick={callIncBy} disabled={loading || !isConnected || !hasBalance}>
            incBy()
          </button>
        </div>
        <button onClick={fetchCount} disabled={loading}>
          Refresh
        </button>
      </div>

      {status && (
        <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: '#aaa' }}>{status}</p>
      )}

      {/* Speed log */}
      {txLogs.length > 0 && (
        <div style={{ marginTop: '2rem', textAlign: 'left' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Speed Log</h3>
          <div style={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 1fr 1fr', gap: '0.25rem', padding: '0.5rem', borderBottom: '1px solid #333', color: '#888' }}>
              <span>Action</span>
              <span>Wallet</span>
              <span>RPC Response</span>
              <span>WS Event</span>
            </div>
            {txLogs.map((log, i) => {
              const confirmMs = log.txConfirmedAt ? ((log.txConfirmedAt - log.txSentAt) / 1000).toFixed(3) : '—'
              const wsMs = log.wsEventAt ? ((log.wsEventAt - log.txSentAt) / 1000).toFixed(3) : '—'
              const shortWallet = log.wallet.length > 10 ? `${log.wallet.slice(0, 6)}...${log.wallet.slice(-4)}` : log.wallet
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 1fr 1fr', gap: '0.25rem', padding: '0.5rem', borderBottom: '1px solid #222' }}>
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

export default Counter
