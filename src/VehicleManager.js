import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  TransformNode,
  PointLight,
} from '@babylonjs/core'
import { HALF, HALF_Y, CELL, GRID } from './worldConstants.js'

// ─── Game constants ───────────────────────────────────────────────────────────
export const BULLET_SPEED = 18
export const MAX_BULLETS  = 30
export const TEAM_COLOR = {
  blue: { d: [0.20, 0.40, 0.95], e: [0.05, 0.10, 0.38], g: [0.30, 0.50, 1.00], css: '#4a7aff' },
  red:  { d: [0.95, 0.20, 0.20], e: [0.38, 0.05, 0.05], g: [1.00, 0.30, 0.30], css: '#ff4040' },
}

// ─── VehicleManager ───────────────────────────────────────────────────────────
// Creates/removes vehicle meshes with team colours and manages client-side bullets.
// Options:
//   labelsEl — DOM element to append ID labels to (display view); null in FPV
//   myId     — joystick ID of the local player; own pyramid is hidden in FPV
export class VehicleManager {
  constructor(scene, { labelsEl = null, myId = null } = {}) {
    this.scene     = scene
    this.labelsEl  = labelsEl
    this.myId      = myId
    this.vehicles  = new Map()
    this.bulletMat = new StandardMaterial('bulletMat', scene)
    this.bulletMat.diffuseColor  = new Color3(1, 0.08, 0.08)
    this.bulletMat.emissiveColor = new Color3(1, 0,    0)
    this.bulletMat.specularColor = new Color3(1, 0.4,  0.4)
  }

  getVehicle(id) { return this.vehicles.get(id) }

  syncList(members) {
    for (const { id, team } of members)
      if (!this.vehicles.has(id)) this.vehicles.set(id, this.createVehicle(id, team))
    for (const id of [...this.vehicles.keys()])
      if (!members.find(m => m.id === id)) this.removeVehicle(id)
  }

  createVehicle(id, team) {
    const col   = TEAM_COLOR[team] ?? TEAM_COLOR.blue
    const state = { x: 0, y: 0, z: 0, yaw: 0 }

    const pivot = new TransformNode(`pivot-${id}`, this.scene)

    const pyramid = MeshBuilder.CreateCylinder(`pyramid-${id}`, {
      diameterTop: 0, diameterBottom: 1.0, height: 2.2, tessellation: 4,
    }, this.scene)
    pyramid.parent     = pivot
    pyramid.rotation.x = Math.PI / 2
    if (id === this.myId) pyramid.isVisible = false

    const mat = new StandardMaterial(`mat-${id}`, this.scene)
    mat.diffuseColor  = new Color3(...col.d)
    mat.emissiveColor = new Color3(...col.e)
    mat.specularColor = new Color3(0.7, 0.75, 1.0)
    mat.specularPower = 64
    pyramid.material  = mat

    const glow = new PointLight(`glow-${id}`, Vector3.Zero(), this.scene)
    glow.diffuse   = new Color3(...col.g)
    glow.specular  = new Color3(...col.g)
    glow.intensity = 3.0
    glow.range     = 10

    let label = null
    if (this.labelsEl) {
      label = document.createElement('div')
      label.className     = 'vehicle-label'
      label.textContent   = String(id).padStart(2, '0')
      label.style.color       = col.css
      label.style.borderColor = col.css
      label.style.boxShadow   = `0 0 6px ${col.css}55`
      this.labelsEl.appendChild(label)
    }

    const bullets = []
    const targetState = { x: 0, y: 0, z: 0, yaw: 0 }
    return { pivot, pyramid, mat, glow, state, targetState, bullets, label, team }
  }

  spawnBullet(vehicle) {
    const { bullets, pivot, state } = vehicle
    if (bullets.length >= MAX_BULLETS) {
      const old = bullets.shift()
      old.light.dispose()
      old.mesh.dispose()
    }
    const mesh = MeshBuilder.CreateSphere('bullet', { diameter: 0.28, segments: 5 }, this.scene)
    mesh.material   = this.bulletMat
    mesh.isPickable = false
    const tipDist   = 1.1
    mesh.position.set(
      pivot.position.x + Math.sin(state.yaw) * tipDist,
      pivot.position.y,
      pivot.position.z + Math.cos(state.yaw) * tipDist,
    )
    const light = new PointLight('bulletLight', mesh.position.clone(), this.scene)
    light.diffuse   = new Color3(1.0, 0.25, 0.05)
    light.specular  = new Color3(1.0, 0.25, 0.05)
    light.intensity = 1.8
    light.range     = 8
    bullets.push({ mesh, vx: Math.sin(state.yaw), vz: Math.cos(state.yaw), light })
  }

  removeVehicle(id) {
    const v = this.vehicles.get(id)
    if (!v) return
    v.pyramid.dispose()
    v.pivot.dispose()
    v.glow.dispose()
    v.mat.dispose()
    v.bullets.forEach(b => { b.light.dispose(); b.mesh.dispose() })
    if (v.label) v.label.remove()
    this.vehicles.delete(id)
  }
}
