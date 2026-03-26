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
  ShaderMaterial,
  Effect,
  TransformNode,
  PointLight,
} from '@babylonjs/core'

const canvas       = document.getElementById('renderCanvas')
const cameraTarget = new Vector3()   // reused every frame, avoids per-frame allocation

// My joystick ID — read from ?id=N in the URL
const myId = parseInt(new URLSearchParams(location.search).get('id') ?? '0', 10)

// ─── Babylon engine & scene ───────────────────────────────────────────────────
const engine = new Engine(canvas, true, { antialias: true })
const scene  = new Scene(engine)
scene.clearColor = new Color4(0, 0, 0, 1)

// ─── Camera ───────────────────────────────────────────────────────────────────
const camera = new FreeCamera('fpv', new Vector3(0, 0, -1), scene)
camera.minZ = 0.1
camera.maxZ = 400
camera.fov  = 1.4   // ~80°

// ─── Cave lighting ────────────────────────────────────────────────────────────
const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
hemi.intensity   = 0.88
hemi.diffuse     = new Color3(0.80, 0.72, 0.58)
hemi.groundColor = new Color3(0.50, 0.42, 0.32)

// Soft player glow — follows the camera, illuminates surroundings without a cone circle
const playerLight = new PointLight('playerLight', new Vector3(0, 0, 0), scene)
playerLight.diffuse   = new Color3(1.0, 0.92, 0.80)
playerLight.specular  = new Color3(1.0, 0.92, 0.80)
playerLight.intensity = 3.0
playerLight.range     = 16

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

  console.log(`[Voxels] ${boxes} merged boxes → ${count} instances across 9 tiles (fpv)`)
}

// ─── Bullet world collision ───────────────────────────────────────────────────
function bulletHitsWorld(p) {
  if (!worldGrid) return false
  const cx = Math.floor((p.x + HALF)   / CELL)
  const cy = Math.floor((p.y + HALF_Y) / CELL)
  const cz = Math.floor((p.z + HALF)   / CELL)
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

function removeVehicle(id) {
  const v = vehicles.get(id)
  if (!v) return
  v.pyramid.dispose()
  v.pivot.dispose()
  v.glow.dispose()
  v.mat.dispose()
  v.bullets.forEach(b => { b.light.dispose(); b.mesh.dispose() })
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
  }

  // First-person camera follows own vehicle
  const own = vehicles.get(myId)
  if (own) {
    const { state } = own
    camera.position.set(state.x, state.y, state.z)
    cameraTarget.set(
      state.x + Math.sin(state.yaw),
      state.y,
      state.z + Math.cos(state.yaw),
    )
    camera.setTarget(cameraTarget)

    // Player light follows camera position
    playerLight.position.copyFrom(camera.position)
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
