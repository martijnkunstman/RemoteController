import { io } from 'socket.io-client'
import nipplejs from 'nipplejs'

const statusEl = document.getElementById('status')

const socket = io()

socket.on('connect', () => {
  statusEl.textContent = 'Connected'
  statusEl.classList.add('connected')
})

socket.on('disconnect', () => {
  statusEl.textContent = 'Disconnected'
  statusEl.classList.remove('connected')
})

let moveInput = { x: 0, y: 0 }
let lookInput = { x: 0, y: 0 }

function emit() {
  socket.emit('joystick-move', { move: moveInput, look: lookInput })
}

function polarToCartesian(angle, force) {
  const f = Math.min(force, 1)
  return {
    x: +(Math.cos(angle) * f).toFixed(3),
    y: +(Math.sin(angle) * f).toFixed(3),
  }
}

function createStick(zoneId, coordsId, onMove, onEnd) {
  const zone = document.getElementById(zoneId)
  const coordsEl = document.getElementById(coordsId)

  const stick = nipplejs.create({
    zone,
    mode: 'static',
    position: { left: '50%', top: '50%' },
    color: '#5b6af0',
    size: 150,
    restJoystick: true,
  })

  stick.on('move', (_e, data) => {
    const { x, y } = polarToCartesian(data.angle.radian, data.force)
    coordsEl.innerHTML = `x: ${x.toFixed(2)} &nbsp; y: ${y.toFixed(2)}`
    onMove(x, y)
    emit()
  })

  stick.on('end', () => {
    coordsEl.innerHTML = `x: 0.00 &nbsp; y: 0.00`
    onEnd()
    emit()
  })

  return stick
}

// Left joystick — forward/back/left/right (horizontal plane)
createStick(
  'zone-left', 'coords-left',
  (x, y) => { moveInput = { x, y } },
  ()      => { moveInput = { x: 0, y: 0 } },
)

// Right joystick — up/down + yaw CW/CCW
createStick(
  'zone-right', 'coords-right',
  (x, y) => { lookInput = { x, y } },
  ()      => { lookInput = { x: 0, y: 0 } },
)
