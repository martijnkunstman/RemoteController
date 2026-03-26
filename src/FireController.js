// ─── FireController ───────────────────────────────────────────────────────────
// Manages the fire button and spacebar, emitting rapid-fire events.
export class FireController {
  constructor(socket, fireBtnEl) {
    this.socket    = socket
    this.fireBtnEl = fireBtnEl
    this.fireTimer = null
  }

  init() {
    this.fireBtnEl.addEventListener('pointerdown',  (e) => { e.preventDefault(); this.startFiring() })
    this.fireBtnEl.addEventListener('pointerup',    (e) => { e.preventDefault(); this.stopFiring() })
    this.fireBtnEl.addEventListener('pointerleave', () => this.stopFiring())
    this.fireBtnEl.addEventListener('contextmenu',  (e) => e.preventDefault())
    window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); this.startFiring() } })
    window.addEventListener('keyup',   (e) => { if (e.code === 'Space') this.stopFiring() })
  }

  startFiring() {
    if (this.fireTimer !== null) return
    this.fireBtnEl.classList.add('active')
    this.socket.emit('fire')
    this.fireTimer = setInterval(() => this.socket.emit('fire'), 150)
  }

  stopFiring() {
    if (this.fireTimer === null) return
    this.fireBtnEl.classList.remove('active')
    clearInterval(this.fireTimer)
    this.fireTimer = null
  }
}
