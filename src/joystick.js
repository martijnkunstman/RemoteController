import { io } from 'socket.io-client'
import nipplejs from 'nipplejs'

const statusEl   = document.getElementById('status')
const coordsLeft = document.getElementById('coords-left')
const coordsRight = document.getElementById('coords-right')

const socket = io()
socket.on('connect',    () => { statusEl.textContent = 'Connected';    statusEl.classList.add('connected') })
socket.on('disconnect', () => { statusEl.textContent = 'Disconnected'; statusEl.classList.remove('connected') })

let moveInput = { x: 0, y: 0 }
let lookInput = { x: 0, y: 0 }

function emit() {
  socket.emit('joystick-move', { move: moveInput, look: lookInput })
}

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
  emit()
})

stick.on('end', () => {
  moveInput = { x: 0, y: 0 }
  coordsLeft.innerHTML = `x: 0.00 &nbsp; y: 0.00`
  emit()
})

// ─── Right: D-pad buttons (look / rotation / elevation) ──────────────────────
// Each button drives exactly one axis; releasing resets that axis to 0.
// Holding multiple buttons in the same axis: last pressed wins (per axis).
const pressedKeys = new Set()

function updateLookFromPressed() {
  // Resolve x axis: right(+1) beats left(-1), last pressed wins via Set order
  let x = 0, y = 0
  for (const k of pressedKeys) {
    if (k === 'right') x =  1
    if (k === 'left')  x = -1
    if (k === 'up')    y =  1
    if (k === 'down')  y = -1
  }
  lookInput = { x, y }
  coordsRight.innerHTML = `x: ${x.toFixed(2)} &nbsp; y: ${y.toFixed(2)}`
  emit()
}

function press(name) {
  if (pressedKeys.has(name)) return
  pressedKeys.add(name)
  updateLookFromPressed()
}

function release(name) {
  if (!pressedKeys.has(name)) return
  pressedKeys.delete(name)
  updateLookFromPressed()
}

// Touch / mouse on D-pad buttons
for (const btn of document.querySelectorAll('.dpad-btn')) {
  const name = ['up','down','left','right'].find(n => btn.classList.contains(n))

  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.classList.add('active'); press(name) })
  btn.addEventListener('pointerup',   (e) => { e.preventDefault(); btn.classList.remove('active'); release(name) })
  btn.addEventListener('pointerleave',()  => { btn.classList.remove('active'); release(name) })
  btn.addEventListener('contextmenu', (e) => e.preventDefault())
}

// Keyboard arrow keys
const keyMap = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }

window.addEventListener('keydown', (e) => {
  const name = keyMap[e.key]
  if (!name) return
  e.preventDefault()
  document.getElementById(`btn-${name}`)?.classList.add('active')
  press(name)
})

window.addEventListener('keyup', (e) => {
  const name = keyMap[e.key]
  if (!name) return
  document.getElementById(`btn-${name}`)?.classList.remove('active')
  release(name)
})
