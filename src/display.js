import { io } from 'socket.io-client'
import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  DirectionalLight,
  Vector3,
  Color3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  PointLight,
  Matrix,
} from '@babylonjs/core'

const statusEl      = document.getElementById('status')
const joystickCountEl = document.getElementById('joystick-count')
const labelsEl      = document.getElementById('labels')
const canvas        = document.getElementById('renderCanvas')

// ─── Babylon engine & scene ───────────────────────────────────────────────────
const engine = new Engine(canvas, true, { antialias: true })
const scene  = new Scene(engine)
scene.clearColor = new Color4(0.05, 0.05, 0.08, 1)

// ─── Camera ───────────────────────────────────────────────────────────────────
const camera = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3.5, 24, Vector3.Zero(), scene)
camera.lowerRadiusLimit = 8
camera.upperRadiusLimit = 50
camera.attachControl(canvas, true)

// ─── Lighting ─────────────────────────────────────────────────────────────────
const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
hemi.intensity = 0.45
hemi.diffuse     = new Color3(0.8, 0.85, 1)
hemi.groundColor = new Color3(0.1, 0.1, 0.2)

const sun = new DirectionalLight('sun', new Vector3(-1, -2, -1.5), scene)
sun.intensity = 0.9
sun.diffuse = new Color3(1, 0.95, 0.85)

// ─── Arena (wireframe box) ────────────────────────────────────────────────────
const ARENA = 10
const HALF  = ARENA / 2

const arenaMesh = MeshBuilder.CreateBox('arena', { size: ARENA }, scene)
arenaMesh.isPickable = false
const arenaMat = new StandardMaterial('arenaMat', scene)
arenaMat.wireframe = true
arenaMat.emissiveColor = new Color3(0.22, 0.25, 0.5)
arenaMesh.material = arenaMat

const floor = MeshBuilder.CreateGround('floor', { width: ARENA, height: ARENA, subdivisions: 10 }, scene)
floor.position.y = -HALF
floor.isPickable = false
const floorMat = new StandardMaterial('floorMat', scene)
floorMat.wireframe = true
floorMat.emissiveColor = new Color3(0.16, 0.16, 0.3)
floor.material = floorMat

// ─── Vehicle palette ──────────────────────────────────────────────────────────
// Each slot: [diffuse R,G,B], [emissive R,G,B], [glow R,G,B], CSS hex for label
const PALETTE = [
  { d: [0.36, 0.42, 0.94], e: [0.08, 0.10, 0.28], g: [0.4, 0.5, 1.0],  css: '#7b8fff' },  // blue
  { d: [0.94, 0.32, 0.32], e: [0.28, 0.06, 0.06], g: [1.0, 0.35, 0.35], css: '#ff6060' }, // red
  { d: [0.28, 0.90, 0.46], e: [0.05, 0.26, 0.11], g: [0.35, 1.0, 0.5],  css: '#5eff82' }, // green
  { d: [0.80, 0.32, 0.94], e: [0.22, 0.06, 0.28], g: [0.85, 0.38, 1.0], css: '#cc60ff' }, // purple
  { d: [0.94, 0.80, 0.22], e: [0.28, 0.22, 0.04], g: [1.0, 0.88, 0.3],  css: '#ffdc44' }, // yellow
  { d: [0.22, 0.88, 0.90], e: [0.04, 0.24, 0.26], g: [0.3, 1.0, 1.0],   css: '#44f0ff' }, // cyan
  { d: [0.94, 0.32, 0.74], e: [0.28, 0.06, 0.20], g: [1.0, 0.38, 0.82], css: '#ff60cc' }, // pink
  { d: [0.94, 0.56, 0.20], e: [0.28, 0.14, 0.04], g: [1.0, 0.62, 0.28], css: '#ff9644' }, // orange
]

// ─── Vehicle management ────────────────────────────────────────────────────────
const BULLET_SPEED = 18
const MAX_BULLETS  = 30
const MOVE_SPEED   = 6
const ROT_SPEED    = 2

// joystickId (number) -> vehicle data
const vehicles = new Map()

function palette(joystickId) {
  return PALETTE[(joystickId - 1) % PALETTE.length]
}

function createVehicle(joystickId) {
  const col = palette(joystickId)

  // Stagger starting positions so vehicles don't spawn on top of each other
  const angle  = ((joystickId - 1) / PALETTE.length) * Math.PI * 2
  const startX = Math.sin(angle) * 3
  const startZ = Math.cos(angle) * 3
  const state  = { x: startX, y: 0, z: startZ, yaw: angle + Math.PI }

  const pivot = new TransformNode(`pivot-${joystickId}`, scene)

  const pyramid = MeshBuilder.CreateCylinder(`pyramid-${joystickId}`, {
    diameterTop: 0,
    diameterBottom: 1.0,
    height: 2.2,
    tessellation: 4,
  }, scene)
  pyramid.parent    = pivot
  pyramid.rotation.x = Math.PI / 2

  const mat = new StandardMaterial(`mat-${joystickId}`, scene)
  mat.diffuseColor  = new Color3(...col.d)
  mat.emissiveColor = new Color3(...col.e)
  mat.specularColor = new Color3(0.7, 0.75, 1.0)
  mat.specularPower = 64
  pyramid.material  = mat

  const glow = new PointLight(`glow-${joystickId}`, Vector3.Zero(), scene)
  glow.diffuse   = new Color3(...col.g)
  glow.specular  = new Color3(...col.g)
  glow.intensity = 2.5
  glow.range     = 6

  // Bullet material inherits vehicle color, fully emissive
  const bulletMat = new StandardMaterial(`bmat-${joystickId}`, scene)
  bulletMat.diffuseColor  = new Color3(...col.d)
  bulletMat.emissiveColor = new Color3(...col.d)
  bulletMat.specularColor = new Color3(1, 1, 1)

  // 2D HTML label overlay
  const label = document.createElement('div')
  label.className = 'vehicle-label'
  label.textContent = String(joystickId).padStart(2, '0')
  label.style.color       = col.css
  label.style.borderColor = col.css
  label.style.boxShadow   = `0 0 6px ${col.css}55`
  labelsEl.appendChild(label)

  const input   = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 } }
  const bullets = []

  return { pivot, pyramid, mat, glow, bulletMat, state, input, bullets, label }
}

