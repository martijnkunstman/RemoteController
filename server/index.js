import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const httpServer = createServer(app)

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
})

const isProd = process.env.NODE_ENV === 'production'

if (isProd) {
  const distPath = join(__dirname, '../dist')
  app.use(express.static(distPath))
  app.get('*', (req, res) => {
    res.sendFile(join(distPath, 'index.html'))
  })
}

// joystickId -> socket.id (for cleanup)
const joystickMap = new Map()   // socket.id -> joystickId (number)
const usedNumbers = new Set()

function nextNumber() {
  let n = 1
  while (usedNumbers.has(n)) n++
  usedNumbers.add(n)
  return n
}

function joystickList() {
  return [...joystickMap.values()].sort((a, b) => a - b)
}

io.on('connection', (socket) => {
  console.log(`[+] Client connected: ${socket.id}`)

  // Send current list to every new connection (display needs initial state)
  socket.emit('joystick-list', joystickList())

  socket.on('register-joystick', () => {
    if (joystickMap.has(socket.id)) return   // already registered
    const id = nextNumber()
    joystickMap.set(socket.id, id)
    socket.emit('joystick-assigned', { id })
    io.emit('joystick-list', joystickList())
    console.log(`[J] Joystick #${String(id).padStart(2, '0')} registered (${socket.id})`)
  })

  socket.on('joystick-move', (data) => {
    const joystickId = joystickMap.get(socket.id)
    if (joystickId !== undefined) {
      socket.broadcast.emit('dot-move', { ...data, joystickId })
    }
  })

  socket.on('fire', () => {
    const joystickId = joystickMap.get(socket.id)
    if (joystickId !== undefined) {
      socket.broadcast.emit('fire', { joystickId })
    }
  })

  socket.on('disconnect', () => {
    const id = joystickMap.get(socket.id)
    if (id !== undefined) {
      joystickMap.delete(socket.id)
      usedNumbers.delete(id)
      io.emit('joystick-list', joystickList())
      console.log(`[J] Joystick #${String(id).padStart(2, '0')} disconnected`)
    }
    console.log(`[-] Client disconnected: ${socket.id}`)
  })
})

const PORT = process.env.PORT || 3000
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  if (!isProd) {
    console.log('Socket.IO ready — Vite dev server proxies /socket.io here')
  }
})
