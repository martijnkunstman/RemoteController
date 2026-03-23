import { io } from 'socket.io-client'
import {
  Engine,
  Scene,
  FreeCamera,
  HemisphericLight,
  SpotLight,
  Vector3,
  Color3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  PointLight,
} from '@babylonjs/core'

const canvas = document.getElementById('renderCanvas')

// My joystick ID — read from ?id=N in the URL
const myId = parseInt(new URLSearchParams(location.search).get('id') ?? '0', 10)

// ─── Babylon engine & scene ───────────────────────────────────────────────────
const engine = new Engine(canvas, true, { antialias: true })
const scene  = new Scene(engine)
scene.clearColor = new Color4(0.01, 0.01, 0.01, 1)

// ─── Camera ───────────────────────────────────────────────────────────────────
const camera = new FreeCamera('fpv', new Vector3(0, 0, -1), scene)
camera.minZ = 0.1
camera.fov  = 1.4   // ~80°

// ─── Cave lighting ────────────────────────────────────────────────────────────
const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
hemi.intensity   = 0.05
hemi.diffuse     = new Color3(0.3, 0.25, 0.2)
hemi.groundColor = new Color3(0.02, 0.01, 0.01)

// 4 warm torch-like point lights — repositioned after world is received
const torchColors = [
  new Color3(1.0, 0.55, 0.15),
  new Color3(1.0, 0.45, 0.10),
  new Color3(0.9, 0.60, 0.20),
  new Color3(1.0, 0.50, 0.05),
]
const torchLights = torchColors.map((col, i) => {
  const light = new PointLight(`torch${i}`, new Vector3(0, 0, 0), scene)
  light.diffuse   = col
  light.specular  = col
  light.intensity = 3.0
  light.range     = 24
  return light
})

// Vehicle headlight (SpotLight pointing forward, updated each frame)
const headlight = new SpotLight(
  'headlight',
  new Vector3(0, 0, 0),
  new Vector3(0, 0, 1),
  Math.PI / 3.5,   // ~51° cone
  2,               // exponent
  scene
)
headlight.diffuse   = new Color3(1.0, 0.95, 0.85)
headlight.specular  = new Color3(1.0, 0.95, 0.85)
headlight.intensity = 4.0
headlight.range     = 22

// ─── Cave fog ─────────────────────────────────────────────────────────────────
scene.fogMode    = Scene.FOGMODE_EXP2
scene.fogColor   = new Color3(0.01, 0.01, 0.01)
scene.fogDensity = 0.035

// ─── Voxel world constants (must match server/index.js) ───────────────────────
const GRID = 25
const CELL = 2
const HALF = GRID * CELL / 2   // 25

let worldGrid = null

function isSolid(cx, cy, cz) {
  if (!worldGrid) return false
  if (cx < 0 || cx >= GRID || cy < 0 || cy >= GRID || cz < 0 || cz >= GRID) return true
  return worldGrid[cx + cy * GRID + cz * GRID * GRID] === 1
}

function cellCenter(cx, cy, cz) {
  return new Vector3(
    (cx + 0.5) * CELL - HALF,
    (cy + 0.5) * CELL - HALF,
    (cz + 0.5) * CELL - HALF,
  )
}

// ─── Voxel scene build ────────────────────────────────────────────────────────
const rockColors = [
  new Color3(0.30, 0.27, 0.22),
  new Color3(0.22, 0.22, 0.25),
  new Color3(0.26, 0.28, 0.22),
]
let voxelRoots = []

function buildVoxelWorld(grid) {
  worldGrid = grid

  voxelRoots.forEach(r => r.dispose())
  voxelRoots = []

  const mats = rockColors.map((col, i) => {
    const mat = new StandardMaterial(`rockMat${i}`, scene)
    mat.diffuseColor  = col
    mat.specularColor = new Color3(0.04, 0.04, 0.04)
    mat.specularPower = 6
    return mat
  })

  const roots = mats.map((mat, i) => {
    const root = MeshBuilder.CreateBox(`rockRoot${i}`, { size: CELL - 0.05 }, scene)
    root.material   = mat
    root.isVisible  = false
    root.isPickable = false
    return root
  })
  voxelRoots = roots

  const faceDir = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]
  let count = 0

  for (let z = 0; z < GRID; z++)
    for (let y = 0; y < GRID; y++)
      for (let x = 0; x < GRID; x++) {
        if (!isSolid(x, y, z)) continue

        // FPV: include ALL blocks including outer shell (visible as cave walls)
        let surface = false
        for (const [dx, dy, dz] of faceDir) {
          if (!isSolid(x + dx, y + dy, z + dz)) { surface = true; break }
        }
        if (!surface) continue

        const matIdx = (x * 7 + y * 13 + z * 5) % 3
        const inst = roots[matIdx].createInstance(`v${count++}`)
        inst.position = cellCenter(x, y, z)
        inst.isPickable = false
      }

  console.log(`[Voxels] ${count} surface instances (fpv, with outer shell)`)
  repositionTorches()
}

