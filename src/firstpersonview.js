import { io } from 'socket.io-client'
import {
  Engine,
  Scene,
  FreeCamera,
  HemisphericLight,
  Vector3,
  Color3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  PointLight,
  GlowLayer,
  DynamicTexture,
} from '@babylonjs/core'

const canvas = document.getElementById('renderCanvas')

// My joystick ID — read from ?id=N in the URL
const myId = parseInt(new URLSearchParams(location.search).get('id') ?? '0', 10)

// ─── Babylon engine & scene ───────────────────────────────────────────────────
const engine = new Engine(canvas, true, { antialias: true })
const scene  = new Scene(engine)
scene.clearColor = new Color4(0.03, 0.04, 0.07, 1)

// ─── Camera ───────────────────────────────────────────────────────────────────
const camera = new FreeCamera('fpv', new Vector3(0, 0, -1), scene)
camera.minZ = 0.1

// ─── Lighting ─────────────────────────────────────────────────────────────────
const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
hemi.intensity   = 0.15
hemi.diffuse     = new Color3(0.5, 0.6, 0.8)
hemi.groundColor = new Color3(0.02, 0.02, 0.05)

const ceil1 = new PointLight('ceil1', new Vector3( 15, 23,  15), scene)
ceil1.diffuse   = new Color3(0.6, 0.75, 1.0)
ceil1.specular  = new Color3(0.4, 0.55, 1.0)
ceil1.intensity = 1.2
ceil1.range     = 35

const ceil2 = new PointLight('ceil2', new Vector3(-15, 23, -15), scene)
ceil2.diffuse   = new Color3(0.6, 0.75, 1.0)
ceil2.specular  = new Color3(0.4, 0.55, 1.0)
ceil2.intensity = 1.2
ceil2.range     = 35

const warn1 = new PointLight('warn1', new Vector3( 23, -12, 0), scene)
warn1.diffuse   = new Color3(1.0, 0.1, 0.05)
warn1.specular  = new Color3(0.8, 0.05, 0.0)
warn1.intensity = 0.5
warn1.range     = 14

const warn2 = new PointLight('warn2', new Vector3(-23, -12, 0), scene)
warn2.diffuse   = new Color3(1.0, 0.1, 0.05)
warn2.specular  = new Color3(0.8, 0.05, 0.0)
warn2.intensity = 0.5
warn2.range     = 14

// ─── Arena ────────────────────────────────────────────────────────────────────
const ARENA = 50
const HALF  = ARENA / 2

const arenaMesh = MeshBuilder.CreateBox('arena', { size: ARENA }, scene)
arenaMesh.isPickable = false
const arenaMat = new StandardMaterial('arenaMat', scene)
arenaMat.wireframe    = true
arenaMat.emissiveColor = new Color3(0.15, 0.45, 1.0)
arenaMesh.material    = arenaMat

const floor = MeshBuilder.CreateGround('floor', { width: ARENA, height: ARENA, subdivisions: 10 }, scene)
floor.position.y  = -HALF
floor.isPickable  = false
const floorMat = new StandardMaterial('floorMat', scene)
floorMat.wireframe    = true
floorMat.emissiveColor = new Color3(0.08, 0.25, 0.55)
floor.material = floorMat

// ─── Starfield sphere ─────────────────────────────────────────────────────────
function makeStarfieldTex() {
  const size = 512
  const tex = new DynamicTexture('starsTex', { width: size, height: size }, scene)
  const ctx = tex.getContext()
  ctx.fillStyle = '#03040a'
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 600; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const r = Math.random() * 1.4 + 0.2
    const v = Math.floor(Math.random() * 120 + 135)
    const b = Math.random() > 0.65 ? Math.min(255, v + Math.floor(Math.random() * 80)) : v
    ctx.fillStyle = `rgb(${v},${v},${b})`
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
  }
  tex.update()
  return tex
}

const starSphere = MeshBuilder.CreateSphere('stars', { diameter: 400, segments: 8 }, scene)
starSphere.isPickable = false
const starMat = new StandardMaterial('starMat', scene)
starMat.emissiveTexture = makeStarfieldTex()
starMat.diffuseColor   = new Color3(0, 0, 0)
starMat.backFaceCulling = false
starSphere.material = starMat

// ─── Ceiling light strips ─────────────────────────────────────────────────────
const ceilStripMat = new StandardMaterial('ceilStripMat', scene)
ceilStripMat.emissiveColor = new Color3(0.15, 0.5, 1.0)
ceilStripMat.diffuseColor  = new Color3(0, 0, 0)

const ceilY = HALF - 1

