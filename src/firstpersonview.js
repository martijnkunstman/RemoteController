import { io } from 'socket.io-client'
import {
  Engine,
  Scene,
  FreeCamera,
  HemisphericLight,
  Vector3,
  Color3,
  Color4,
  PointLight,
  Scalar,
} from '@babylonjs/core'
import { GRID, CELL, HALF, HALF_Y } from './worldConstants.js'
import { WorldRenderer } from './WorldRenderer.js'
import { VehicleManager, TEAM_COLOR, BULLET_SPEED } from './VehicleManager.js'

// ─── FPVApp ───────────────────────────────────────────────────────────────────
// First-person view: FreeCamera that follows the player's own vehicle.
class FPVApp {
  constructor(canvas) {
    this.canvas  = canvas
    this.myId    = parseInt(new URLSearchParams(location.search).get('id') ?? '0', 10)
    this.cameraTarget = new Vector3()   // reused every frame

    this.engine = new Engine(canvas, true, { antialias: true })
    this.scene  = new Scene(this.engine)
    this.scene.clearColor = new Color4(0, 0, 0, 1)

    this._setupScene()

    this.worldRenderer  = new WorldRenderer(this.scene)
    this.vehicleManager = new VehicleManager(this.scene, { myId: this.myId })

    this.socket = io()
    this.initSockets()
    this.startRenderLoop()

    window.addEventListener('resize', () => this.engine.resize())
  }

  _setupScene() {
    // First-person camera
    this.camera     = new FreeCamera('fpv', new Vector3(0, 0, -1), this.scene)
    this.camera.minZ = 0.1
    this.camera.maxZ = 400
    this.camera.fov  = 1.4

    // Lighting
    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), this.scene)
    hemi.intensity   = 0.88
    hemi.diffuse     = new Color3(0.80, 0.72, 0.58)
    hemi.groundColor = new Color3(0.50, 0.42, 0.32)

    // Soft player glow — follows camera
    this.playerLight = new PointLight('playerLight', new Vector3(0, 0, 0), this.scene)
    this.playerLight.diffuse   = new Color3(1.0, 0.92, 0.80)
    this.playerLight.specular  = new Color3(1.0, 0.92, 0.80)
    this.playerLight.intensity = 3.0
    this.playerLight.range     = 16

    // Fog
    this.scene.fogMode    = Scene.FOGMODE_EXP2
    this.scene.fogColor   = new Color3(0, 0, 0)
    this.scene.fogDensity = 0.030
  }

  startRenderLoop() {
    this.engine.runRenderLoop(() => this._renderTick())
  }

  _renderTick() {
    const dt = this.engine.getDeltaTime() / 1000

    for (const [, v] of this.vehicleManager.vehicles) {
      const { state, targetState, pivot, glow, bullets } = v

      const W = GRID * CELL
      if (Math.abs(targetState.x - state.x) > W / 2) state.x = targetState.x
      if (Math.abs(targetState.z - state.z) > W / 2) state.z = targetState.z

      const blend = Math.min(dt * 15, 1.0)
      state.x = Scalar.Lerp(state.x, targetState.x, blend)
      state.y = Scalar.Lerp(state.y, targetState.y, blend)
      state.z = Scalar.Lerp(state.z, targetState.z, blend)
      state.yaw = Scalar.LerpAngle(state.yaw, targetState.yaw, blend)

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
    }

    // FPV camera follows own vehicle
    const own = this.vehicleManager.getVehicle(this.myId)
    if (own) {
      const { state } = own
      this.camera.position.set(state.x, state.y, state.z)
      this.cameraTarget.set(
        state.x + Math.sin(state.yaw),
        state.y,
        state.z + Math.cos(state.yaw),
      )
      this.camera.setTarget(this.cameraTarget)
      this.playerLight.position.copyFrom(this.camera.position)
    }

    this.scene.render()
  }

  // ── Socket.IO ───────────────────────────────────────────────────────────────

  initSockets() {
    this.socket.on('world',          (data)          => this._onWorld(data))
    this.socket.on('joystick-list',  (members)       => this._onJoystickList(members))
    this.socket.on('score-update',   ({ blue, red })  => this._onScoreUpdate(blue, red))
    this.socket.on('hit',            ({ targetId })  => this._onHit(targetId))
    this.socket.on('vehicle-states', (states)        => this._onVehicleStates(states))
    this.socket.on('fire',           (data)          => this._onFire(data))
  }

  _onWorld(data) {
    this.worldRenderer.build(new Uint8Array(data))
  }

  _onJoystickList(members) {
    this.vehicleManager.syncList(members)
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
      if (v) { v.targetState.x = data.x; v.targetState.y = data.y; v.targetState.z = data.z; v.targetState.yaw = data.yaw }
    }
  }

  _onFire(data) {
    const v = this.vehicleManager.getVehicle(data.joystickId)
    if (v) this.vehicleManager.spawnBullet(v)
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
new FPVApp(document.getElementById('renderCanvas'))
