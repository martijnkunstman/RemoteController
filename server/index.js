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

io.on('connection', (socket) => {
  console.log(`[+] Client connected: ${socket.id}`)

  socket.on('joystick-move', (data) => {
    socket.broadcast.emit('dot-move', data)
  })

  socket.on('disconnect', () => {
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