function repositionTorches() {
  if (!worldGrid) return
  const quads = [[], [], [], []]
  for (let z = 1; z < GRID - 1; z++)
    for (let y = 1; y < GRID - 1; y++)
      for (let x = 1; x < GRID - 1; x++) {
        if (isSolid(x, y, z)) continue
        const q = (x < GRID / 2 ? 0 : 1) + (z < GRID / 2 ? 0 : 2)
        quads[q].push([x, y, z])
      }
  torchLights.forEach((light, i) => {
    const pool = quads[i].length > 0 ? quads[i] : quads.find(q => q.length > 0) || [[12, 12, 12]]
    const [cx, cy, cz] = pool[Math.floor(Math.random() * pool.length)]
    light.position = cellCenter(cx, cy, cz)
  })
}

// ─── Bullet world collision ───────────────────────────────────────────────────
function bulletHitsWorld(p) {
  if (!worldGrid) return false
  const cx = Math.floor((p.x + HALF) / CELL)
  const cy = Math.floor((p.y + HALF) / CELL)
  const cz = Math.floor((p.z + HALF) / CELL)
  return isSolid(cx, cy, cz)
}

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

const bulletMat = new StandardMaterial('bulletMat', scene)
bulletMat.diffuseColor  = new Color3(1, 0.08, 0.08)
bulletMat.emissiveColor = new Color3(1, 0,    0)
bulletMat.specularColor = new Color3(1, 0.4,  0.4)

const vehicles = new Map()

function createVehicle(id) {
  const col   = palette(id)
  const state = { x: 0, y: 0, z: 0, yaw: 0 }

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

  const bullets = []

  return { pivot, pyramid, mat, glow, state, bullets }
}

function spawnBullet(vehicle) {
  const { bullets, pivot, state } = vehicle
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
  v.bullets.forEach(b => b.mesh.dispose())
  vehicles.delete(id)
}

// ─── Render loop ───────────────────────────────────────────────────────────────
engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime() / 1000

  for (const [, v] of vehicles) {
    const { state, pivot, glow, bullets } = v

    pivot.position.set(state.x, state.y, state.z)
    pivot.rotation.y = state.yaw
    glow.position.copyFrom(pivot.position)

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i]

      if (b.hitTimer !== undefined) {
        b.hitTimer -= dt
        if (b.hitTimer <= 0) { b.mesh.dispose(); bullets.splice(i, 1) }
        continue
      }

      b.mesh.position.x += b.vx * BULLET_SPEED * dt
      b.mesh.position.z += b.vz * BULLET_SPEED * dt
      const p = b.mesh.position

      if (Math.abs(p.x) > HALF || Math.abs(p.y) > HALF || Math.abs(p.z) > HALF) {
        b.mesh.dispose(); bullets.splice(i, 1); continue
      }

      if (bulletHitsWorld(p)) {
        b.hitTimer = 0.12
        b.mesh.scaling.setAll(3)
        continue
      }
    }
  }

  // First-person camera follows own vehicle
  const own = vehicles.get(myId)
  if (own) {
    const { state } = own
    camera.position.set(state.x, state.y, state.z)
    const target = new Vector3(
      state.x + Math.sin(state.yaw),
      state.y,
      state.z + Math.cos(state.yaw),
    )
    camera.setTarget(target)

    // Headlight follows vehicle position and aims forward
    headlight.position.copyFrom(camera.position)
    headlight.direction.set(Math.sin(state.yaw), 0, Math.cos(state.yaw))
  }

  scene.render()
})

window.addEventListener('resize', () => engine.resize())

// ─── Socket.IO ────────────────────────────────────────────────────────────────
const socket = io()

socket.on('world', (data) => {
  buildVoxelWorld(new Uint8Array(data))
})

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
