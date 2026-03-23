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

// ─── Server-authoritative vehicle physics ─────────────────────────────────────
const MOVE_SPEED   = 6
const ROT_SPEED    = 2
const HALF         = 25
const MARGIN       = 0.9
const PALETTE_SIZE = 8

const vehicleStates = new Map()   // joystickId → {x, y, z, yaw}
const vehicleInputs = new Map()   // joystickId → {moveX, moveY, lookX, lookY}

// ─── Collision geometry (must match firstpersonview.js / display.js) ──────────
const VEHICLE_R    = 0.8
const PILLAR_R     = 1.5
const PILLAR_BUMP  = PILLAR_R + VEHICLE_R               // min XZ center-to-center
const PILLAR_POS   = [[14, 14], [14, -14], [-14, 14], [-14, -14]]

const TOWER_Y_MIN  = -HALF                              // -25 (floor)
const TOWER_Y_MAX  = -HALF + 9                          // -16 (top of tower)
const TOWER_BOXES  = [
  { xMin: -7,    xMax: 7,    zMin: -0.75, zMax: 0.75 }, // towerA (along X)
  { xMin: -0.75, xMax: 0.75, zMin: -7,    zMax: 7    }, // towerB (along Z)
]

function resolvePillars(state) {
  for (const [px, pz] of PILLAR_POS) {
    const dx   = state.x - px
    const dz   = state.z - pz
    const dist = Math.sqrt(dx * dx + dz * dz)
    if (dist < PILLAR_BUMP && dist > 0) {
      const push = (PILLAR_BUMP - dist) / dist
      state.x += dx * push
      state.z += dz * push
    }
  }
}

function resolveTower(state) {
  // Tower only occupies the bottom portion of the arena
  if (state.y + VEHICLE_R < TOWER_Y_MIN || state.y - VEHICLE_R > TOWER_Y_MAX) return
  for (const box of TOWER_BOXES) {
    const cx   = Math.max(box.xMin, Math.min(box.xMax, state.x))
    const cz   = Math.max(box.zMin, Math.min(box.zMax, state.z))
    const dx   = state.x - cx
    const dz   = state.z - cz
    const dist = Math.sqrt(dx * dx + dz * dz)
    if (dist < VEHICLE_R && dist > 0) {
      const push = (VEHICLE_R - dist) / dist
      state.x += dx * push
      state.z += dz * push
    }
  }
}

function nextNumber() {
  let n = 1
  while (usedNumbers.has(n)) n++
  usedNumbers.add(n)
  return n
}

function joystickList() {
  return [...joystickMap.values()].sort((a, b) => a - b)
}

// Physics loop — server owns positions, broadcasts to all clients
let lastPhysicsTime = Date.now()
setInterval(() => {
  const now = Date.now()
  const dt  = Math.min((now - lastPhysicsTime) / 1000, 0.05)
  lastPhysicsTime = now

  for (const [id, state] of vehicleStates) {
    const inp = vehicleInputs.get(id) || { moveX: 0, moveY: 0, lookX: 0, lookY: 0 }

    const fwdX =  Math.sin(state.yaw)
    const fwdZ =  Math.cos(state.yaw)
    const rtX  =  Math.cos(state.yaw)
    const rtZ  = -Math.sin(state.yaw)

    state.x   += (inp.moveY * fwdX + inp.moveX * rtX) * MOVE_SPEED * dt
    state.z   += (inp.moveY * fwdZ + inp.moveX * rtZ) * MOVE_SPEED * dt
    state.y   +=  inp.lookY * MOVE_SPEED * dt
    state.yaw +=  inp.lookX * ROT_SPEED  * dt

    state.x = Math.max(-HALF + MARGIN, Math.min(HALF - MARGIN, state.x))
    state.y = Math.max(-HALF + MARGIN, Math.min(HALF - MARGIN, state.y))
    state.z = Math.max(-HALF + MARGIN, Math.min(HALF - MARGIN, state.z))

    resolvePillars(state)
    resolveTower(state)

    io.emit('vehicle-state', { joystickId: id, x: state.x, y: state.y, z: state.z, yaw: state.yaw })
  }
}, 16)

io.on('connection', (socket) => {
  console.log(`[+] Client connected: ${socket.id}`)

  // Send current list to every new connection (display needs initial state)
  socket.emit('joystick-list', joystickList())

  socket.on('register-joystick', () => {
    if (joystickMap.has(socket.id)) return   // already registered
    const id = nextNumber()
    joystickMap.set(socket.id, id)
    const angle = ((id - 1) / PALETTE_SIZE) * Math.PI * 2
    vehicleStates.set(id, { x: Math.sin(angle) * 3, y: 0, z: Math.cos(angle) * 3, yaw: angle + Math.PI })
    vehicleInputs.set(id, { moveX: 0, moveY: 0, lookX: 0, lookY: 0 })
    socket.emit('joystick-assigned', { id })
    io.emit('joystick-list', joystickList())
    console.log(`[J] Joystick #${String(id).padStart(2, '0')} registered (${socket.id})`)
  })

  socket.on('joystick-input', (data) => {
    const joystickId = joystickMap.get(socket.id)
    if (joystickId !== undefined) {
      vehicleInputs.set(joystickId, {
        moveX: data.moveX ?? 0,
        moveY: data.moveY ?? 0,
        lookX: data.lookX ?? 0,
        lookY: data.lookY ?? 0,
      })
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
      vehicleStates.delete(id)
      vehicleInputs.delete(id)
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
