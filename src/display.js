import { io } from 'socket.io-client'
import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  Vector3,
  Color3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  PointLight,
  Matrix,
} from '@babylonjs/core'

const statusEl        = document.getElementById('status')
const joystickCountEl = document.getElementById('joystick-count')
const labelsEl        = document.getElementById('labels')
const canvas          = document.getElementById('renderCanvas')
const autoRotateEl    = document.getElementById('auto-rotate')

// ─── Babylon engine & scene ───────────────────────────────────────────────────
const engine = new Engine(canvas, true, { antialias: true })
const scene  = new Scene(engine)
scene.clearColor = new Color4(0.20, 0.17, 0.13, 1)

// ─── Camera ───────────────────────────────────────────────────────────────────
const camera = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3.5, 80, Vector3.Zero(), scene)
camera.lowerRadiusLimit = 20
camera.upperRadiusLimit = 200
camera.attachControl(canvas, true)

// ─── Auto-rotate ──────────────────────────────────────────────────────────────
const AUTO_ROTATE_SPEED = 0.2

const autoRotateSaved = localStorage.getItem('autoRotate')
autoRotateEl.checked = autoRotateSaved === 'true'
autoRotateEl.addEventListener('change', () => {
  localStorage.setItem('autoRotate', autoRotateEl.checked)
})

// ─── Cave lighting ────────────────────────────────────────────────────────────
const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
hemi.intensity   = 0.88
hemi.diffuse     = new Color3(0.80, 0.72, 0.58)
hemi.groundColor = new Color3(0.50, 0.42, 0.32)

// ─── Cave fog ─────────────────────────────────────────────────────────────────
scene.fogMode    = Scene.FOGMODE_EXP2
scene.fogColor   = new Color3(0.20, 0.17, 0.13)
scene.fogDensity = 0.015

// ─── Voxel world constants (must match server/index.js) ───────────────────────
const GRID = 32
const CELL = 2
const HALF = GRID * CELL / 2   // 32

let worldGrid = null

function isSolid(cx, cy, cz) {
  if (!worldGrid) return false
  if (cy < 0 || cy >= GRID) return true                    // Y out-of-bounds = solid ceiling/floor
  const wx = ((cx % GRID) + GRID) % GRID                  // wrap X
  const wz = ((cz % GRID) + GRID) % GRID                  // wrap Z
  return worldGrid[wx + cy * GRID + wz * GRID * GRID] === 1
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
  new Color3(0.50, 0.45, 0.36),  // warm sandstone
  new Color3(0.38, 0.38, 0.44),  // dark granite
  new Color3(0.44, 0.46, 0.38),  // mossy stone
]
let voxelRoots = []

function buildVoxelWorld(grid) {
  worldGrid = grid

  // Dispose previous if rebuilt
  voxelRoots.forEach(r => r.dispose())
  voxelRoots = []

  // 3 rock material variants for visual variety
  const mats = rockColors.map((col, i) => {
    const mat = new StandardMaterial(`rockMat${i}`, scene)
    mat.diffuseColor  = col
    mat.specularColor = new Color3(0.04, 0.04, 0.04)
    mat.specularPower = 6
    mat.emissiveColor = new Color3(0.04, 0.035, 0.025)
    return mat
  })

  // One root mesh per material variant (GPU instancing)
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

  // 9 tile offsets in XZ for wrap-around rendering
  const WORLD_SIZE = GRID * CELL
  const tileOffsets = []
  for (let tz = -1; tz <= 1; tz++)
    for (let tx = -1; tx <= 1; tx++)
      tileOffsets.push([tx * WORLD_SIZE, tz * WORLD_SIZE])

  for (let z = 0; z < GRID; z++)
    for (let y = 0; y < GRID; y++)
      for (let x = 0; x < GRID; x++) {
        if (!isSolid(x, y, z)) continue

        // DISPLAY: skip ceiling layer — arc-rotate camera looks down from above
        if (y === GRID - 1) continue

        // Only render surface blocks (at least one face-adjacent empty cell)
        let surface = false
        for (const [dx, dy, dz] of faceDir) {
          if (!isSolid(x + dx, y + dy, z + dz)) { surface = true; break }
        }
        if (!surface) continue

        // Pick material variant by position for natural color variation
        const matIdx = (x * 7 + y * 13 + z * 5) % 3
        const base   = cellCenter(x, y, z)
        for (const [ox, oz] of tileOffsets) {
          const inst = roots[matIdx].createInstance(`v${count++}`)
          inst.position.set(base.x + ox, base.y, base.z + oz)
          inst.isPickable = false
        }
      }

  console.log(`[Voxels] ${count} surface instances across 9 tiles (display)`)
}

// ─── Bullet world collision ───────────────────────────────────────────────────
function bulletHitsWorld(p) {
  if (!worldGrid) return false
  const cx = Math.floor((p.x + HALF) / CELL)
  const cy = Math.floor((p.y + HALF) / CELL)
  const cz = Math.floor((p.z + HALF) / CELL)
  return isSolid(cx, cy, cz)
}

