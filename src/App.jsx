import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Game from './components/Game/Game'
import RedPacket from './components/RedPacket/RedPacket'
import Rules from './components/Rules/Rules'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Game />} />
        <Route path="/redpacket" element={<RedPacket />} />
        <Route path="/rule" element={<Rules />} />
      </Routes>
    </BrowserRouter>
  )
}
