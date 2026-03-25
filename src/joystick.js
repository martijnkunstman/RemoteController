import { io } from 'socket.io-client'
import nipplejs from 'nipplejs'

const statusEl       = document.getElementById('status')
const coordsLeft     = document.getElementById('coords-left')
const coordsRight    = document.getElementById('coords-right')
const fireBtnEl      = document.getElementById('btn-fire')
const idBadgeEl      = document.getElementById('joystick-id')
const fpvFrame       = document.getElementById('fpv-frame')
const fpvPlaceholder = document.getElementById('fpv-placeholder')

const socket = io()
socket.on('connect', () => {
  statusEl.textContent = 'Connected'
  statusEl.classList.add('connected')
  socket.emit('register-joystick')
})
socket.on('disconnect', () => {
  statusEl.textContent = 'Disconnected'
  statusEl.classList.remove('connected')
  idBadgeEl.textContent = '--'
})
socket.on('joystick-assigned', ({ id }) => {
  idBadgeEl.textContent = String(id).padStart(2, '0')
  fpvPlaceholder.style.display = 'none'
  fpvFrame.style.display = 'block'
  fpvFrame.src = `/firstpersonview.html?id=${id}`
})

let moveInput = { x: 0, y: 0 }
let lookInput = { x: 0, y: 0 }

// ─── Left: analog nipplejs joystick (movement) ───────────────────────────────
const stick = nipplejs.create({
  zone: document.getElementById('zone-left'),
  mode: 'static',
  position: { left: '50%', top: '50%' },
  color: '#5b6af0',
  size: 150,
  restJoystick: true,
})

stick.on('move', (_e, data) => {
  const f = Math.min(data.force, 1)
  moveInput = {
    x: +(Math.cos(data.angle.radian) * f).toFixed(3),
    y: +(Math.sin(data.angle.radian) * f).toFixed(3),
  }
  coordsLeft.innerHTML = `x: ${moveInput.x.toFixed(2)} &nbsp; y: ${moveInput.y.toFixed(2)}`
  emitInput()
})

stick.on('end', () => {
  if (pressedWASD.size === 0) {
    moveInput = { x: 0, y: 0 }
    coordsLeft.innerHTML = `x: 0.00 &nbsp; y: 0.00`
    emitInput()
  }
})

// ─── Left: WASD keyboard movement ────────────────────────────────────────────
const pressedWASD = new Set()

function updateMove() {
  let x = 0, y = 0
  for (const k of pressedWASD) {
    if (k === 'd') x =  1
    if (k === 'a') x = -1
    if (k === 'w') y =  1
    if (k === 's') y = -1
  }
  moveInput = { x, y }
  coordsLeft.innerHTML = `x: ${x.toFixed(2)} &nbsp; y: ${y.toFixed(2)}`
  emitInput()
}

const wasdMap = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd' }
window.addEventListener('keydown', (e) => {
  const k = wasdMap[e.code]
  if (k && !pressedWASD.has(k)) { e.preventDefault(); pressedWASD.add(k); updateMove() }
})
window.addEventListener('keyup', (e) => {
  const k = wasdMap[e.code]
  if (k) { pressedWASD.delete(k); updateMove() }
})

// ─── Right: D-pad (look / elevation / rotation) ──────────────────────────────
const pressedKeys = new Set()

function updateLook() {
  let x = 0, y = 0
  for (const k of pressedKeys) {
    if (k === 'right') x =  1
    if (k === 'left')  x = -1
    if (k === 'up')    y =  1
    if (k === 'down')  y = -1
  }
  lookInput = { x, y }
  coordsRight.innerHTML = `x: ${x.toFixed(2)} &nbsp; y: ${y.toFixed(2)}`
  emitInput()
}

function press(name)   { if (!pressedKeys.has(name)) { pressedKeys.add(name);    updateLook() } }
function release(name) { if (pressedKeys.has(name))  { pressedKeys.delete(name); updateLook() } }

for (const btn of document.querySelectorAll('.dpad-btn')) {
  const name = ['up', 'down', 'left', 'right'].find(n => btn.classList.contains(n))
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.classList.add('active');    press(name) })
  btn.addEventListener('pointerup',   (e) => { e.preventDefault(); btn.classList.remove('active'); release(name) })
  btn.addEventListener('pointerleave',()  => { btn.classList.remove('active'); release(name) })
  btn.addEventListener('contextmenu', (e) => e.preventDefault())
}

const keyMap = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
window.addEventListener('keydown', (e) => {
  const name = keyMap[e.key]
  if (name) { e.preventDefault(); document.getElementById(`btn-${name}`)?.classList.add('active'); press(name) }
})
window.addEventListener('keyup', (e) => {
  const name = keyMap[e.key]
  if (name) { document.getElementById(`btn-${name}`)?.classList.remove('active'); release(name) }
})

// ─── Center: fire button ──────────────────────────────────────────────────────
const FIRE_INTERVAL = 150
let fireTimer = null

function startFiring() {
  if (fireTimer !== null) return
  fireBtnEl.classList.add('active')
  socket.emit('fire')
  fireTimer = setInterval(() => socket.emit('fire'), FIRE_INTERVAL)
}

function stopFiring() {
  if (fireTimer === null) return
  fireBtnEl.classList.remove('active')
  clearInterval(fireTimer)
  fireTimer = null
}

