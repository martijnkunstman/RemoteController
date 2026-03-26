import {
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  Color3,
} from '@babylonjs/core'
import { GRID, GRID_Y, CELL, HALF, HALF_Y, GRID_MASK } from './worldConstants.js'

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

    // Solid Neon Grid Material
    const voxelMat = new StandardMaterial('voxelMat', this.scene)
    const texSize = 512
    const dt = new DynamicTexture('gridTex', texSize, this.scene, true)
    const ctx = dt.getContext()
    
    // Background fill
    ctx.fillStyle = '#050814'
    ctx.fillRect(0, 0, texSize, texSize)
    
    // Glowing borders
    const border = 16
    ctx.lineWidth = border
    ctx.strokeStyle = '#00ffff'
    ctx.shadowColor = '#00ffff'
    ctx.shadowBlur = 24
    ctx.strokeRect(border/2, border/2, texSize - border, texSize - border)
    ctx.strokeRect(border/2, border/2, texSize - border, texSize - border)
    
    dt.update()

    voxelMat.emissiveTexture = dt
    voxelMat.diffuseTexture  = dt
    voxelMat.specularColor   = new Color3(0.0, 0.4, 0.4)

    const root = MeshBuilder.CreateBox('voxelRoot', { size: 1 }, this.scene)
    root.material   = voxelMat
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
