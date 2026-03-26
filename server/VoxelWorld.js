import { GRID, GRID_Y, CELL, HALF, HALF_Y, GRID_MASK, VEHICLE_R } from './constants.js'

// ─── Cave generation (cellular automata + BFS) ───────────────────────────────
function generateCave() {
  const total = GRID * GRID_Y * GRID
  const grid  = new Uint8Array(total)

  function idx(x, y, z) { return x + y * GRID + z * GRID * GRID_Y }
  function isYOuter(y)   { return y === 0 || y === GRID_Y - 1 }

  function enforceYWallsAndClearXZBorder() {
    for (let z = 0; z < GRID; z++)
      for (let x = 0; x < GRID; x++) {
        grid[idx(x, 0,          z)] = 1
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

  // Step 1: Seed
  for (let z = 0; z < GRID; z++)
    for (let y = 0; y < GRID_Y; y++)
      for (let x = 0; x < GRID; x++)
        grid[idx(x, y, z)] = isYOuter(y) ? 1 : (Math.random() < 0.45 ? 1 : 0)

  // Step 2: 4 CA smoothing passes
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
                const nx = ((x + dx) % GRID + GRID) % GRID
                const nz = ((z + dz) % GRID + GRID) % GRID
                const ny = y + dy
                if (ny < 0 || ny >= GRID_Y) { count++; continue }
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

  // Step 4: BFS flood-fill from center
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
      const nx = ((ix + dx) % GRID + GRID) % GRID
      const nz = ((iz + dz) % GRID + GRID) % GRID
      const ny = iy + dy
      if (ny < 0 || ny >= GRID_Y) continue
      const ni = idx(nx, ny, nz)
      if (!visited[ni] && !grid[ni]) { visited[ni] = 1; queue.push(ni) }
    }
  }

  // Step 5: Fill unreachable empty cells
  for (let i = 0; i < total; i++)
    if (!grid[i] && !visited[i]) grid[i] = 1

  // Step 6: Enforce Y walls + clear XZ border ring
  enforceYWallsAndClearXZBorder()

  // Step 7: Strip interior solid cells (unreachable & invisible)
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
          if (ny < 0 || ny >= GRID_Y) continue
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

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }

// ─── VoxelWorld ───────────────────────────────────────────────────────────────
// Owns the cave grid, all cell/world coordinate conversions, collision resolution,
// and the list of valid spawn positions.
export class VoxelWorld {
  constructor() {
    this.worldGrid       = generateCave()
    this.spawnCandidates = this._buildSpawnCandidates()
    console.log(`[World] Cave generated. ${this.spawnCandidates.length} spawn candidates.`)
  }

  _buildSpawnCandidates() {
    const candidates = []
    const faces = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]
    for (let z = 0; z < GRID; z++)
      for (let y = 1; y < GRID_Y - 1; y++)
        for (let x = 0; x < GRID; x++) {
          if (this.isSolid(x, y, z)) continue
          let ok = true
          for (const [dx, dy, dz] of faces) {
            if (this.isSolid(x + dx, y + dy, z + dz)) { ok = false; break }
          }
          if (ok) candidates.push({ x, y, z })
        }
    return candidates
  }

  isSolid(cx, cy, cz) {
    if (cy < 0 || cy >= GRID_Y) return true
    return this.worldGrid[(cx & GRID_MASK) + cy * GRID + (cz & GRID_MASK) * GRID * GRID_Y] === 1
  }

  worldToCell(wx, wy, wz) {
    return {
      cx: Math.floor((wx  + HALF)   / CELL),
      cy: Math.floor((wy  + HALF_Y) / CELL),
      cz: Math.floor((wz  + HALF)   / CELL),
    }
  }

  cellToWorld(cx, cy, cz) {
    return {
      x: (cx + 0.5) * CELL - HALF,
      y: (cy + 0.5) * CELL - HALF_Y,
      z: (cz + 0.5) * CELL - HALF,
    }
  }

  resolveSolidCell(state, cx, cy, cz) {
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
      const push = (VEHICLE_R - dist) / dist
      state.x += dx * push
      state.y += dy * push
      state.z += dz * push
    } else if (dist <= 1e-6) {
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

  resolveVoxels(state) {
    const { cx, cy, cz } = this.worldToCell(state.x, state.y, state.z)
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy, nz = cz + dz
          if (this.isSolid(nx, ny, nz)) this.resolveSolidCell(state, nx, ny, nz)
        }
  }

  randomSpawnPos() {
    if (this.spawnCandidates.length === 0) return { x: 0, y: 0, z: 0, yaw: 0 }
    const c = this.spawnCandidates[Math.floor(Math.random() * this.spawnCandidates.length)]
    const w = this.cellToWorld(c.x, c.y, c.z)
    return { ...w, yaw: Math.random() * Math.PI * 2 }
  }
}
