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
