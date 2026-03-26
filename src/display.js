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
  ShaderMaterial,
  Effect,
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
scene.clearColor = new Color4(0, 0, 0, 1)

// ─── Camera ───────────────────────────────────────────────────────────────────
const camera = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3.5, 80, Vector3.Zero(), scene)
camera.lowerRadiusLimit = 20
camera.upperRadiusLimit = 400
camera.maxZ = 600
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
scene.fogColor   = new Color3(0, 0, 0)
scene.fogDensity = 0.030

// ─── Voxel world constants (must match server/index.js) ───────────────────────
const GRID   = 64
const GRID_Y = 32
const CELL   = 2
const HALF   = GRID   * CELL / 2   // 64  (XZ)
const HALF_Y = GRID_Y * CELL / 2   // 32  (Y)

let worldGrid = null

const GRID_MASK = GRID - 1   // 63 — bitwise AND wraps faster than double-modulo

function isSolid(cx, cy, cz) {
  if (!worldGrid) return false
  if (cy < 0 || cy >= GRID_Y) return true                  // Y out-of-bounds = solid ceiling/floor
  return worldGrid[(cx & GRID_MASK) + cy * GRID + (cz & GRID_MASK) * GRID * GRID_Y] === 1
}


// ─── Wireframe shaders (unlit, UV edge detection, depth fog) ─────────────────
Effect.ShadersStore['wireVertexShader'] = `
  precision highp float;
  attribute vec3 position;
  attribute vec2 uv;
  attribute vec4 world0;
  attribute vec4 world1;
  attribute vec4 world2;
  attribute vec4 world3;
  uniform mat4 viewProjection;
  varying vec2 vUV;
  void main(void) {
    mat4 world = mat4(world0, world1, world2, world3);
    gl_Position = viewProjection * world * vec4(position, 1.0);
    vUV = uv;
  }
`
Effect.ShadersStore['wireFragmentShader'] = `
  precision highp float;
  varying vec2 vUV;
  uniform vec3 wireColor;
  uniform float edgeWidth;
  uniform vec3 fogColor;
  uniform float fogDensity;
  void main(void) {
    float minEdge = min(min(vUV.x, 1.0 - vUV.x), min(vUV.y, 1.0 - vUV.y));
    float depth = gl_FragCoord.z / gl_FragCoord.w;
    float f = fogDensity * depth;
    float fogFactor = clamp(exp(-f * f), 0.0, 1.0);
    if (minEdge > edgeWidth) {
      gl_FragColor = vec4(fogColor, 1.0);
    } else {
      gl_FragColor = vec4(mix(fogColor, wireColor, fogFactor), 1.0);
    }
  }
`

// ─── Voxel scene build ────────────────────────────────────────────────────────
let voxelRoots = []

function buildVoxelWorld(grid) {
  worldGrid = grid

  voxelRoots.forEach(r => { r.material?.dispose(); r.dispose() })
  voxelRoots = []

  const wireMat = new ShaderMaterial('wireMat', scene,
    { vertex: 'wire', fragment: 'wire' },
    {
      attributes: ['position', 'uv', 'world0', 'world1', 'world2', 'world3'],
      uniforms:   ['viewProjection', 'wireColor', 'edgeWidth', 'fogColor', 'fogDensity'],
    }
  )
  wireMat.setColor3('wireColor', new Color3(0.1, 0.85, 0.7))
  wireMat.setFloat('edgeWidth',  0.055)
  wireMat.setColor3('fogColor',  new Color3(0, 0, 0))
  wireMat.setFloat('fogDensity', scene.fogDensity)

  const root = MeshBuilder.CreateBox('wireRoot', { size: 1 }, scene)
  root.material   = wireMat
  root.isVisible  = false
  root.isPickable = false
  voxelRoots = [root]

  const faceDir = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]
  const strideY = GRID
  const strideZ = GRID * GRID_Y

  // ─── Mark surface voxels ─────────────────────────────────────────────────────
  const isSurf = new Uint8Array(GRID * GRID_Y * GRID)
  for (let z = 0; z < GRID; z++)
    for (let y = 0; y < GRID_Y; y++)
      for (let x = 0; x < GRID; x++) {
        if (!isSolid(x, y, z)) continue
        if (y === GRID_Y - 1) continue   // display: skip ceiling
        for (const [dx, dy, dz] of faceDir) {
          if (!isSolid(x + dx, y + dy, z + dz)) {
            isSurf[x + y * strideY + z * strideZ] = 1
            break
          }
        }
      }

  // ─── 3-D greedy merge ────────────────────────────────────────────────────────
  const done = new Uint8Array(GRID * GRID_Y * GRID)
  const WORLD_SIZE = GRID * CELL
  const tileOffsets = []
  for (let tz = -1; tz <= 1; tz++)
    for (let tx = -1; tx <= 1; tx++)
      tileOffsets.push([tx * WORLD_SIZE, tz * WORLD_SIZE])

  let count = 0, boxes = 0
  for (let z = 0; z < GRID; z++)
    for (let y = 0; y < GRID_Y; y++)
      for (let x = 0; x < GRID; x++) {
        if (!isSurf[x + y * strideY + z * strideZ] || done[x + y * strideY + z * strideZ]) continue

        // Extend in X
        let w = 1
        while (x + w < GRID && isSurf[(x+w) + y*strideY + z*strideZ] && !done[(x+w) + y*strideY + z*strideZ]) w++

        // Extend in Z (whole X-strip must qualify)
        let d = 1
        z_ext: while (z + d < GRID) {
          for (let dx = 0; dx < w; dx++) {
            const j = (x+dx) + y*strideY + (z+d)*strideZ
            if (!isSurf[j] || done[j]) break z_ext
          }
          d++
        }

        // Extend in Y (whole XZ-rect must qualify)
        let h = 1
        y_ext: while (y + h < GRID_Y) {
          for (let dz = 0; dz < d; dz++)
            for (let dx = 0; dx < w; dx++) {
              const j = (x+dx) + (y+h)*strideY + (z+dz)*strideZ
              if (!isSurf[j] || done[j]) break y_ext
            }
          h++
        }

        // Mark merged cells done
        for (let dy = 0; dy < h; dy++)
          for (let dz = 0; dz < d; dz++)
            for (let dx = 0; dx < w; dx++)
              done[(x+dx) + (y+dy)*strideY + (z+dz)*strideZ] = 1

        // Emit one scaled instance per tile
        const px = (x + w * 0.5) * CELL - HALF
        const py = (y + h * 0.5) * CELL - HALF_Y
        const pz = (z + d * 0.5) * CELL - HALF
        for (const [ox, oz] of tileOffsets) {
          const inst = root.createInstance(`v${count++}`)
          inst.position.set(px + ox, py, pz + oz)
          inst.scaling.set(w * CELL, h * CELL, d * CELL)
          inst.isPickable = false
        }
        boxes++
      }

  console.log(`[Voxels] ${boxes} merged boxes → ${count} instances across 9 tiles (display)`)
}

