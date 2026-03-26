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
  app.get('*', (_req, res) => {
    res.sendFile(join(distPath, 'index.html'))
  })
}

const joystickMap = new Map()   // socket.id -> joystickId (number)
const usedNumbers = new Set()

// ─── World & physics constants ─────────────────────────────────────────────────
const GRID         = 64
const GRID_Y       = 32
const CELL         = 2
const HALF         = GRID   * CELL / 2   // 64  (XZ)
const HALF_Y       = GRID_Y * CELL / 2   // 32  (Y)
const VEHICLE_R    = 0.8
const MOVE_SPEED   = 6
const ROT_SPEED    = 2

// ─── Cave generation (cellular automata + BFS) ────────────────────────────────
function generateCave() {
  const total = GRID * GRID_Y * GRID
  const grid  = new Uint8Array(total)

  function idx(x, y, z) { return x + y * GRID + z * GRID * GRID_Y }

  // Y-only outer check — XZ sides are open for wrap-around
  function isYOuter(y) { return y === 0 || y === GRID_Y - 1 }

  // Enforce floor and ceiling solid, clear XZ border ring for guaranteed passage
  function enforceYWallsAndClearXZBorder() {
    for (let z = 0; z < GRID; z++)
      for (let x = 0; x < GRID; x++) {
        grid[idx(x, 0,         z)] = 1
        grid[idx(x, GRID_Y - 1, z)] = 1
      }
    for (let y = 1; y < GRID_Y - 1; y++) {
      for (let z = 0; z < GRID; z++) {
        grid[idx(0,        y, z)] = 0
        grid[idx(GRID - 1, y, z)] = 0
      }
      for (let x = 0; x < GRID; x++) {
        grid[idx(x, y, 0       )] = 0
        grid[idx(x, y, GRID - 1)] = 0
      }
    }
  }

  // Step 1: Seed — Y borders solid, interior ~45% random, XZ borders participate
  for (let z = 0; z < GRID; z++)
    for (let y = 0; y < GRID_Y; y++)
      for (let x = 0; x < GRID; x++)
        grid[idx(x, y, z)] = isYOuter(y) ? 1 : (Math.random() < 0.45 ? 1 : 0)

  // Step 2: 4 CA smoothing passes — XZ wraps, Y clamps to solid
  const next = new Uint8Array(total)
  for (let pass = 0; pass < 4; pass++) {
    for (let z = 0; z < GRID; z++)
      for (let y = 0; y < GRID_Y; y++)
        for (let x = 0; x < GRID; x++) {
          if (isYOuter(y)) { next[idx(x, y, z)] = 1; continue }
          let count = 0
          for (let dz = -1; dz <= 1; dz++)
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                const nx = ((x + dx) % GRID + GRID) % GRID  // wrap X
                const nz = ((z + dz) % GRID + GRID) % GRID  // wrap Z
                const ny = y + dy
                if (ny < 0 || ny >= GRID_Y) { count++; continue }  // Y clamps = solid
                count += grid[idx(nx, ny, nz)]
              }
          next[idx(x, y, z)] = count >= 14 ? 1 : 0
        }
    grid.set(next)
  }

  // Step 3: Carve guaranteed open area at center
  const mid  = Math.floor(GRID   / 2)
  const midY = Math.floor(GRID_Y / 2)
  for (let dz = -3; dz <= 3; dz++)
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++)
        grid[idx(mid + dx, midY + dy, mid + dz)] = 0

  // Step 4: BFS flood-fill from center — XZ wraps, Y clamps
  const visited = new Uint8Array(total)
  const queue   = []
  const startIdx = idx(mid, midY, mid)
  visited[startIdx] = 1
  queue.push(startIdx)

  const faces = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]
  let head = 0
  while (head < queue.length) {
    const i = queue[head++]
    const iz = Math.floor(i / (GRID * GRID_Y))
    const iy = Math.floor((i % (GRID * GRID_Y)) / GRID)
    const ix = i % GRID
    for (const [dx, dy, dz] of faces) {
      const nx = ((ix + dx) % GRID + GRID) % GRID  // wrap X
      const nz = ((iz + dz) % GRID + GRID) % GRID  // wrap Z
      const ny = iy + dy
      if (ny < 0 || ny >= GRID_Y) continue          // Y wall
      const ni = idx(nx, ny, nz)
      if (!visited[ni] && !grid[ni]) {
        visited[ni] = 1
        queue.push(ni)
      }
    }
  }

  // Step 5: Fill unreachable empty cells → solid (ensures one connected cave)
  for (let i = 0; i < total; i++)
    if (!grid[i] && !visited[i]) grid[i] = 1

  // Step 6: Enforce Y walls + clear XZ border ring (after fill so border stays open)
  enforceYWallsAndClearXZBorder()

  // Step 7: Strip interior solid cells — solid blocks with all 6 face-neighbors solid
  // are unreachable and invisible; clearing them halves collision checks and shrinks data
  const toStrip = new Uint8Array(total)
  for (let z = 0; z < GRID; z++)
    for (let y = 0; y < GRID_Y; y++)
      for (let x = 0; x < GRID; x++) {
        if (!grid[idx(x, y, z)]) continue
        let interior = true
        for (const [dx, dy, dz] of faces) {
          const nx = ((x + dx) % GRID + GRID) % GRID
          const nz = ((z + dz) % GRID + GRID) % GRID
          const ny = y + dy
          if (ny < 0 || ny >= GRID_Y) continue   // Y walls count as solid
          if (!grid[idx(nx, ny, nz)]) { interior = false; break }
        }
        if (interior) toStrip[idx(x, y, z)] = 1
      }
  let stripped = 0
  for (let i = 0; i < total; i++)
    if (toStrip[i]) { grid[i] = 0; stripped++ }

  console.log(`[World] Stripped ${stripped} interior cells (${((stripped / total) * 100).toFixed(1)}% of total)`)

  return grid
}