const cstrip1 = MeshBuilder.CreateBox('cstrip1', { width: 40, height: 0.4, depth: 0.8 }, scene)
cstrip1.position.set(0, ceilY, 0)
cstrip1.isPickable = false
cstrip1.material   = ceilStripMat

const cstrip2 = MeshBuilder.CreateBox('cstrip2', { width: 0.8, height: 0.4, depth: 40 }, scene)
cstrip2.position.set(0, ceilY, 0)
cstrip2.isPickable = false
cstrip2.material   = ceilStripMat

// ─── GlowLayer ────────────────────────────────────────────────────────────────
const glowLayer = new GlowLayer('glow', scene)
glowLayer.intensity = 0.7

// ─── Fog ──────────────────────────────────────────────────────────────────────
scene.fogMode    = Scene.FOGMODE_EXP2
scene.fogColor   = new Color3(0.03, 0.04, 0.07)
scene.fogDensity = 0.012

// ─── Obstacles ────────────────────────────────────────────────────────────────
const obstacleMat = new StandardMaterial('obstacleMat', scene)
obstacleMat.diffuseColor  = new Color3(0.08, 0.09, 0.12)
obstacleMat.emissiveColor = new Color3(0.03, 0.05, 0.10)
obstacleMat.specularColor = new Color3(0.4, 0.5, 0.8)
obstacleMat.specularPower = 48

const ringMat = new StandardMaterial('ringMat', scene)
ringMat.emissiveColor = new Color3(0.1, 0.5, 1.0)
ringMat.diffuseColor  = new Color3(0, 0, 0)

for (const [px, pz] of [[14,14],[14,-14],[-14,14],[-14,-14]]) {
  const pillar = MeshBuilder.CreateCylinder(`pillar_${px}_${pz}`, {
    diameter: 3, height: ARENA, tessellation: 12,
  }, scene)
  pillar.position.set(px, 0, pz)
  pillar.isPickable = false
  pillar.material   = obstacleMat

  for (const ry of [-HALF + 1, HALF - 1]) {
    const ring = MeshBuilder.CreateTorus(`ring_${px}_${pz}_${ry}`, {
      diameter: 3.6, thickness: 0.18, tessellation: 24,
    }, scene)
    ring.position.set(px, ry, pz)
    ring.isPickable = false
    ring.material   = ringMat
  }
}

const towerH = 9
const towerY = -HALF + towerH / 2

const towerA = MeshBuilder.CreateBox('towerA', { width: 14, height: towerH, depth: 1.5 }, scene)
towerA.position.set(0, towerY, 0)
towerA.isPickable = false
towerA.material   = obstacleMat

const towerB = MeshBuilder.CreateBox('towerB', { width: 1.5, height: towerH, depth: 14 }, scene)
towerB.position.set(0, towerY, 0)
towerB.isPickable = false
towerB.material   = obstacleMat

const towerGlowMat = new StandardMaterial('towerGlowMat', scene)
towerGlowMat.emissiveColor = new Color3(0.1, 0.5, 1.0)
towerGlowMat.diffuseColor  = new Color3(0, 0, 0)
const topY = -HALF + towerH + 0.15

const tStripA = MeshBuilder.CreateBox('tStripA', { width: 14.2, height: 0.2, depth: 1.7 }, scene)
tStripA.position.set(0, topY, 0)
tStripA.isPickable = false
tStripA.material   = towerGlowMat

const tStripB = MeshBuilder.CreateBox('tStripB', { width: 1.7, height: 0.2, depth: 14.2 }, scene)
tStripB.position.set(0, topY, 0)
tStripB.isPickable = false
tStripB.material   = towerGlowMat

// ─── Vehicle palette (must match display.js) ──────────────────────────────────
const PALETTE = [
  { d: [0.36, 0.42, 0.94], e: [0.08, 0.10, 0.28], g: [0.4, 0.5, 1.0] },
  { d: [0.94, 0.32, 0.32], e: [0.28, 0.06, 0.06], g: [1.0, 0.35, 0.35] },
  { d: [0.28, 0.90, 0.46], e: [0.05, 0.26, 0.11], g: [0.35, 1.0, 0.5] },
  { d: [0.80, 0.32, 0.94], e: [0.22, 0.06, 0.28], g: [0.85, 0.38, 1.0] },
  { d: [0.94, 0.80, 0.22], e: [0.28, 0.22, 0.04], g: [1.0, 0.88, 0.3] },
  { d: [0.22, 0.88, 0.90], e: [0.04, 0.24, 0.26], g: [0.3, 1.0, 1.0] },
  { d: [0.94, 0.32, 0.74], e: [0.28, 0.06, 0.20], g: [1.0, 0.38, 0.82] },
  { d: [0.94, 0.56, 0.20], e: [0.28, 0.14, 0.04], g: [1.0, 0.62, 0.28] },
]

