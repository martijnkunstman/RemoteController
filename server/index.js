import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { VoxelWorld } from './VoxelWorld.js'
import { BotManager } from './BotManager.js'
import {
  GRID, CELL, HALF, HALF_Y, VEHICLE_R, MOVE_SPEED, ROT_SPEED,
  ZERO_INPUT, TEAMS,
  HIT_RADIUS, HIT_INVINCIBILITY, BULLET_LIFETIME, BULLET_SPEED_SRV,
} from './constants.js'

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
  app.get('*', (_req, res) => {
    res.sendFile(join(distPath, 'index.html'))
  })
}

// ─── GameServer ───────────────────────────────────────────────────────────────
// Orchestrates everything: constructs VoxelWorld and BotManager, owns all game
// state Maps, runs the physics loop, and handles all Socket.IO events.
class GameServer {
  constructor(io) {
    this.io              = io
    this.joystickMap     = new Map()   // socket.id → joystickId
    this.usedNumbers     = new Set()
    this.vehicleStates   = new Map()   // joystickId → {x, y, z, yaw}
    this.vehicleInputs   = new Map()   // joystickId → {moveX, moveY, lookX, lookY}
    this.vehicleTeams    = new Map()   // joystickId → 'blue'|'red'
    this.score           = { blue: 0, red: 0 }
    this.hitCooldowns    = new Map()   // joystickId → remaining invincibility secs
    this.serverBullets   = []
    this.lastPhysicsTime = Date.now()

    this.world      = new VoxelWorld()
    this.botManager = new BotManager(
      this.world,
      this.vehicleStates,
      this.vehicleInputs,
      this.vehicleTeams,
      this.usedNumbers,
      this.hitCooldowns,
      this.io,
      this._spawnServerBullet.bind(this),
    )
    this.botManager.initBots()
  }

  // ── Joystick ID helpers ────────────────────────────────────────────────────

  _nextNumber() {
    let n = 1
    while (this.usedNumbers.has(n)) n++
    this.usedNumbers.add(n)
    return n
  }

  _joystickList() {
    const all = [...this.vehicleStates.keys()].sort((a, b) => a - b)
    return all.map(id => ({
      id,
      team:  this.vehicleTeams.get(id),
      isBot: this.botManager.bots.has(id),
    }))
  }

  // ── Server bullet helpers ──────────────────────────────────────────────────

  _spawnServerBullet(ownerId, state) {
    this.serverBullets.push({
      ownerId,
      x:  state.x + Math.sin(state.yaw) * 1.1,
      y:  state.y,
      z:  state.z + Math.cos(state.yaw) * 1.1,
      vx: Math.sin(state.yaw),
      vz: Math.cos(state.yaw),
      age: 0,
    })
  }

  _bulletHitsWorldSrv(b) {
    return this.world.isSolid(
      Math.floor((b.x + HALF)   / CELL),
      Math.floor((b.y + HALF_Y) / CELL),
      Math.floor((b.z + HALF)   / CELL),
    )
  }

  // ── Physics loop ──────────────────────────────────────────────────────────

  startPhysicsLoop() {
    setInterval(() => this._physicsTick(), 16)
  }

