import { useState } from 'react'
import './App.css'
import Counter from './Counter'
import BallGame from './Test'

type Page = 'counter' | 'ballgame'

function App() {
  const [page, setPage] = useState<Page>('ballgame')

  return (
    <div>
      <nav style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '1rem',
        padding: '1rem',
        borderBottom: '1px solid #333',
        marginBottom: '1rem',
      }}>
        <button
          onClick={() => setPage('counter')}
          style={{
            padding: '0.5em 1.5em',
            borderBottom: page === 'counter' ? '2px solid #646cff' : '2px solid transparent',
            borderRadius: '4px 4px 0 0',
            opacity: page === 'counter' ? 1 : 0.6,
          }}
        >
          Counter
        </button>
        <button
          onClick={() => setPage('ballgame')}
          style={{
            padding: '0.5em 1.5em',
            borderBottom: page === 'ballgame' ? '2px solid #646cff' : '2px solid transparent',
            borderRadius: '4px 4px 0 0',
            opacity: page === 'ballgame' ? 1 : 0.6,
          }}
        >
          Ball Game
        </button>
      </nav>

      {page === 'counter' ? <Counter /> : <BallGame />}
    </div>
  )
}

export default App