function spawnBullet(vehicle) {
  const { bullets, bulletMat, pivot, state } = vehicle

  if (bullets.length >= MAX_BULLETS) {
    const old = bullets.shift()
    old.mesh.dispose()
  }

  const mesh = MeshBuilder.CreateSphere('bullet', { diameter: 0.28, segments: 5 }, scene)
  mesh.material  = bulletMat
  mesh.isPickable = false

  const tipDist = 1.1
  mesh.position.set(
    pivot.position.x + Math.sin(state.yaw) * tipDist,
    pivot.position.y,
    pivot.position.z + Math.cos(state.yaw) * tipDist,
  )

  bullets.push({ mesh, vx: Math.sin(state.yaw), vz: Math.cos(state.yaw) })
}

function removeVehicle(joystickId) {
  const v = vehicles.get(joystickId)
  if (!v) return
  v.pyramid.dispose()
  v.pivot.dispose()
  v.glow.dispose()
  v.mat.dispose()
  v.bulletMat.dispose()
  v.bullets.forEach(b => b.mesh.dispose())
  v.label.remove()
  vehicles.delete(joystickId)
}

// ─── Render loop ───────────────────────────────────────────────────────────────
engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime() / 1000

  for (const [, v] of vehicles) {
    const { state, input, pivot, glow, bullets, label } = v

    const fwdX =  Math.sin(state.yaw)
    const fwdZ =  Math.cos(state.yaw)
    const rtX  =  Math.cos(state.yaw)
    const rtZ  = -Math.sin(state.yaw)

    state.x   += (input.move.y * fwdX + input.move.x * rtX) * MOVE_SPEED * dt
    state.z   += (input.move.y * fwdZ + input.move.x * rtZ) * MOVE_SPEED * dt
    state.y   +=  input.look.y * MOVE_SPEED * dt
    state.yaw +=  input.look.x * ROT_SPEED  * dt

    const M = 0.9
    state.x = Math.max(-HALF + M, Math.min(HALF - M, state.x))
    state.y = Math.max(-HALF + M, Math.min(HALF - M, state.y))
    state.z = Math.max(-HALF + M, Math.min(HALF - M, state.z))

    pivot.position.set(state.x, state.y, state.z)
    pivot.rotation.y = state.yaw
    glow.position.copyFrom(pivot.position)

    // Bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i]
      b.mesh.position.x += b.vx * BULLET_SPEED * dt
      b.mesh.position.z += b.vz * BULLET_SPEED * dt
      const p = b.mesh.position
      if (Math.abs(p.x) > HALF || Math.abs(p.y) > HALF || Math.abs(p.z) > HALF) {
        b.mesh.dispose()
        bullets.splice(i, 1)
      }
    }

    // Project 3D position → 2D screen for label overlay
    const proj = Vector3.Project(
      pivot.position,
      Matrix.Identity(),
      scene.getTransformMatrix(),
      camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
    )
    if (proj.z > 0 && proj.z < 1) {
      label.style.display = 'block'
      label.style.left    = `${proj.x + 18}px`
      label.style.top     = `${proj.y - 14}px`
    } else {
      label.style.display = 'none'
    }
  }

  scene.render()
})

window.addEventListener('resize', () => engine.resize())

// ─── Socket.IO ────────────────────────────────────────────────────────────────
const socket = io()

socket.on('connect', () => {
  statusEl.textContent = 'Connected'
  statusEl.classList.add('connected')
})

socket.on('disconnect', () => {
  statusEl.textContent = 'Disconnected'
  statusEl.classList.remove('connected')
  // Stop all vehicle inputs
  for (const [, v] of vehicles) {
    v.input = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 } }
  }
})

socket.on('joystick-list', (ids) => {
  // Add vehicles for newly connected joysticks
  for (const id of ids) {
    if (!vehicles.has(id)) {
      vehicles.set(id, createVehicle(id))
    }
  }
  // Remove vehicles for disconnected joysticks
  for (const id of [...vehicles.keys()]) {
    if (!ids.includes(id)) removeVehicle(id)
  }
  const n = ids.length
  joystickCountEl.textContent = n === 0
    ? 'No joysticks'
    : `${n} joystick${n !== 1 ? 's' : ''} connected`
})

socket.on('dot-move', (data) => {
  const v = vehicles.get(data.joystickId)
  if (v) v.input = data
})

socket.on('fire', (data) => {
  const v = vehicles.get(data.joystickId)
  if (v) spawnBullet(v)
})
