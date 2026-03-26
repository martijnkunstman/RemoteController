// ─── World & physics constants (must match src/worldConstants.js) ────────────
export const GRID         = 64
export const GRID_Y       = 32
export const CELL         = 2
export const HALF         = GRID   * CELL / 2   // 64  (XZ)
export const HALF_Y       = GRID_Y * CELL / 2   // 32  (Y)
export const VEHICLE_R    = 0.8
export const MOVE_SPEED   = 6
export const ROT_SPEED    = 2
export const GRID_MASK    = GRID - 1            // 63 — GRID is a power of 2

// ─── Team game constants ──────────────────────────────────────────────────────
export const ZERO_INPUT          = { moveX: 0, moveY: 0, lookX: 0, lookY: 0 }
export const TEAMS               = { BLUE: 'blue', RED: 'red' }
export const BOT_BLUE_IDS        = [1, 2, 3]
export const BOT_RED_IDS         = [4, 5, 6]
export const BOT_DETECTION_RANGE = 50
export const BOT_ENGAGE_RANGE    = 22
export const BOT_FIRE_ANGLE      = Math.PI / 10
export const BOT_FIRE_INTERVAL   = 0.28
export const HIT_RADIUS          = 1.3
export const HIT_INVINCIBILITY   = 0.5
export const BULLET_LIFETIME     = 2.2
export const BULLET_SPEED_SRV    = 18

// ─── Bot AI tuning ────────────────────────────────────────────────────────────
export const BOT_RETREAT_RANGE         = 8      // units — back up when enemy this close
export const BOT_INVESTIGATE_DURATION  = 3.5    // seconds to pursue last-known position
export const BOT_STUCK_THRESHOLD       = 0.6    // units moved before bot is "not stuck"
export const BOT_STUCK_SAMPLE_INTERVAL = 0.8    // seconds between stuck position samples
export const BOT_RECOVERY_DURATION     = 1.2    // seconds of forced reverse during recovery
export const BOT_STRAFE_MIN_DURATION   = 0.4    // min seconds before strafe direction flip
export const BOT_STRAFE_MAX_DURATION   = 0.8    // max seconds before strafe direction flip
export const BOT_LOS_STEPS             = 40     // ray-march steps for line-of-sight check