function palette(id) { return PALETTE[(id - 1) % PALETTE.length] }

// ─── Vehicle management ────────────────────────────────────────────────────────
const BULLET_SPEED = 18
const MAX_BULLETS  = 30

const vehicles = new Map()

function createVehicle(id) {
  const col   = palette(id)
  const angle = ((id - 1) / PALETTE.length) * Math.PI * 2
  const state = { x: Math.sin(angle) * 3, y: 0, z: Math.cos(angle) * 3, yaw: angle + Math.PI }

  const pivot = new TransformNode(`pivot-${id}`, scene)

  const pyramid = MeshBuilder.CreateCylinder(`pyramid-${id}`, {
    diameterTop: 0, diameterBottom: 1.0, height: 2.2, tessellation: 4,
  }, scene)
  pyramid.parent     = pivot
  pyramid.rotation.x = Math.PI / 2

  if (id === myId) pyramid.isVisible = false

  const mat = new StandardMaterial(`mat-${id}`, scene)
  mat.diffuseColor  = new Color3(...col.d)
  mat.emissiveColor = new Color3(...col.e)
  mat.specularColor = new Color3(0.7, 0.75, 1.0)
  mat.specularPower = 64
  pyramid.material  = mat

  const glow = new PointLight(`glow-${id}`, Vector3.Zero(), scene)
  glow.diffuse   = new Color3(...col.g)
  glow.specular  = new Color3(...col.g)
  glow.intensity = 3.0
  glow.range     = 10

  const bulletMat = new StandardMaterial(`bmat-${id}`, scene)
  bulletMat.diffuseColor  = new Color3(...col.d)
  bulletMat.emissiveColor = new Color3(...col.d)

  const bullets = []

  return { pivot, pyramid, mat, glow, bulletMat, state, bullets }
}

function spawnBullet(vehicle) {
  const { bullets, bulletMat, pivot, state } = vehicle
  if (bullets.length >= MAX_BULLETS) {
    bullets.shift().mesh.dispose()
  }
  const mesh = MeshBuilder.CreateSphere('bullet', { diameter: 0.28, segments: 5 }, scene)
  mesh.material   = bulletMat
  mesh.isPickable = false
  const tipDist = 1.1
  mesh.position.set(
    pivot.position.x + Math.sin(state.yaw) * tipDist,
    pivot.position.y,
    pivot.position.z + Math.cos(state.yaw) * tipDist,
  )
  bullets.push({ mesh, vx: Math.sin(state.yaw), vz: Math.cos(state.yaw) })
}

function removeVehicle(id) {
  const v = vehicles.get(id)
  if (!v) return
  v.pyramid.dispose()
  v.pivot.dispose()
  v.glow.dispose()
  v.mat.dispose()
  v.bulletMat.dispose()
  v.bullets.forEach(b => b.mesh.dispose())
  vehicles.delete(id)
}

// ─── Render loop ───────────────────────────────────────────────────────────────
engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime() / 1000   // used for bullet movement

  for (const [, v] of vehicles) {
    const { state, pivot, glow, bullets } = v

    pivot.position.set(state.x, state.y, state.z)
    pivot.rotation.y = state.yaw
    glow.position.copyFrom(pivot.position)

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
  }

  // First-person camera follows own vehicle
  const own = vehicles.get(myId)
  if (own) {
    const { state } = own
    camera.position.set(state.x, state.y, state.z)
    camera.setTarget(new Vector3(
      state.x + Math.sin(state.yaw),
      state.y,
      state.z + Math.cos(state.yaw),
    ))
  }

  scene.render()
})

window.addEventListener('resize', () => engine.resize())

// ─── Socket.IO ────────────────────────────────────────────────────────────────
const socket = io()

socket.on('joystick-list', (ids) => {
  for (const id of ids) {
    if (!vehicles.has(id)) vehicles.set(id, createVehicle(id))
  }
  for (const id of [...vehicles.keys()]) {
    if (!ids.includes(id)) removeVehicle(id)
  }
})

socket.on('vehicle-state', (data) => {
  const v = vehicles.get(data.joystickId)
  if (v) { v.state.x = data.x; v.state.y = data.y; v.state.z = data.z; v.state.yaw = data.yaw }
})

socket.on('fire', (data) => {
  const v = vehicles.get(data.joystickId)
  if (v) spawnBullet(v)
})
