import {
  MeshBuilder,
  ShaderMaterial,
  Effect,
  Color3,
} from '@babylonjs/core'
import { GRID, GRID_Y, CELL, HALF, HALF_Y, GRID_MASK } from './worldConstants.js'

// ─── Wireframe shaders ────────────────────────────────────────────────────────
// Registered at module level — BabylonJS requires this before ShaderMaterial is created.
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

// ─── WorldRenderer ────────────────────────────────────────────────────────────
// Builds the voxel mesh from the server grid using greedy 3D merging,
// and provides isSolid / bulletHitsWorld helpers for the render loop.
// Pass { skipCeiling: true } in display view to hide the top layer.
export class WorldRenderer {
  constructor(scene, { skipCeiling = false } = {}) {
    this.scene       = scene
    this.skipCeiling = skipCeiling
    this.worldGrid   = null
    this.voxelRoots  = []
  }

  build(grid) {
    this.worldGrid = grid

    this.voxelRoots.forEach(r => { r.material?.dispose(); r.dispose() })
    this.voxelRoots = []

    const wireMat = new ShaderMaterial('wireMat', this.scene,
      { vertex: 'wire', fragment: 'wire' },
      {
        attributes: ['position', 'uv', 'world0', 'world1', 'world2', 'world3'],
        uniforms:   ['viewProjection', 'wireColor', 'edgeWidth', 'fogColor', 'fogDensity'],
      }
    )
    wireMat.setColor3('wireColor', new Color3(0.1, 0.85, 0.7))
    wireMat.setFloat('edgeWidth',  0.055)
    wireMat.setColor3('fogColor',  new Color3(0, 0, 0))
    wireMat.setFloat('fogDensity', this.scene.fogDensity)

    const root = MeshBuilder.CreateBox('wireRoot', { size: 1 }, this.scene)
    root.material   = wireMat
    root.isVisible  = false
    root.isPickable = false
    this.voxelRoots = [root]

    const faceDir = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]
    const strideY = GRID
    const strideZ = GRID * GRID_Y

    // Mark surface voxels
    const isSurf = new Uint8Array(GRID * GRID_Y * GRID)
    for (let z = 0; z < GRID; z++)
      for (let y = 0; y < GRID_Y; y++)
        for (let x = 0; x < GRID; x++) {
          if (!this.isSolid(x, y, z)) continue
          if (this.skipCeiling && y === GRID_Y - 1) continue
          for (const [dx, dy, dz] of faceDir) {
            if (!this.isSolid(x + dx, y + dy, z + dz)) {
              isSurf[x + y * strideY + z * strideZ] = 1
              break
            }
          }
        }

    // 3D greedy merge
    const done      = new Uint8Array(GRID * GRID_Y * GRID)
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

          let w = 1
          while (x + w < GRID && isSurf[(x+w) + y*strideY + z*strideZ] && !done[(x+w) + y*strideY + z*strideZ]) w++

          let d = 1
          z_ext: while (z + d < GRID) {
            for (let dx = 0; dx < w; dx++) {
              const j = (x+dx) + y*strideY + (z+d)*strideZ
              if (!isSurf[j] || done[j]) break z_ext
            }
            d++
          }

          let h = 1
          y_ext: while (y + h < GRID_Y) {
            for (let dz = 0; dz < d; dz++)
              for (let dx = 0; dx < w; dx++) {
                const j = (x+dx) + (y+h)*strideY + (z+dz)*strideZ
                if (!isSurf[j] || done[j]) break y_ext
              }
            h++
          }

          for (let dy = 0; dy < h; dy++)
            for (let dz = 0; dz < d; dz++)
              for (let dx = 0; dx < w; dx++)
                done[(x+dx) + (y+dy)*strideY + (z+dz)*strideZ] = 1

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

    console.log(`[Voxels] ${boxes} merged boxes → ${count} instances across 9 tiles`)
  }

  isSolid(cx, cy, cz) {
    if (!this.worldGrid) return false
    if (cy < 0 || cy >= GRID_Y) return true
    return this.worldGrid[(cx & GRID_MASK) + cy * GRID + (cz & GRID_MASK) * GRID * GRID_Y] === 1
  }

  bulletHitsWorld(p) {
    if (!this.worldGrid) return false
    return this.isSolid(
      Math.floor((p.x + HALF)   / CELL),
      Math.floor((p.y + HALF_Y) / CELL),
      Math.floor((p.z + HALF)   / CELL),
    )
  }
}