fireBtnEl.addEventListener('pointerdown', (e) => { e.preventDefault(); startFiring() })
fireBtnEl.addEventListener('pointerup',   (e) => { e.preventDefault(); stopFiring() })
fireBtnEl.addEventListener('pointerleave', stopFiring)
fireBtnEl.addEventListener('contextmenu', (e) => e.preventDefault())

window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); startFiring() } })
window.addEventListener('keyup',   (e) => { if (e.code === 'Space') stopFiring() })

// ─── Input emit (event-driven) ────────────────────────────────────────────────
// Sends current inputs to the server whenever they change.
// Server owns physics/position and keeps the last known input.
function emitInput() {
  socket.emit('joystick-input', {
    moveX: moveInput.x,
    moveY: moveInput.y,
    lookX: lookInput.x,
    lookY: lookInput.y,
  })
}

// ─── Mini map ─────────────────────────────────────────────────────────────────
const GRID   = 64
const GRID_Y = 32
const CELL   = 2
const HALF   = GRID   * CELL / 2   // 64  (XZ)
const HALF_Y = GRID_Y * CELL / 2   // 32  (Y)
const MM     = 192               // canvas pixels

const PALETTE_CSS = [
  '#7b8fff', '#ff6060', '#5eff82', '#cc60ff',
  '#ffdc44', '#44f0ff', '#ff60cc', '#ff9644',
]
function paletteColor(id) { return PALETTE_CSS[(id - 1) % PALETTE_CSS.length] }

let worldGrid      = null
let myJoystickId   = null
const vehiclePos   = new Map()   // id → { x, y, z, yaw }

// Capture own ID when assigned
const _origAssigned = socket.listeners('joystick-assigned')[0]
socket.off('joystick-assigned')
socket.on('joystick-assigned', (data) => {
  myJoystickId = data.id
  if (_origAssigned) _origAssigned(data)
})

socket.on('world', (data) => {
  worldGrid = new Uint8Array(data)
})

socket.on('vehicle-state', ({ joystickId, x, y, z, yaw }) => {
  vehiclePos.set(joystickId, { x, y, z, yaw })
})

socket.on('joystick-list', (ids) => {
  for (const id of [...vehiclePos.keys()])
    if (!ids.includes(id)) vehiclePos.delete(id)
})

function mmIsSolid(cx, cy, cz) {
  if (!worldGrid) return true
  if (cy < 0 || cy >= GRID_Y) return true
  const wx = ((cx % GRID) + GRID) % GRID
  const wz = ((cz % GRID) + GRID) % GRID
  return worldGrid[wx + cy * GRID + wz * GRID * GRID_Y] === 1
}

const mmCanvas = document.getElementById('minimap')
const mmCtx    = mmCanvas ? mmCanvas.getContext('2d') : null

function drawMinimap() {
  if (!mmCtx) { requestAnimationFrame(drawMinimap); return }

  const cellPx = MM / GRID

  mmCtx.clearRect(0, 0, MM, MM)
  mmCtx.fillStyle = '#090910'
  mmCtx.fillRect(0, 0, MM, MM)

  if (worldGrid) {
    const own = myJoystickId ? vehiclePos.get(myJoystickId) : null
    const wy  = own ? own.y : 0
    const cy  = Math.max(1, Math.min(GRID_Y - 2, Math.floor((wy + HALF_Y) / CELL)))

    for (let z = 0; z < GRID; z++) {
      for (let x = 0; x < GRID; x++) {
        const solid = mmIsSolid(x, cy, z)
        const px    = (GRID - 1 - x) * cellPx
        const pz    = z * cellPx
        if (solid) {
          mmCtx.fillStyle = '#30293f'
          mmCtx.fillRect(px, pz, cellPx + 0.5, cellPx + 0.5)
        } else {
          const hasFloor = mmIsSolid(x, cy - 1, z)
          mmCtx.fillStyle = hasFloor ? '#141220' : '#0d0b18'
          mmCtx.fillRect(px, pz, cellPx + 0.5, cellPx + 0.5)
        }
      }
    }
  }

  // Draw vehicles
  for (const [id, pos] of vehiclePos) {
    const mx    = MM - ((pos.x + HALF) / (GRID * CELL)) * MM
    const mz    = ((pos.z + HALF) / (GRID * CELL)) * MM
    const color = paletteColor(id)
    const isOwn = id === myJoystickId
    const size  = isOwn ? 5 : 3.5

    mmCtx.save()
    mmCtx.translate(mx, mz)
    mmCtx.rotate(pos.yaw)

    mmCtx.beginPath()
    mmCtx.moveTo(0, size * 1.8)
    mmCtx.lineTo(-size, -size)
    mmCtx.lineTo(size, -size)
    mmCtx.closePath()

    if (isOwn) {
      mmCtx.shadowColor = color
      mmCtx.shadowBlur  = 8
    }
    mmCtx.fillStyle = color
    mmCtx.fill()
    mmCtx.restore()
  }

  // Border
  mmCtx.strokeStyle = '#2a2a40'
  mmCtx.lineWidth   = 1
  mmCtx.strokeRect(0.5, 0.5, MM - 1, MM - 1)

  requestAnimationFrame(drawMinimap)
}
drawMinimap()