  _physicsTick() {
    const now = Date.now()
    const dt  = Math.min((now - this.lastPhysicsTime) / 1000, 0.05)
    this.lastPhysicsTime = now

    // Hit cooldowns
    for (const [id, cd] of this.hitCooldowns)
      if (cd > 0) this.hitCooldowns.set(id, cd - dt)

    // Bot AI
    for (const id of this.botManager.bots)
      this.botManager.updateBotAI(id, dt)

    // Vehicle physics
    const updates = []
    for (const [id, state] of this.vehicleStates) {
      const inp = this.vehicleInputs.get(id) ?? ZERO_INPUT

      const fwdX =  Math.sin(state.yaw)
      const fwdZ =  Math.cos(state.yaw)
      const rtX  =  Math.cos(state.yaw)
      const rtZ  = -Math.sin(state.yaw)

      state.x   += (inp.moveY * fwdX + inp.moveX * rtX) * MOVE_SPEED * dt
      state.z   += (inp.moveY * fwdZ + inp.moveX * rtZ) * MOVE_SPEED * dt
      state.y   +=  inp.lookY * MOVE_SPEED * dt
      state.yaw +=  inp.lookX * ROT_SPEED  * dt

      const W = GRID * CELL
      state.x = ((state.x + HALF) % W + W) % W - HALF
      state.z = ((state.z + HALF) % W + W) % W - HALF
      state.y = Math.max(-HALF_Y + VEHICLE_R, Math.min(HALF_Y - VEHICLE_R, state.y))

      this.world.resolveVoxels(state)
      updates.push({ joystickId: id, x: state.x, y: state.y, z: state.z, yaw: state.yaw })
    }
    if (updates.length > 0) this.io.emit('vehicle-states', updates)

    // Server bullet simulation & hit detection
    for (let i = this.serverBullets.length - 1; i >= 0; i--) {
      const b = this.serverBullets[i]
      b.x += b.vx * BULLET_SPEED_SRV * dt
      b.z += b.vz * BULLET_SPEED_SRV * dt
      b.age += dt
      const W = GRID * CELL
      b.x = ((b.x + HALF) % W + W) % W - HALF
      b.z = ((b.z + HALF) % W + W) % W - HALF
      if (b.age > BULLET_LIFETIME || Math.abs(b.y) > HALF_Y || this._bulletHitsWorldSrv(b)) {
        this.serverBullets.splice(i, 1); continue
      }
      const ownerTeam = this.vehicleTeams.get(b.ownerId)
      let hit = false
      for (const [vid, vs] of this.vehicleStates) {
        if (this.vehicleTeams.get(vid) === ownerTeam) continue
        if ((this.hitCooldowns.get(vid) ?? 0) > 0) continue
        const dx = b.x - vs.x, dy = b.y - vs.y, dz = b.z - vs.z
        if (dx * dx + dy * dy + dz * dz < HIT_RADIUS * HIT_RADIUS) {
          this.score[ownerTeam]++
          this.hitCooldowns.set(vid, HIT_INVINCIBILITY)
          this.io.emit('score-update', { ...this.score })
          this.io.emit('hit', { shooterId: b.ownerId, targetId: vid })
          this.serverBullets.splice(i, 1); hit = true; break
        }
      }
      if (hit) continue
    }
  }

  // ── Socket.IO ─────────────────────────────────────────────────────────────

  initSockets() {
    this.io.on('connection', (socket) => this._onConnection(socket))
  }

  _onConnection(socket) {
    console.log(`[+] Client connected: ${socket.id}`)
    socket.emit('joystick-list', this._joystickList())
    socket.emit('world', this.world.worldGrid)
    socket.on('register-joystick', ()       => this._onRegisterJoystick(socket))
    socket.on('joystick-input',    (data)   => this._onJoystickInput(socket, data))
    socket.on('fire',              ()       => this._onFire(socket))
    socket.on('disconnect',        ()       => this._onDisconnect(socket))
  }

  _onRegisterJoystick(socket) {
    if (this.joystickMap.has(socket.id)) return
    const id        = this._nextNumber()
    const blueCount = [...this.vehicleTeams.values()].filter(t => t === TEAMS.BLUE).length
    const redCount  = [...this.vehicleTeams.values()].filter(t => t === TEAMS.RED).length
    const team      = blueCount <= redCount ? TEAMS.BLUE : TEAMS.RED
    this.joystickMap.set(socket.id, id)
    this.vehicleTeams.set(id, team)
    this.hitCooldowns.set(id, 0)
    this.vehicleStates.set(id, this.world.randomSpawnPos())
    this.vehicleInputs.set(id, { ...ZERO_INPUT })
    socket.emit('joystick-assigned', { id, team })
    this.io.emit('joystick-list', this._joystickList())
    console.log(`[J] Joystick #${String(id).padStart(2, '0')} registered (${socket.id})`)
  }

  _onJoystickInput(socket, data) {
    const joystickId = this.joystickMap.get(socket.id)
    if (joystickId !== undefined) {
      this.vehicleInputs.set(joystickId, {
        moveX: data.moveX ?? 0,
        moveY: data.moveY ?? 0,
        lookX: data.lookX ?? 0,
        lookY: data.lookY ?? 0,
      })
    }
  }

  _onFire(socket) {
    const joystickId = this.joystickMap.get(socket.id)
    if (joystickId !== undefined) {
      this._spawnServerBullet(joystickId, this.vehicleStates.get(joystickId))
      socket.broadcast.emit('fire', { joystickId })
    }
  }

  _onDisconnect(socket) {
    const id = this.joystickMap.get(socket.id)
    if (id !== undefined) {
      this.joystickMap.delete(socket.id)
      this.usedNumbers.delete(id)
      this.vehicleStates.delete(id)
      this.vehicleInputs.delete(id)
      this.vehicleTeams.delete(id)
      this.hitCooldowns.delete(id)
      this.io.emit('joystick-list', this._joystickList())
      console.log(`[J] Joystick #${String(id).padStart(2, '0')} disconnected`)
    }
    console.log(`[-] Client disconnected: ${socket.id}`)
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000
const gameServer = new GameServer(io)
gameServer.initSockets()
gameServer.startPhysicsLoop()
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  if (!isProd) {
    console.log('Socket.IO ready — Vite dev server proxies /socket.io here')
  }
})
