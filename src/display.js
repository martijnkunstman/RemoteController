import { io } from 'socket.io-client'

const statusEl = document.getElementById('status')
const arenaEl = document.getElementById('arena')
const dotEl = document.getElementById('dot')
const coordsDisplayEl = document.getElementById('coords-display')

// Dot position as a fraction of the arena (0..1)
let posX = 0.5
let posY = 0.5

// Movement speed: fraction of arena per second per unit of joystick force
const SPEED = 0.4

let lastTime = null
let currentInput = { x: 0, y: 0 }

function placeDot() {
  const rect = arenaEl.getBoundingClientRect()
  const px = posX * rect.width
  const py = posY * rect.height
  dotEl.style.left = `${px}px`
  dotEl.style.top = `${py}px`
}

function gameLoop(timestamp) {
  if (lastTime !== null) {
    const dt = (timestamp - lastTime) / 1000 // seconds

    posX += currentInput.x * SPEED * dt
    posY -= currentInput.y * SPEED * dt // y-axis: positive = up in joystick, down in screen

    // Clamp within arena bounds (accounting for dot radius)
    const rect = arenaEl.getBoundingClientRect()
    const halfDot = 18 // half of dot's 36px
    const minX = halfDot / rect.width
    const maxX = 1 - halfDot / rect.width
    const minY = halfDot / rect.height
    const maxY = 1 - halfDot / rect.height

    posX = Math.max(minX, Math.min(maxX, posX))
    posY = Math.max(minY, Math.min(maxY, posY))

    placeDot()
    coordsDisplayEl.innerHTML = `x: ${(posX * 2 - 1).toFixed(2)} &nbsp; y: ${(1 - posY * 2).toFixed(2)}`
  }

  lastTime = timestamp
  requestAnimationFrame(gameLoop)
}

// Start loop
requestAnimationFrame(gameLoop)
// Also re-place dot on window resize
window.addEventListener('resize', placeDot)

// --- Socket.IO ---
const socket = io()

socket.on('connect', () => {
  statusEl.textContent = 'Connected'
  statusEl.classList.add('connected')
})

socket.on('disconnect', () => {
  statusEl.textContent = 'Disconnected'
  statusEl.classList.remove('connected')
  currentInput = { x: 0, y: 0 }
})

socket.on('dot-move', (data) => {
  currentInput = data
})
