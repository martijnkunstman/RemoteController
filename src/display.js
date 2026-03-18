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
} from '@babylonjs/core'

const statusEl = document.getElementById('status')
const canvas = document.getElementById('renderCanvas')

// ─── Babylon engine & scene ───────────────────────────────────────────────────
const engine = new Engine(canvas, true, { antialias: true })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.05, 0.05, 0.08, 1)

// ─── Camera ───────────────────────────────────────────────────────────────────
// Orbitable — drag to inspect the scene
const camera = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3.5, 24, Vector3.Zero(), scene)
camera.lowerRadiusLimit = 8
camera.upperRadiusLimit = 50
camera.attachControl(canvas, true)

// ─── Lighting ─────────────────────────────────────────────────────────────────
const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
hemi.intensity = 0.45
hemi.diffuse = new Color3(0.8, 0.85, 1)
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

// Floor grid (wireframe ground at bottom of box)
const floor = MeshBuilder.CreateGround('floor', { width: ARENA, height: ARENA, subdivisions: 10 }, scene)
floor.position.y = -HALF
floor.isPickable = false
const floorMat = new StandardMaterial('floorMat', scene)
floorMat.wireframe = true
floorMat.emissiveColor = new Color3(0.16, 0.16, 0.3)
floor.material = floorMat

// ─── Pyramid (sharp 4-sided, tip = front) ────────────────────────────────────
//  Babylon's CreateCylinder with diameterTop=0 makes a cone; tessellation=4 → 4-sided pyramid.
//  The tip is at +Y by default. We child it under a pivot node and rotate 90° on X
//  so the tip points to +Z (forward in Babylon's left-handed system).
const pivot = new TransformNode('pivot', scene)

const pyramid = MeshBuilder.CreateCylinder('pyramid', {
  diameterTop: 0,
  diameterBottom: 1.0,
  height: 2.2,
  tessellation: 4,
}, scene)
pyramid.parent = pivot
pyramid.rotation.x = Math.PI / 2   // tip now points in local +Z of pivot

const pyramidMat = new StandardMaterial('pyramidMat', scene)
pyramidMat.diffuseColor  = new Color3(0.36, 0.42, 0.94)
pyramidMat.emissiveColor = new Color3(0.08, 0.10, 0.28)
pyramidMat.specularColor = new Color3(0.6, 0.7, 1.0)
pyramidMat.specularPower = 64
pyramid.material = pyramidMat

// Soft glow light that follows the pyramid
const glow = new PointLight('glow', Vector3.Zero(), scene)
glow.diffuse    = new Color3(0.4, 0.5, 1)
glow.specular   = new Color3(0.3, 0.4, 0.9)
glow.intensity  = 2.5
glow.range      = 6

// ─── 3D state ─────────────────────────────────────────────────────────────────
// Position in world units; yaw in radians (Babylon left-handed: +Y rot = CW from above)
const state = { x: 0, y: 0, z: 0, yaw: 0 }

const MOVE_SPEED = 6   // units per second
const ROT_SPEED  = 2   // radians per second

// Input from socket: { move: {x, y}, look: {x, y} }
// move.x = strafe,   move.y = forward/back
// look.x = yaw CW+,  look.y = up/down
let input = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 } }

// ─── Render loop ──────────────────────────────────────────────────────────────
engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime() / 1000  // seconds

  // Body-relative movement: forward direction follows current yaw
  // Babylon left-handed Y-up: forward = (sin yaw, 0, cos yaw)
  const fwdX =  Math.sin(state.yaw)
  const fwdZ =  Math.cos(state.yaw)
  const rtX  =  Math.cos(state.yaw)
  const rtZ  = -Math.sin(state.yaw)

  state.x += (input.move.y * fwdX + input.move.x * rtX) * MOVE_SPEED * dt
  state.z += (input.move.y * fwdZ + input.move.x * rtZ) * MOVE_SPEED * dt
  state.y += input.look.y * MOVE_SPEED * dt
  state.yaw += input.look.x * ROT_SPEED * dt  // right = CW

  // Clamp inside arena (leave margin for pyramid size)
  const M = 0.9
  state.x = Math.max(-HALF + M, Math.min(HALF - M, state.x))
  state.y = Math.max(-HALF + M, Math.min(HALF - M, state.y))
  state.z = Math.max(-HALF + M, Math.min(HALF - M, state.z))

  pivot.position.set(state.x, state.y, state.z)
  pivot.rotation.y = state.yaw
  glow.position.copyFrom(pivot.position)

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
  input = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 } }
})

socket.on('dot-move', (data) => {
  input = data
})
