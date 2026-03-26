import { GRID, GRID_Y, CELL, HALF, HALF_Y, GRID_MASK } from './worldConstants.js'

const MM = 192

// ─── Minimap ──────────────────────────────────────────────────────────────────
// Draws a top-down map of the cave at the player's Y level, with vehicle markers.
export class Minimap {
  constructor(socket) {
    this.socket       = socket
    this.worldGrid    = null
    this.myJoystickId = null
    this.vehiclePos   = new Map()
    this.vehicleTeams = new Map()
    this.mmCanvas     = document.getElementById('minimap')
    this.mmCtx        = this.mmCanvas ? this.mmCanvas.getContext('2d') : null
  }

  setMyId(id) {
    this.myJoystickId = id
  }

  initSockets() {
    this.socket.on('world', (data) => {
      this.worldGrid = new Uint8Array(data)
    })

    this.socket.on('vehicle-states', (states) => {
      for (const { joystickId, x, y, z, yaw } of states)
        this.vehiclePos.set(joystickId, { x, y, z, yaw })
    })

    this.socket.on('joystick-list', (members) => {
      for (const { id, team } of members) this.vehicleTeams.set(id, team)
      for (const id of [...this.vehiclePos.keys()])
        if (!members.find(m => m.id === id)) { this.vehiclePos.delete(id); this.vehicleTeams.delete(id) }
    })

    this.socket.on('score-update', ({ blue, red }) => {
      const el = document.getElementById('minimap-score')
      if (el) el.textContent = `Blue ${blue}  |  Red ${red}`
    })
  }

  draw() {
    if (!this.mmCtx) { requestAnimationFrame(() => this.draw()); return }

    const cellPx = MM / GRID
    this.mmCtx.clearRect(0, 0, MM, MM)
    this.mmCtx.fillStyle = '#090910'
    this.mmCtx.fillRect(0, 0, MM, MM)

    if (this.worldGrid) {
      const own = this.myJoystickId ? this.vehiclePos.get(this.myJoystickId) : null
      const wy  = own ? own.y : 0
      const cy  = Math.max(1, Math.min(GRID_Y - 2, Math.floor((wy + HALF_Y) / CELL)))

      for (let z = 0; z < GRID; z++) {
        for (let x = 0; x < GRID; x++) {
          const solid = this._isSolid(x, cy, z)
          const px    = (GRID - 1 - x) * cellPx
          const pz    = z * cellPx
          if (solid) {
            this.mmCtx.fillStyle = '#30293f'
            this.mmCtx.fillRect(px, pz, cellPx + 0.5, cellPx + 0.5)
          } else {
            const hasFloor = this._isSolid(x, cy - 1, z)
            this.mmCtx.fillStyle = hasFloor ? '#141220' : '#0d0b18'
            this.mmCtx.fillRect(px, pz, cellPx + 0.5, cellPx + 0.5)
          }
        }
      }
    }

    // Draw vehicles
    for (const [id, pos] of this.vehiclePos) {
      const mx        = MM - ((pos.x + HALF) / (GRID * CELL)) * MM
      const mz        = ((pos.z + HALF) / (GRID * CELL)) * MM
      const teamColor = this.vehicleTeams.get(id) === 'blue' ? '#4a7aff' : '#ff4040'
      const isOwn     = id === this.myJoystickId
      const size      = isOwn ? 5 : 3.5

      this.mmCtx.save()
      this.mmCtx.translate(mx, mz)
      this.mmCtx.rotate(pos.yaw)
      this.mmCtx.beginPath()
      this.mmCtx.moveTo(0, size * 1.8)
      this.mmCtx.lineTo(-size, -size)
      this.mmCtx.lineTo(size, -size)
      this.mmCtx.closePath()
      if (isOwn) { this.mmCtx.shadowColor = teamColor; this.mmCtx.shadowBlur = 8 }
      this.mmCtx.fillStyle = isOwn ? '#ffffff' : teamColor
      this.mmCtx.fill()
      this.mmCtx.restore()
    }

    // Border
    this.mmCtx.strokeStyle = '#2a2a40'
    this.mmCtx.lineWidth   = 1
    this.mmCtx.strokeRect(0.5, 0.5, MM - 1, MM - 1)

    requestAnimationFrame(() => this.draw())
  }

  _isSolid(cx, cy, cz) {
    if (!this.worldGrid) return true
    if (cy < 0 || cy >= GRID_Y) return true
    return this.worldGrid[(cx & GRID_MASK) + cy * GRID + (cz & GRID_MASK) * GRID * GRID_Y] === 1
  }
}
