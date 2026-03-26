import { io } from 'socket.io-client'
import { InputController } from './InputController.js'
import { FireController } from './FireController.js'
import { Minimap } from './Minimap.js'

// ─── JoystickApp ──────────────────────────────────────────────────────────────
// Main entry point: owns the socket connection, badge/iframe management,
// and wires together InputController, FireController, and Minimap.
class JoystickApp {
  constructor() {
    this.socket          = io()
    this.statusEl        = document.getElementById('status')
    this.idBadgeEl       = document.getElementById('joystick-id')
    this.fpvFrame        = document.getElementById('fpv-frame')
    this.fpvPlaceholder  = document.getElementById('fpv-placeholder')

    this.inputController = new InputController(
      this.socket,
      document.getElementById('coords-left'),
      document.getElementById('coords-right'),
    )
    this.fireController = new FireController(
      this.socket,
      document.getElementById('btn-fire'),
    )
    this.minimap = new Minimap(this.socket)

    this.inputController.init()
    this.fireController.init()
    this.minimap.initSockets()
    this.minimap.draw()
    this.initSockets()
  }

  initSockets() {
    this.socket.on('connect',          () => this._onConnect())
    this.socket.on('disconnect',       () => this._onDisconnect())
    this.socket.on('joystick-assigned', (data) => this._onJoystickAssigned(data))
  }

  _onConnect() {
    this.statusEl.textContent = 'Connected'
    this.statusEl.classList.add('connected')
    this.socket.emit('register-joystick')
  }

  _onDisconnect() {
    this.statusEl.textContent = 'Disconnected'
    this.statusEl.classList.remove('connected')
    this.idBadgeEl.textContent = '--'
  }

  _onJoystickAssigned({ id }) {
    this.minimap.setMyId(id)
    this.idBadgeEl.textContent       = String(id).padStart(2, '0')
    this.fpvPlaceholder.style.display = 'none'
    this.fpvFrame.style.display      = 'block'
    this.fpvFrame.src                = `/firstpersonview.html?id=${id}`
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
new JoystickApp()