const worldGrid = generateCave()

// ─── Voxel helpers ────────────────────────────────────────────────────────────
const GRID_MASK = GRID - 1   // 63 — GRID is a power of 2, use bitwise AND for fast wrapping

function isSolid(cx, cy, cz) {
  if (cy < 0 || cy >= GRID_Y) return true                   // Y out-of-bounds = solid ceiling/floor
  return worldGrid[(cx & GRID_MASK) + cy * GRID + (cz & GRID_MASK) * GRID * GRID_Y] === 1
}

function worldToCell(wx, wy, wz) {
  return {
    cx: Math.floor((wx  + HALF)   / CELL),
    cy: Math.floor((wy  + HALF_Y) / CELL),
    cz: Math.floor((wz  + HALF)   / CELL),
  }
}

function cellToWorld(cx, cy, cz) {
  return {
    x: (cx + 0.5) * CELL - HALF,
    y: (cy + 0.5) * CELL - HALF_Y,
    z: (cz + 0.5) * CELL - HALF,
  }
}

// ─── Voxel collision (sphere vs AABB) ────────────────────────────────────────
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }

function resolveSolidCell(state, cx, cy, cz) {
  const bx = cx * CELL - HALF
  const by = cy * CELL - HALF_Y
  const bz = cz * CELL - HALF
  const px = clamp(state.x, bx, bx + CELL)
  const py = clamp(state.y, by, by + CELL)
  const pz = clamp(state.z, bz, bz + CELL)
  const dx = state.x - px
  const dy = state.y - py
  const dz = state.z - pz
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

  if (dist > 1e-6 && dist < VEHICLE_R) {
    // Normal case: sphere near face of AABB
    const push = (VEHICLE_R - dist) / dist
    state.x += dx * push
    state.y += dy * push
    state.z += dz * push
  } else if (dist <= 1e-6) {
    // Recovery: sphere center embedded inside solid cell — push via shortest axis
    const toLeft  = state.x - bx
    const toRight = bx + CELL - state.x
    const toDown  = state.y - by
    const toUp    = by + CELL - state.y
    const toBack  = state.z - bz
    const toFront = bz + CELL - state.z
    const minFace = Math.min(toLeft, toRight, toDown, toUp, toBack, toFront)
    if      (minFace === toLeft)  state.x = bx          - VEHICLE_R
    else if (minFace === toRight) state.x = bx + CELL   + VEHICLE_R
    else if (minFace === toDown)  state.y = by          - VEHICLE_R
    else if (minFace === toUp)    state.y = by + CELL   + VEHICLE_R
    else if (minFace === toBack)  state.z = bz          - VEHICLE_R
    else                          state.z = bz + CELL   + VEHICLE_R
  }
}

