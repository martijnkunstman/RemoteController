import nipplejs from 'nipplejs'

// ─── InputController ─────────────────────────────────────────────────────────
// Handles analog joystick (nipplejs), WASD keyboard, and D-pad input.
// Emits joystick-input to the server whenever inputs change.
export class InputController {
  constructor(socket, coordsLeft, coordsRight) {
    this.socket      = socket
    this.coordsLeft  = coordsLeft
    this.coordsRight = coordsRight
    this.moveInput   = { x: 0, y: 0 }
    this.lookInput   = { x: 0, y: 0 }
    this.pressedWASD = new Set()
    this.pressedKeys = new Set()
    this.stick       = null
  }

  init() {
    this._initStick()
    this._initWASD()
    this._initDpad()
  }

  emitInput() {
    this.socket.emit('joystick-input', {
      moveX: this.moveInput.x,
      moveY: this.moveInput.y,
      lookX: this.lookInput.x,
      lookY: this.lookInput.y,
    })
  }

  _initStick() {
    this.stick = nipplejs.create({
      zone:        document.getElementById('zone-left'),
      mode:        'static',
      position:    { left: '50%', top: '50%' },
      color:       '#5b6af0',
      size:        150,
      restJoystick: true,
    })

    this.stick.on('move', (_e, data) => {
      const f = Math.min(data.force, 1)
      this.moveInput = {
        x: +(Math.cos(data.angle.radian) * f).toFixed(3),
        y: +(Math.sin(data.angle.radian) * f).toFixed(3),
      }
      this.coordsLeft.innerHTML = `x: ${this.moveInput.x.toFixed(2)} &nbsp; y: ${this.moveInput.y.toFixed(2)}`
      this.emitInput()
    })

    this.stick.on('end', () => {
      if (this.pressedWASD.size === 0) {
        this.moveInput = { x: 0, y: 0 }
        this.coordsLeft.innerHTML = `x: 0.00 &nbsp; y: 0.00`
        this.emitInput()
      }
    })
  }

  _initWASD() {
    const wasdMap = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd' }
    window.addEventListener('keydown', (e) => {
      const k = wasdMap[e.code]
      if (k && !this.pressedWASD.has(k)) { e.preventDefault(); this.pressedWASD.add(k); this._updateMove() }
    })
    window.addEventListener('keyup', (e) => {
      const k = wasdMap[e.code]
      if (k) { this.pressedWASD.delete(k); this._updateMove() }
    })
  }

  _updateMove() {
    let x = 0, y = 0
    for (const k of this.pressedWASD) {
      if (k === 'd') x =  1
      if (k === 'a') x = -1
      if (k === 'w') y =  1
      if (k === 's') y = -1
    }
    this.moveInput = { x, y }
    this.coordsLeft.innerHTML = `x: ${x.toFixed(2)} &nbsp; y: ${y.toFixed(2)}`
    this.emitInput()
  }

  _initDpad() {
    for (const btn of document.querySelectorAll('.dpad-btn')) {
      const name = ['up', 'down', 'left', 'right'].find(n => btn.classList.contains(n))
      btn.addEventListener('pointerdown',  (e) => { e.preventDefault(); btn.classList.add('active');    this._press(name) })
      btn.addEventListener('pointerup',    (e) => { e.preventDefault(); btn.classList.remove('active'); this._release(name) })
      btn.addEventListener('pointerleave', ()  => { btn.classList.remove('active'); this._release(name) })
      btn.addEventListener('contextmenu',  (e) => e.preventDefault())
    }

    const keyMap = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
    window.addEventListener('keydown', (e) => {
      const name = keyMap[e.key]
      if (name) { e.preventDefault(); document.getElementById(`btn-${name}`)?.classList.add('active'); this._press(name) }
    })
    window.addEventListener('keyup', (e) => {
      const name = keyMap[e.key]
      if (name) { document.getElementById(`btn-${name}`)?.classList.remove('active'); this._release(name) }
    })
  }

  _updateLook() {
    let x = 0, y = 0
    for (const k of this.pressedKeys) {
      if (k === 'right') x =  1
      if (k === 'left')  x = -1
      if (k === 'up')    y =  1
      if (k === 'down')  y = -1
    }
    this.lookInput = { x, y }
    document.getElementById('coords-right').innerHTML = `x: ${x.toFixed(2)} &nbsp; y: ${y.toFixed(2)}`
    this.emitInput()
  }

  _press(name)   { if (!this.pressedKeys.has(name)) { this.pressedKeys.add(name);    this._updateLook() } }
  _release(name) { if (this.pressedKeys.has(name))  { this.pressedKeys.delete(name); this._updateLook() } }
}
