import {
  GRID, CELL, HALF, HALF_Y,
  ZERO_INPUT, TEAMS,
  BOT_BLUE_IDS, BOT_RED_IDS,
  BOT_DETECTION_RANGE, BOT_ENGAGE_RANGE, BOT_FIRE_ANGLE, BOT_FIRE_INTERVAL,
} from './constants.js'

// ─── BotManager ───────────────────────────────────────────────────────────────
// Owns bot identity (bots Set), AI state (botAI Map), and the wander/hunt/engage
// state machine. Receives shared Maps by reference from GameServer.
export class BotManager {
  constructor(world, vehicleStates, vehicleInputs, vehicleTeams, usedNumbers, hitCooldowns, io, spawnBulletFn) {
    this.world         = world
    this.vehicleStates = vehicleStates
    this.vehicleInputs = vehicleInputs
    this.vehicleTeams  = vehicleTeams
    this.usedNumbers   = usedNumbers
    this.hitCooldowns  = hitCooldowns
    this.io            = io
    this.spawnBullet   = spawnBulletFn
    this.bots          = new Set()
    this.botAI         = new Map()
  }

  initBots() {
    BOT_BLUE_IDS.forEach(id => this.createBot(id, TEAMS.BLUE))
    BOT_RED_IDS.forEach(id => this.createBot(id, TEAMS.RED))
  }

  createBot(id, team) {
    this.bots.add(id)
    this.usedNumbers.add(id)
    this.vehicleTeams.set(id, team)
    const spawn = this.world.randomSpawnPos()
    this.vehicleStates.set(id, { x: spawn.x, y: spawn.y, z: spawn.z, yaw: spawn.yaw })
    this.vehicleInputs.set(id, { ...ZERO_INPUT })
    this.botAI.set(id, {
      state: 'wander', targetId: null,
      wanderTimer: 0, wanderTurnDir: 1, wanderTurnAmt: 0.4, fireTimer: 0,
    })
    this.hitCooldowns.set(id, 0)
  }

  updateBotAI(id, dt) {
    const state = this.vehicleStates.get(id)
    const ai    = this.botAI.get(id)
    const team  = this.vehicleTeams.get(id)
    const W     = GRID * CELL

    ai.fireTimer = Math.max(0, ai.fireTimer - dt)
    if (ai.wanderTimer > 0) ai.wanderTimer -= dt

    // Find nearest enemy (wrap-aware distance)
    let enemy = null, enemyDist = Infinity
    for (const [eid, es] of this.vehicleStates) {
      if (this.vehicleTeams.get(eid) === team) continue
      let dx = es.x - state.x, dz = es.z - state.z
      dx -= Math.round(dx / W) * W
      dz -= Math.round(dz / W) * W
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d < enemyDist) { enemyDist = d; enemy = { id: eid, state: es, dx, dz } }
    }

    const inp       = { moveX: 0, moveY: 0, lookX: 0, lookY: 0 }
    const wallAhead = this._probeWall(state, 2.5)

    if (!enemy || enemyDist > BOT_DETECTION_RANGE) {
      // ── WANDER ──
      if (ai.wanderTimer <= 0) {
        ai.wanderTimer   = 1.0 + Math.random() * 2.0
        ai.wanderTurnDir = Math.random() < 0.5 ? -1 : 1
        ai.wanderTurnAmt = 0.2 + Math.random() * 0.5
      }
      inp.moveY = wallAhead ? 0.2 : 0.7
      inp.lookX = wallAhead ? ai.wanderTurnDir : ai.wanderTurnAmt * ai.wanderTurnDir
    } else if (enemyDist > BOT_ENGAGE_RANGE) {
      // ── HUNT ──
      const targetYaw = Math.atan2(enemy.dx, enemy.dz)
      const angleDiff = this._wrapAngle(targetYaw - state.yaw)
      inp.lookX = Math.sign(angleDiff) * Math.min(1, Math.abs(angleDiff) / 0.4)
      inp.moveY = wallAhead ? 0.2 : 0.85
    } else {
      // ── ENGAGE ──
      const targetYaw = Math.atan2(enemy.dx, enemy.dz)
      const angleDiff = this._wrapAngle(targetYaw - state.yaw)
      inp.lookX = Math.sign(angleDiff) * Math.min(1, Math.abs(angleDiff) / 0.25)
      inp.moveY = 0.25
      inp.moveX = Math.sin(Date.now() / 600) * 0.4
      if (Math.abs(angleDiff) < BOT_FIRE_ANGLE && ai.fireTimer <= 0) {
        ai.fireTimer = BOT_FIRE_INTERVAL
        this.spawnBullet(id, state)
        this.io.emit('fire', { joystickId: id })
      }
    }

    this.vehicleInputs.set(id, inp)
  }

  _probeWall(state, dist) {
    const px = state.x + Math.sin(state.yaw) * dist
    const pz = state.z + Math.cos(state.yaw) * dist
    return this.world.isSolid(
      Math.floor((px + HALF)        / CELL),
      Math.floor((state.y + HALF_Y) / CELL),
      Math.floor((pz + HALF)        / CELL),
    )
  }

  _wrapAngle(a) {
    while (a >  Math.PI) a -= 2 * Math.PI
    while (a < -Math.PI) a += 2 * Math.PI
    return a
  }
}