function resolveVoxels(state) {
  const { cx, cy, cz } = worldToCell(state.x, state.y, state.z)
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy, nz = cz + dz
        if (isSolid(nx, ny, nz)) resolveSolidCell(state, nx, ny, nz)
      }
}

// ─── Spawn candidates ─────────────────────────────────────────────────────────
const spawnCandidates = []
const spawnFaces = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]
for (let z = 0; z < GRID; z++)
  for (let y = 1; y < GRID_Y - 1; y++)   // Y: exclude floor(0) and ceiling(GRID_Y-1)
    for (let x = 0; x < GRID; x++) {
      if (isSolid(x, y, z)) continue
      let ok = true
      for (const [dx, dy, dz] of spawnFaces) {
        if (isSolid(x + dx, y + dy, z + dz)) { ok = false; break }
      }
      if (ok) spawnCandidates.push({ x, y, z })
    }

function randomSpawnPos() {
  if (spawnCandidates.length === 0) return { x: 0, y: 0, z: 0, yaw: 0 }
  const c = spawnCandidates[Math.floor(Math.random() * spawnCandidates.length)]
  const w = cellToWorld(c.x, c.y, c.z)
  return { ...w, yaw: Math.random() * Math.PI * 2 }
}

console.log(`[World] Cave generated. ${spawnCandidates.length} spawn candidates.`)

// ─── Vehicle state ────────────────────────────────────────────────────────────
const vehicleStates = new Map()   // joystickId → {x, y, z, yaw}
const vehicleInputs = new Map()   // joystickId → {moveX, moveY, lookX, lookY}

function nextNumber() {
  let n = 1
  while (usedNumbers.has(n)) n++
  usedNumbers.add(n)
  return n
}

function joystickList() {
  return [...joystickMap.values()].sort((a, b) => a - b)
}

// ─── Physics loop ─────────────────────────────────────────────────────────────
const ZERO_INPUT = { moveX: 0, moveY: 0, lookX: 0, lookY: 0 }
let lastPhysicsTime = Date.now()
setInterval(() => {
  const now = Date.now()
  const dt  = Math.min((now - lastPhysicsTime) / 1000, 0.05)
  lastPhysicsTime = now

  const updates = []
  for (const [id, state] of vehicleStates) {
    const inp = vehicleInputs.get(id) ?? ZERO_INPUT

    const fwdX =  Math.sin(state.yaw)
    const fwdZ =  Math.cos(state.yaw)
    const rtX  =  Math.cos(state.yaw)
    const rtZ  = -Math.sin(state.yaw)

    state.x   += (inp.moveY * fwdX + inp.moveX * rtX) * MOVE_SPEED * dt
    state.z   += (inp.moveY * fwdZ + inp.moveX * rtZ) * MOVE_SPEED * dt
    state.y   +=  inp.lookY * MOVE_SPEED * dt
    state.yaw +=  inp.lookX * ROT_SPEED  * dt

    // XZ: wrap around world edges; Y: clamp to ceiling/floor
    const W = GRID * CELL
    state.x = ((state.x + HALF) % W + W) % W - HALF
    state.z = ((state.z + HALF) % W + W) % W - HALF
    state.y = Math.max(-HALF_Y + VEHICLE_R, Math.min(HALF_Y - VEHICLE_R, state.y))

    resolveVoxels(state)

    updates.push({ joystickId: id, x: state.x, y: state.y, z: state.z, yaw: state.yaw })
  }
  if (updates.length > 0) io.emit('vehicle-states', updates)
}, 16)

// ─── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] Client connected: ${socket.id}`)

  socket.emit('joystick-list', joystickList())
  socket.emit('world', worldGrid)

  socket.on('register-joystick', () => {
    if (joystickMap.has(socket.id)) return
    const id = nextNumber()
    joystickMap.set(socket.id, id)
    vehicleStates.set(id, randomSpawnPos())
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