// ─── Vehicle palette ──────────────────────────────────────────────────────────
const PALETTE = [
  { d: [0.36, 0.42, 0.94], e: [0.08, 0.10, 0.28], g: [0.4, 0.5, 1.0],  css: '#7b8fff' },
  { d: [0.94, 0.32, 0.32], e: [0.28, 0.06, 0.06], g: [1.0, 0.35, 0.35], css: '#ff6060' },
  { d: [0.28, 0.90, 0.46], e: [0.05, 0.26, 0.11], g: [0.35, 1.0, 0.5],  css: '#5eff82' },
  { d: [0.80, 0.32, 0.94], e: [0.22, 0.06, 0.28], g: [0.85, 0.38, 1.0], css: '#cc60ff' },
  { d: [0.94, 0.80, 0.22], e: [0.28, 0.22, 0.04], g: [1.0, 0.88, 0.3],  css: '#ffdc44' },
  { d: [0.22, 0.88, 0.90], e: [0.04, 0.24, 0.26], g: [0.3, 1.0, 1.0],   css: '#44f0ff' },
  { d: [0.94, 0.32, 0.74], e: [0.28, 0.06, 0.20], g: [1.0, 0.38, 0.82], css: '#ff60cc' },
  { d: [0.94, 0.56, 0.20], e: [0.28, 0.14, 0.04], g: [1.0, 0.62, 0.28], css: '#ff9644' },
]

// ─── Vehicle management ────────────────────────────────────────────────────────
const BULLET_SPEED = 18
const MAX_BULLETS  = 30

const bulletMat = new StandardMaterial('bulletMat', scene)
bulletMat.diffuseColor  = new Color3(1, 0.08, 0.08)
bulletMat.emissiveColor = new Color3(1, 0,    0)
bulletMat.specularColor = new Color3(1, 0.4,  0.4)

const vehicles = new Map()

function palette(joystickId) {
  return PALETTE[(joystickId - 1) % PALETTE.length]
}

function createVehicle(joystickId) {
  const col   = palette(joystickId)
  const state = { x: 0, y: 0, z: 0, yaw: 0 }

  const pivot = new TransformNode(`pivot-${joystickId}`, scene)

  const pyramid = MeshBuilder.CreateCylinder(`pyramid-${joystickId}`, {
    diameterTop: 0, diameterBottom: 1.0, height: 2.2, tessellation: 4,
  }, scene)
  pyramid.parent     = pivot
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
  glow.intensity = 3.0
  glow.range     = 10

  const label = document.createElement('div')
  label.className = 'vehicle-label'
  label.textContent = String(joystickId).padStart(2, '0')
  label.style.color       = col.css
  label.style.borderColor = col.css
  label.style.boxShadow   = `0 0 6px ${col.css}55`
  labelsEl.appendChild(label)

  const bullets = []

  return { pivot, pyramid, mat, glow, state, bullets, label }
}

function spawnBullet(vehicle) {
  const { bullets, pivot, state } = vehicle

  if (bullets.length >= MAX_BULLETS) {
    const old = bullets.shift()
    old.light.dispose()
    old.mesh.dispose()
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

  const light = new PointLight('bulletLight', mesh.position.clone(), scene)
  light.diffuse   = new Color3(1.0, 0.25, 0.05)
  light.specular  = new Color3(1.0, 0.25, 0.05)
  light.intensity = 1.8
  light.range     = 8

  bullets.push({ mesh, vx: Math.sin(state.yaw), vz: Math.cos(state.yaw), light })
}

function removeVehicle(joystickId) {
  const v = vehicles.get(joystickId)
  if (!v) return
  v.pyramid.dispose()
  v.pivot.dispose()
  v.glow.dispose()
  v.mat.dispose()
  v.bullets.forEach(b => { b.light.dispose(); b.mesh.dispose() })
  v.label.remove()
  vehicles.delete(joystickId)
}

// ─── Render loop ───────────────────────────────────────────────────────────────
engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime() / 1000

  for (const [, v] of vehicles) {
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

      // XZ: wrap bullet around world edges
      const W = GRID * CELL
      b.mesh.position.x = ((p.x + HALF) % W + W) % W - HALF
      b.mesh.position.z = ((p.z + HALF) % W + W) % W - HALF
      // Y: dispose if bullet escapes ceiling/floor
      if (Math.abs(p.y) > HALF) {
        b.light.dispose(); b.mesh.dispose(); bullets.splice(i, 1); continue
      }

      b.light.position.copyFrom(b.mesh.position)

      if (bulletHitsWorld(p)) {
        b.hitTimer = 0.12
        b.mesh.scaling.setAll(3)
        b.light.intensity = 0
        continue
      }
    }

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

  if (autoRotateEl.checked) camera.alpha += AUTO_ROTATE_SPEED * dt

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
})

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
  const n = ids.length
  joystickCountEl.textContent = n === 0
    ? 'No joysticks'
    : `${n} joystick${n !== 1 ? 's' : ''} connected`
})

socket.on('vehicle-state', (data) => {
  const v = vehicles.get(data.joystickId)
  if (v) { v.state.x = data.x; v.state.y = data.y; v.state.z = data.z; v.state.yaw = data.yaw }
})

socket.on('fire', (data) => {
  const v = vehicles.get(data.joystickId)
  if (v) spawnBullet(v)
})