// ─── Bullet world collision ───────────────────────────────────────────────────
function bulletHitsWorld(p) {
  if (!worldGrid) return false
  const cx = Math.floor((p.x + HALF)   / CELL)
  const cy = Math.floor((p.y + HALF_Y) / CELL)
  const cz = Math.floor((p.z + HALF)   / CELL)
  return isSolid(cx, cy, cz)
}

// ─── Team colors ──────────────────────────────────────────────────────────────
const TEAM_COLOR = {
  blue: { d: [0.20, 0.40, 0.95], e: [0.05, 0.10, 0.38], g: [0.30, 0.50, 1.00], css: '#4a7aff' },
  red:  { d: [0.95, 0.20, 0.20], e: [0.38, 0.05, 0.05], g: [1.00, 0.30, 0.30], css: '#ff4040' },
}

// ─── Vehicle management ────────────────────────────────────────────────────────
const BULLET_SPEED = 18
const MAX_BULLETS  = 30

const bulletMat = new StandardMaterial('bulletMat', scene)
bulletMat.diffuseColor  = new Color3(1, 0.08, 0.08)
bulletMat.emissiveColor = new Color3(1, 0,    0)
bulletMat.specularColor = new Color3(1, 0.4,  0.4)

const vehicles = new Map()

function createVehicle(joystickId, team) {
  const col   = TEAM_COLOR[team] ?? TEAM_COLOR.blue
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

  return { pivot, pyramid, mat, glow, state, bullets, label, team }
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
  const dt              = engine.getDeltaTime() / 1000
  const transformMatrix = scene.getTransformMatrix()
  const viewport        = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight())

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
      if (Math.abs(p.y) > HALF_Y) {
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
      transformMatrix,
      viewport,
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

socket.on('joystick-list', (members) => {
  for (const { id, team } of members) {
    if (!vehicles.has(id)) vehicles.set(id, createVehicle(id, team))
  }
  for (const id of [...vehicles.keys()]) {
    if (!members.find(m => m.id === id)) removeVehicle(id)
  }
  const humans = members.filter(m => !m.isBot).length
  joystickCountEl.textContent = humans === 0
    ? 'No players'
    : `${humans} player${humans !== 1 ? 's' : ''}`
})

socket.on('score-update', ({ blue, red }) => {
  document.getElementById('score-blue').textContent = `BLUE ${blue}`
  document.getElementById('score-red').textContent  = `RED ${red}`
})

socket.on('hit', ({ targetId }) => {
  const v = vehicles.get(targetId)
  if (!v) return
  v.mat.emissiveColor = new Color3(1, 1, 1)
  setTimeout(() => {
    v.mat.emissiveColor = new Color3(...TEAM_COLOR[v.team].e)
  }, 120)
})

socket.on('vehicle-states', (states) => {
  for (const data of states) {
    const v = vehicles.get(data.joystickId)
    if (v) { v.state.x = data.x; v.state.y = data.y; v.state.z = data.z; v.state.yaw = data.yaw }
  }
})

socket.on('fire', (data) => {
  const v = vehicles.get(data.joystickId)
  if (v) spawnBullet(v)
})
