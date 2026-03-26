import {
  GRID, CELL, HALF, HALF_Y,
  ZERO_INPUT, TEAMS,
  BOT_BLUE_IDS, BOT_RED_IDS,
  BOT_DETECTION_RANGE, BOT_ENGAGE_RANGE, BOT_FIRE_ANGLE, BOT_FIRE_INTERVAL,
  BOT_RETREAT_RANGE, BOT_INVESTIGATE_DURATION,
  BOT_STUCK_THRESHOLD, BOT_STUCK_SAMPLE_INTERVAL, BOT_RECOVERY_DURATION,
  BOT_STRAFE_MIN_DURATION, BOT_STRAFE_MAX_DURATION,
  BOT_LOS_STEPS, BULLET_SPEED_SRV,
} from './constants.js'

// ─── BotManager ───────────────────────────────────────────────────────────────
// Owns bot identity (bots Set), AI state (botAI Map), and the
// wander/hunt/engage/investigate state machine.
// Receives shared Maps by reference from GameServer.
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
      // core state
      state:            'wander',
      targetId:         null,
      // wander
      wanderTimer:      0,
      wanderTurnDir:    1,
      wanderTurnAmt:    0.4,
      fireTimer:        0,
      // stuck detection
      lastPos:          null,
      stuckTimer:       0,
      recoveryTimer:    0,
      // shot leading
      prevEnemyPos:     null,
      prevEnemyDt:      0,
      // investigate
      lastKnownPos:     null,
      investigateTimer: 0,
      // strafe
      strafeDir:        Math.random() < 0.5 ? -1 : 1,
      strafeTimer:      0,
    })
    this.hitCooldowns.set(id, 0)
  }

  // ── Main AI tick ────────────────────────────────────────────────────────────

  updateBotAI(id, dt) {
    const state = this.vehicleStates.get(id)
    const ai    = this.botAI.get(id)
    const team  = this.vehicleTeams.get(id)
    const W     = GRID * CELL

    // 1. Decrement timers
    ai.fireTimer   = Math.max(0, ai.fireTimer - dt)
    ai.strafeTimer = Math.max(0, ai.strafeTimer - dt)

    // 2. Stuck detection & recovery ──────────────────────────────────────────
    if (ai.recoveryTimer > 0) {
      ai.recoveryTimer -= dt
      this.vehicleInputs.set(id, { moveX: 0, moveY: -0.8, lookX: ai.wanderTurnDir, lookY: 0 })
      return  // skip normal AI this tick
    }

    if (ai.lastPos === null) {
      ai.lastPos    = { x: state.x, z: state.z }
      ai.stuckTimer = 0
    } else {
      ai.stuckTimer += dt
      if (ai.stuckTimer >= BOT_STUCK_SAMPLE_INTERVAL) {
        const dx2 = state.x - ai.lastPos.x
        const dz2 = state.z - ai.lastPos.z
        if (dx2 * dx2 + dz2 * dz2 < BOT_STUCK_THRESHOLD * BOT_STUCK_THRESHOLD) {
          ai.recoveryTimer  = BOT_RECOVERY_DURATION
          ai.wanderTurnDir  = Math.random() < 0.5 ? -1 : 1
        }
        ai.lastPos    = { x: state.x, z: state.z }
        ai.stuckTimer = 0
      }
    }

    // 3. Enemy scan — find nearest enemy (wrap-aware) ─────────────────────────
    let enemy = null, enemyDist = Infinity
    for (const [eid, es] of this.vehicleStates) {
      if (this.vehicleTeams.get(eid) === team) continue
      let dx = es.x - state.x, dz = es.z - state.z
      dx -= Math.round(dx / W) * W
      dz -= Math.round(dz / W) * W
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d < enemyDist) { enemyDist = d; enemy = { id: eid, state: es, dx, dz } }
    }

    // Check line of sight to nearest enemy
    const hasLOS = enemy !== null && this._hasLOS(state, enemy.dx, enemy.dz, enemyDist)

    // 4. Wall probe ─────────────────────────────────────────────────────────
    const { wallAhead, bias } = this._getSteer(state)

    // 5. Build input ────────────────────────────────────────────────────────
    const inp = { moveX: 0, moveY: 0, lookX: 0, lookY: 0 }

    // 6. State dispatch ─────────────────────────────────────────────────────

    if (ai.state === 'wander') {
      // Refresh wander direction on timer
      if (ai.wanderTimer <= 0) {
        ai.wanderTimer   = 1.5 + Math.random() * 2.5
        ai.wanderTurnDir = Math.random() < 0.5 ? -1 : 1
        ai.wanderTurnAmt = 0.05 + Math.random() * 0.15
      }

      if (wallAhead) {
        inp.lookX = bias !== 0 ? bias : ai.wanderTurnDir
        inp.moveY = 0.3
      } else {
        inp.lookX = ai.wanderTurnAmt * ai.wanderTurnDir
        inp.moveY = 1.0
      }

      // Transition: enemy visible with LOS
      if (enemy && enemyDist < BOT_DETECTION_RANGE && hasLOS) {
        ai.state    = 'hunt'
        ai.targetId = enemy.id
      }

    } else if (ai.state === 'hunt') {
      const targetYaw = Math.atan2(enemy ? enemy.dx : 0, enemy ? enemy.dz : 1)
      const angleDiff = this._wrapAngle(targetYaw - state.yaw)

      if (wallAhead) {
        inp.lookX = bias !== 0 ? bias : Math.sign(angleDiff)
        inp.moveY = 0.3
      } else {
        inp.lookX = Math.sign(angleDiff) * Math.min(1, Math.abs(angleDiff) / 0.4)
        inp.moveY = 0.85
      }

      if (!enemy || !hasLOS || enemyDist > BOT_DETECTION_RANGE) {
        // Lost the enemy — investigate last known position
        if (enemy) {
          ai.lastKnownPos    = { x: enemy.state.x, z: enemy.state.z }
          ai.investigateTimer = BOT_INVESTIGATE_DURATION
        }
        ai.state        = enemy ? 'investigate' : 'wander'
        ai.targetId     = null
        ai.prevEnemyPos = null
      } else if (enemyDist <= BOT_ENGAGE_RANGE) {
        ai.state = 'engage'
      }

    } else if (ai.state === 'engage') {
      // Shot leading ─────────────────────────────────────────────────────
      let aimDx = enemy ? enemy.dx : 0
      let aimDz = enemy ? enemy.dz : 1

      if (enemy && ai.prevEnemyPos !== null && ai.prevEnemyDt > 0.001) {
        let evdx = enemy.state.x - ai.prevEnemyPos.x
        let evdz = enemy.state.z - ai.prevEnemyPos.z
        evdx -= Math.round(evdx / W) * W
        evdz -= Math.round(evdz / W) * W
        const velX      = evdx / ai.prevEnemyDt
        const velZ      = evdz / ai.prevEnemyDt
        const travelTime = Math.min(enemyDist / BULLET_SPEED_SRV, 0.3)
        aimDx = enemy.dx + velX * travelTime
        aimDz = enemy.dz + velZ * travelTime
      }

      if (enemy) {
        ai.prevEnemyPos = { x: enemy.state.x, z: enemy.state.z }
        ai.prevEnemyDt  = dt
      }

      const targetYaw = Math.atan2(aimDx, aimDz)
      const angleDiff = this._wrapAngle(targetYaw - state.yaw)
      inp.lookX = Math.sign(angleDiff) * Math.min(1, Math.abs(angleDiff) / 0.25)

      // Randomised strafe ─────────────────────────────────────────────────
      if (ai.strafeTimer <= 0) {
        ai.strafeDir   = Math.random() < 0.5 ? -1 : 1
        ai.strafeTimer = BOT_STRAFE_MIN_DURATION
                       + Math.random() * (BOT_STRAFE_MAX_DURATION - BOT_STRAFE_MIN_DURATION)
      }
      inp.moveX = ai.strafeDir * 0.5

      // Retreat sub-mode ──────────────────────────────────────────────────
      const wallBehind = this._probeWallAt(state, Math.PI, 2.5)
      if (enemy && enemyDist < BOT_RETREAT_RANGE) {
        inp.moveY = wallBehind ? 0.1 : -0.8
      } else {
        inp.moveY = wallAhead ? 0.1 : 0.3
      }

      // Fire ──────────────────────────────────────────────────────────────
      if (Math.abs(angleDiff) < BOT_FIRE_ANGLE && ai.fireTimer <= 0) {
        ai.fireTimer = BOT_FIRE_INTERVAL
        this.spawnBullet(id, state)
        this.io.emit('fire', { joystickId: id })
      }

      // Transition out of engage ─────────────────────────────────────────
      if (!enemy || !hasLOS || enemyDist > BOT_DETECTION_RANGE) {
        if (enemy) {
          ai.lastKnownPos    = { x: enemy.state.x, z: enemy.state.z }
          ai.investigateTimer = BOT_INVESTIGATE_DURATION
        }
        ai.state        = enemy ? 'investigate' : 'wander'
        ai.targetId     = null
        ai.prevEnemyPos = null
      }

    } else if (ai.state === 'investigate') {
      ai.investigateTimer -= dt

      // Re-detect enemy
      if (enemy && enemyDist < BOT_DETECTION_RANGE && hasLOS) {
        ai.state        = 'hunt'
        ai.targetId     = enemy.id
        ai.lastKnownPos = null
      } else if (ai.investigateTimer <= 0 || ai.lastKnownPos === null) {
        ai.state = 'wander'
      } else {
        // Navigate toward last known position
        let dx = ai.lastKnownPos.x - state.x
        let dz = ai.lastKnownPos.z - state.z
        dx -= Math.round(dx / W) * W
        dz -= Math.round(dz / W) * W
        const distToTarget = Math.sqrt(dx * dx + dz * dz)

        if (distToTarget < 3.0) {
          ai.state = 'wander'
        } else {
          const targetYaw = Math.atan2(dx, dz)
          const angleDiff = this._wrapAngle(targetYaw - state.yaw)
          if (wallAhead) {
            inp.lookX = bias !== 0 ? bias : ai.wanderTurnDir
            inp.moveY = 0.3
          } else {
            inp.lookX = Math.sign(angleDiff) * Math.min(1, Math.abs(angleDiff) / 0.4)
            inp.moveY = 0.8
          }
        }
      }
    }

    this.vehicleInputs.set(id, inp)
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  // Line-of-sight: ray-march along wrap-adjusted (dx, dz) vector from fromState.
  // Returns false if any solid voxel is crossed before reaching the target.
  _hasLOS(fromState, dx, dz, dist) {
    if (dist < 0.001) return true
    const W        = GRID * CELL
    const stepSize = CELL * 0.5
    const steps    = Math.min(Math.ceil(dist / stepSize), BOT_LOS_STEPS)
    const nx = dx / dist
    const nz = dz / dist
    for (let i = 1; i < steps; i++) {
      const t  = i * stepSize
      let   px = ((fromState.x + nx * t + HALF) % W + W) % W - HALF
      let   pz = ((fromState.z + nz * t + HALF) % W + W) % W - HALF
      if (this.world.isSolid(
        Math.floor((px + HALF)            / CELL),
        Math.floor((fromState.y + HALF_Y) / CELL),
        Math.floor((pz + HALF)            / CELL),
      )) return false
    }
    return true
  }

  // Probe a single direction at yaw + angleOffset. Tests two distances to prevent jumping thin walls.
  _probeWallAt(state, angleOffset, dist) {
    const a = state.yaw + angleOffset
    const dx = Math.sin(a)
    const dz = Math.cos(a)
    if (this.world.isSolid(
      Math.floor((state.x + dx * dist * 0.5 + HALF) / CELL),
      Math.floor((state.y                       + HALF_Y) / CELL),
      Math.floor((state.z + dz * dist * 0.5 + HALF) / CELL)
    )) return true
    return this.world.isSolid(
      Math.floor((state.x + dx * dist + HALF)   / CELL),
      Math.floor((state.y                       + HALF_Y) / CELL),
      Math.floor((state.z + dz * dist + HALF)   / CELL),
    )
  }

  // Multi-directional wall probe. Returns { wallAhead, bias }.
  // bias: -1 = turn left, +1 = turn right, 0 = toss-up.
  _getSteer(state) {
    const D = 3.8, A1 = Math.PI / 6, A2 = Math.PI / 3
    const ahead = this._probeWallAt(state,  0, D)
    const L1    = this._probeWallAt(state, -A1, D)
    const R1    = this._probeWallAt(state,  A1, D)

    const wallVisible = ahead || L1 || R1
    if (!wallVisible) return { wallAhead: false, bias: 0 }

    const L2 = this._probeWallAt(state, -A2, D)
    const R2 = this._probeWallAt(state,  A2, D)

    const leftBlocked = (L1 ? 1 : 0) + (L2 ? 1 : 0)
    const rightBlocked = (R1 ? 1 : 0) + (R2 ? 1 : 0)

    let bias = 0
    if (leftBlocked < rightBlocked) bias = -1
    else if (rightBlocked < leftBlocked) bias = 1
    else bias = Math.random() < 0.5 ? -1 : 1

    return { wallAhead: true, bias }
  }

  _wrapAngle(a) {
    while (a >  Math.PI) a -= 2 * Math.PI
    while (a < -Math.PI) a += 2 * Math.PI
    return a
  }
}
