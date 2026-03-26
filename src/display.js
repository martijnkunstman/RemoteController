import { io } from 'socket.io-client'
import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  Vector3,
  Color3,
  Color4,
  Matrix,
} from '@babylonjs/core'
import { GRID, CELL, HALF, HALF_Y } from './worldConstants.js'
import { WorldRenderer } from './WorldRenderer.js'
import { VehicleManager, TEAM_COLOR, BULLET_SPEED } from './VehicleManager.js'

// ─── Display constants ────────────────────────────────────────────────────────
const AUTO_ROTATE_SPEED = 0.2

// ─── DisplayApp ───────────────────────────────────────────────────────────────
// Main class: sets up the BabylonJS scene, owns WorldRenderer and VehicleManager,
// runs the render loop, and handles all Socket.IO events.
class DisplayApp {
  constructor(canvas) {
    this.canvas          = canvas
    this.statusEl        = document.getElementById('status')
    this.joystickCountEl = document.getElementById('joystick-count')
    this.autoRotateEl    = document.getElementById('auto-rotate')

    this.engine = new Engine(canvas, true, { antialias: true })
    this.scene  = new Scene(this.engine)
    this.scene.clearColor = new Color4(0, 0, 0, 1)

    this._setupScene()

    this.worldRenderer  = new WorldRenderer(this.scene, { skipCeiling: true })
    this.vehicleManager = new VehicleManager(this.scene, { labelsEl: document.getElementById('labels') })

    this.socket = io()
    this.initSockets()
    this.startRenderLoop()

    window.addEventListener('resize', () => this.engine.resize())
  }

  _setupScene() {
    // Camera
    this.camera = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3.5, 80, Vector3.Zero(), this.scene)
    this.camera.lowerRadiusLimit = 20
    this.camera.upperRadiusLimit = 400
    this.camera.maxZ = 600
    this.camera.attachControl(this.canvas, true)

    // Auto-rotate persistence
    const saved = localStorage.getItem('autoRotate')
    this.autoRotateEl.checked = saved === 'true'
    this.autoRotateEl.addEventListener('change', () => {
      localStorage.setItem('autoRotate', this.autoRotateEl.checked)
    })

    // Lighting
    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), this.scene)
    hemi.intensity   = 0.88
    hemi.diffuse     = new Color3(0.80, 0.72, 0.58)
    hemi.groundColor = new Color3(0.50, 0.42, 0.32)

    // Fog
    this.scene.fogMode    = Scene.FOGMODE_EXP2
    this.scene.fogColor   = new Color3(0, 0, 0)
    this.scene.fogDensity = 0.030
  }

  startRenderLoop() {
    this.engine.runRenderLoop(() => this._renderTick())
  }

  _renderTick() {
    const dt              = this.engine.getDeltaTime() / 1000
    const transformMatrix = this.scene.getTransformMatrix()
    const viewport        = this.camera.viewport.toGlobal(this.engine.getRenderWidth(), this.engine.getRenderHeight())

    for (const [, v] of this.vehicleManager.vehicles) {
      const { state, pivot, glow, bullets, label } = v

      pivot.position.set(state.x, state.y, state.z)
      pivot.rotation.y = state.yaw
      glow.position.copyFrom(pivot.position)

      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i]
        if (b.hitTimer !== undefined) {
          b.hitTimer -= dt
          if (b.hitTimer <= 0) { b.light.dispose(); b.mesh.dispose(); bullets.splice(i, 1) }
          continue
        }
        b.mesh.position.x += b.vx * BULLET_SPEED * dt
        b.mesh.position.z += b.vz * BULLET_SPEED * dt
        const p = b.mesh.position
        const W = GRID * CELL
        b.mesh.position.x = ((p.x + HALF) % W + W) % W - HALF
        b.mesh.position.z = ((p.z + HALF) % W + W) % W - HALF
        if (Math.abs(p.y) > HALF_Y) { b.light.dispose(); b.mesh.dispose(); bullets.splice(i, 1); continue }
        b.light.position.copyFrom(b.mesh.position)
        if (this.worldRenderer.bulletHitsWorld(p)) {
          b.hitTimer = 0.12
          b.mesh.scaling.setAll(3)
          b.light.intensity = 0
          continue
        }
      }

      if (label) {
        const proj = Vector3.Project(pivot.position, Matrix.Identity(), transformMatrix, viewport)
        if (proj.z > 0 && proj.z < 1) {
          label.style.display = 'block'
          label.style.left    = `${proj.x + 18}px`
          label.style.top     = `${proj.y - 14}px`
        } else {
          label.style.display = 'none'
        }
      }
    }

    if (this.autoRotateEl.checked) this.camera.alpha += AUTO_ROTATE_SPEED * dt
    this.scene.render()
  }

  // ── Socket.IO ───────────────────────────────────────────────────────────────

  initSockets() {
    this.socket.on('connect',        () => this._onConnect())
    this.socket.on('disconnect',     () => this._onDisconnect())
    this.socket.on('world',          (data)         => this._onWorld(data))
    this.socket.on('joystick-list',  (members)      => this._onJoystickList(members))
    this.socket.on('score-update',   ({ blue, red }) => this._onScoreUpdate(blue, red))
    this.socket.on('hit',            ({ targetId }) => this._onHit(targetId))
    this.socket.on('vehicle-states', (states)       => this._onVehicleStates(states))
    this.socket.on('fire',           (data)         => this._onFire(data))
  }

  _onConnect() {
    this.statusEl.textContent = 'Connected'
    this.statusEl.classList.add('connected')
  }

  _onDisconnect() {
    this.statusEl.textContent = 'Disconnected'
    this.statusEl.classList.remove('connected')
  }

  _onWorld(data) {
    this.worldRenderer.build(new Uint8Array(data))
  }

  _onJoystickList(members) {
    this.vehicleManager.syncList(members)
    const humans = members.filter(m => !m.isBot).length
    this.joystickCountEl.textContent = humans === 0
      ? 'No players'
      : `${humans} player${humans !== 1 ? 's' : ''}`
  }

  _onScoreUpdate(blue, red) {
    document.getElementById('score-blue').textContent = `BLUE ${blue}`
    document.getElementById('score-red').textContent  = `RED ${red}`
  }

  _onHit(targetId) {
    const v = this.vehicleManager.getVehicle(targetId)
    if (!v) return
    v.mat.emissiveColor = new Color3(1, 1, 1)
    setTimeout(() => { v.mat.emissiveColor = new Color3(...TEAM_COLOR[v.team].e) }, 120)
  }

  _onVehicleStates(states) {
    for (const data of states) {
      const v = this.vehicleManager.getVehicle(data.joystickId)
      if (v) { v.state.x = data.x; v.state.y = data.y; v.state.z = data.z; v.state.yaw = data.yaw }
    }
  }

  _onFire(data) {
    const v = this.vehicleManager.getVehicle(data.joystickId)
    if (v) this.vehicleManager.spawnBullet(v)
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
new DisplayApp(document.getElementById('renderCanvas'))
