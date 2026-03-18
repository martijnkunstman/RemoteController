import { io } from 'socket.io-client'
import nipplejs from 'nipplejs'

const statusEl = document.getElementById('status')
const coordsEl = document.getElementById('coords')
const zoneEl = document.getElementById('zone')

// --- Socket.IO ---
// Connecting without a URL works in both dev (Vite proxies /socket.io → Express)
// and in production (Express serves everything on the same origin).
const socket = io()

socket.on('connect', () => {
  statusEl.textContent = 'Connected'
  statusEl.classList.add('connected')
})

socket.on('disconnect', () => {
  statusEl.textContent = 'Disconnected'
  statusEl.classList.remove('connected')
})

// --- Nipplejs joystick ---
const joystick = nipplejs.create({
  zone: zoneEl,
  mode: 'static',
  position: { left: '50%', top: '50%' },
  color: '#5b6af0',
  size: 180,
  restJoystick: true,
})

joystick.on('move', (_event, data) => {
  const angle = data.angle.radian
  const force = Math.min(data.force, 1) // clamp to 0..1

  // Convert polar → normalized cartesian (-1..1)
  const x = +(Math.cos(angle) * force).toFixed(3)
  const y = +(Math.sin(angle) * force).toFixed(3)

  coordsEl.innerHTML = `x: ${x.toFixed(2)} &nbsp; y: ${y.toFixed(2)}`
  socket.emit('joystick-move', { x, y })
})

joystick.on('end', () => {
  coordsEl.innerHTML = `x: 0.00 &nbsp; y: 0.00`
  socket.emit('joystick-move', { x: 0, y: 0 })
})
