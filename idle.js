(function () {
    'use strict';

    // ── PNG ASSETS ────────────────────────────────────────────────────────────
    //
    //  assets/sea-far.png   — CW × 400 px, tileable vertically
    //                         far/slow parallax layer, scrolls at 0.45× speed
    //
    //  assets/sea-near.png  — CW × 400 px, tileable vertically
    //                         near/fast parallax layer, scrolls at 1× speed
    //
    //  assets/ship.png      — 48 × 64 px, top-down pointing up, transparent bg
    //                         image-rendering: pixelated is set so pixel art stays crisp
    //
    // ─────────────────────────────────────────────────────────────────────────

    var panelEl, toggleEl, spmEl, genBarEl, armourBarEl, lockBtn, shipEl, enemyEl, moneyEl, canvasEl, ctx, secondarySlotEl;
    var mobileGenEl, mobileShieldsEl, mobileProgFill, drawerEl, drawerShipEl;

    var correctCount = 0;
    var sessionStart = Date.now();
    var open = localStorage.getItem('idle_panel_open') === '1';
    var locked = localStorage.getItem('idle_locked') === '1';

    var MOBILE = window.innerWidth < 768;
    var SCALE = MOBILE ? 0.5 : 1;
    var suppressTooltips = MOBILE;
    var drawerOpen = false;  // always start closed — avoids double-press on mobile

    var PANEL_W = 216;
    var CANVAS_GAP = 50;
    var SHIP_W = 48 * SCALE;
    var SHIP_H = 64 * SCALE;
    var CH = window.innerHeight;
    var CW = Math.round(CH * (4 / 10));
    var cardLeft = 0;
    var SEA_TILE_H = 400;

    var imgFar = new Image();
    var imgNear = new Image();
    var _dark = document.documentElement.classList.contains('dark');
    imgFar.src = _dark ? 'assets/sea-far-dark.png' : 'assets/sea-far.png';
    imgNear.src = _dark ? 'assets/sea-near-dark.png' : 'assets/sea-near.png';

    // ── scroll ────────────────────────────────────────────────────────────────

    var lastRaf = performance.now();

    // ── flight ────────────────────────────────────────────────────────────────
    var flightState = 'grounded';
    var ship = { x: 0, y: 0, vx: 0, vy: 0, worldY: 0 };

    // ── pilot state machine ───────────────────────────────────────────────────
    var pilotState = 'seek';   // 'seek' | 'engage' | 'break'
    var breakTimer = 0;
    var breakVx = 0;
    var breakVy = 0;
    var BREAK_DURATION = 0.42;


    // ── generator — energy = bullets ─────────────────────────────────────────
    //   correct answer tops it up, each bullet fired drains it,
    //   barely ticks down when idle so you can see sums refilling it
    var _cfg = (typeof IDLE_CONFIG !== 'undefined') ? IDLE_CONFIG : {};
    var _gen = _cfg.gen || {};
    var _sh = _cfg.shields || {};
    var _arm = _cfg.armour || {};
    var _en = _cfg.enemy || {};

    var GEN_MAX = _gen.max !== undefined ? _gen.max : 100;
    var GEN_AWARD = _gen.award !== undefined ? _gen.award : 28;
    var GEN_COST = _gen.shotCost !== undefined ? _gen.shotCost : 1;
    var MISSILE_GEN_COST = _gen.missileShotCost !== undefined ? _gen.missileShotCost : 4;
    var GEN_IDLE = _gen.idleDrain !== undefined ? _gen.idleDrain : 0.3;

    //money
    var money = parseInt(localStorage.getItem('idle_money') || '0', 10);
    var MONEY_PER_KILL = 5;

    // ── WEAPONS & GENERATORS ──────────────────────────────────────────────────
    var WEAPONS = {
        vulcan: { name: 'Vulcan', slot: 'primary', damage: 1, genCost: 1 },
        missile: { name: 'Missile', slot: 'secondary', damage: 8, genCost: 6 },
    };
    var GENERATORS = {
        basicGenerator: { name: 'Basic Generator', regenRate: 0.5 },
    };

    // Weapon / generator slot state
    var primaryWeapon = WEAPONS.vulcan;
    var secondaryWeapon = null;
    var tertiaryWeapon = null;
    var rearWeapon = null;
    var generatorSlot = GENERATORS.basicGenerator;

    // ── shields / armour ──────────────────────────────────────────────────────
    var SHIELD_MAX = _sh.max !== undefined ? _sh.max : 80;
    var ARMOUR_MAX = _arm.max !== undefined ? _arm.max : 20;
    var shields = SHIELD_MAX;
    var armour = ARMOUR_MAX;
    var gen = GEN_MAX;
    var SHIELD_REGEN = _sh.regen !== undefined ? _sh.regen : 12;
    var SHIELD_REGEN_GEN_COST = _sh.regenGenCost !== undefined ? _sh.regenGenCost : 0;
    var SHIELD_REGEN_DELAY = _sh.regenDelay !== undefined ? _sh.regenDelay : 0;
    var lastHitTime = 0;

    // ── enemy config from config.js ───────────────────────────────────────────
    var ENEMY_TYPE1_HP = _en.type1Hp !== undefined ? _en.type1Hp : 3;
    var ENEMY_TYPE2_HP = _en.type2Hp !== undefined ? _en.type2Hp : 6;
    var ENEMY_INITIAL_DELAY = _en.initialSpawnDelay !== undefined ? _en.initialSpawnDelay : 17;
    var ENEMY_RESET_DELAY = _en.resetSpawnDelay !== undefined ? _en.resetSpawnDelay : 1.5;

    // ── missile purchase ──────────────────────────────────────────────────────
    var MISSILE_PRICE = 500;
    // secondaryWeapon set to { cooldown, timer, _last } when purchased

    // ── combat ────────────────────────────────────────────────────────────────
    var bullets = [];
    var missiles = [];
    var enemyBullets = [];
    var ENEMY_FIRE_RATE = 1.8;
    // ── multiple enemies ──────────────────────────────────────────────────────
    var enemies = [];
    var enemySpawnCount = 0;
    var obstacles = [];
    var lastFireMs = 0;

    // ── wave system ───────────────────────────────────────────────────────────
    var DEFAULT_WAVES = [
        { label: 'trickle', duration: 20, gap: 4.0, maxEnemies: 1, enemyHp: 3, enemyVy: 70 },
        { label: 'swarm', duration: 12, gap: 1.5, maxEnemies: 2, enemyHp: 2, enemyVy: 90 },
        { label: 'silence', duration: 6, gap: 999, maxEnemies: 0, enemyHp: 3, enemyVy: 70 },
        { label: 'swarm', duration: 14, gap: 1.0, maxEnemies: 3, enemyHp: 2, enemyVy: 110 },
        { label: 'heavy', duration: 16, gap: 3.0, maxEnemies: 2, enemyHp: 6, enemyVy: 80 },
    ];
    var WAVES = (_cfg.waves && _cfg.waves.length) ? _cfg.waves : DEFAULT_WAVES;
    var waveIndex = 0;
    var waveTimer = 0;
    var waveGapTimer = 0;

    var burnFrame = 0;
    var burnTimer = 0;
    var BURN_INTERVAL = 0.56;  // seconds between frame swap, tune to taste

    // ── canvas positioning ────────────────────────────────────────────────────
    function positionCanvas() {
        var card = document.querySelector('.card');
        if (!card) {
            cardLeft = 0;
            CW = window.innerWidth;
        } else {
            var rect = card.getBoundingClientRect();
            cardLeft = Math.round(rect.left);
            CW = Math.round(rect.width);
        }
        canvasEl.style.left = cardLeft + 'px';
        canvasEl.style.right = '';
        canvasEl.style.width = CW + 'px';
        canvasEl.width = CW;
        canvasEl.height = CH;
    }

    // ship DOM element tracks ship.x / ship.y in canvas space each frame
    function updateShipDom() {
        if (!shipEl) return;
        shipEl.style.left = Math.round(cardLeft + ship.x - SHIP_W / 2) + 'px';
        shipEl.style.right = '';
        shipEl.style.top = Math.round(ship.y - SHIP_H / 2) + 'px';
    }

    function updateEnemyDom() {
        for (var i = 0; i < enemies.length; i++) {
            var e = enemies[i];
            if (!e.el) continue;
            e.el.style.left = Math.round(cardLeft + e.x - SHIP_W / 2) + 'px';
            e.el.style.right = '';
            e.el.style.top = Math.round(e.y - SHIP_H / 2) + 'px';
            var darkMode = document.documentElement.classList.contains('dark');
            var baseFilter = darkMode ? 'invert(1)' : '';
            e.el.style.filter = e.flash > 0
                ? (baseFilter ? baseFilter + ' brightness(2)' : 'brightness(2)')
                : (baseFilter || 'none');
        }
    }

    // ── scroll speed ──────────────────────────────────────────────────────────
    function scrollSpeed() {
        if (flightState === 'grounded') return 0;
        var spm = parseFloat(getSPM()) || 0;
        return 5 + Math.min(spm * 20, 150);
    }

    // ── nearest enemy helper ──────────────────────────────────────────────────
    function nearestEnemy() {
        var best = null, bestD = Infinity;
        for (var i = 0; i < enemies.length; i++) {
            var e = enemies[i];
            var d = Math.abs(e.x - ship.x) + Math.abs(e.y - ship.y);
            if (d < bestD) { bestD = d; best = e; }
        }
        return best;
    }

    // ── kill enemy helper ─────────────────────────────────────────────────────
    function killEnemy(e, i) {
        if (e.el) { e.el.remove(); }
        enemies.splice(i, 1);
        if (pilotState === 'engage') triggerBreak();
    }

    // ── create sprite element for a spawned enemy ─────────────────────────────
    function createEnemySpriteEl(type) {
        var el = document.createElement('img');
        el.src = type === 2 ? 'assets/enemy2.png' : 'assets/enemy1.png';
        el.style.cssText = 'position:fixed;pointer-events:none;z-index:2;width:' + SHIP_W + 'px;height:auto;opacity:0;image-rendering:pixelated;image-rendering:crisp-edges;transform-origin:center center;transition:opacity 1.4s ease';
        document.body.appendChild(el);
        if (open || locked) el.style.opacity = '0.85';
        return el;
    }

    // ── level / enemy spawn ───────────────────────────────────────────────────
    function spawnEnemyWave(hp, vy) {
        var type = (hp >= ENEMY_TYPE2_HP) ? 2 : 1;
        var el = createEnemySpriteEl(type);
        var w = enemyEl.naturalWidth || 16;
        var h = enemyEl.naturalHeight || 16;
        var baseVy = (vy || 70) + scrollSpeed() * 0.25;
        enemies.push({
            x: CW * 0.2 + Math.random() * CW * 0.6,
            y: -SHIP_H,
            hp: hp || ENEMY_TYPE1_HP,
            maxHp: hp || ENEMY_TYPE1_HP,
            vy: baseVy,
            phase: Math.random() * Math.PI * 2,
            flash: 0,
            hw: w * 1.5 * SCALE,
            hh: h * 1.5 * SCALE,
            el: el,
        });
        enemySpawnCount++;
    }

    function spawnEnemy() {
        var wave = WAVES[waveIndex % WAVES.length];
        spawnEnemyWave(wave.enemyHp, wave.enemyVy);
    }

    function spawnLevel() {
        obstacles = [];
        for (var i = 0; i < enemies.length; i++) {
            if (enemies[i].el) enemies[i].el.remove();
        }
        enemies = [];
        spawnEnemy();
        bullets = [];
        missiles = [];
        enemyBullets = [];
    }

    // ── steering — 2D vector forces ───────────────────────────────────────────
    // ── pilot helpers ─────────────────────────────────────────────────────────
    function engageY(target) {
        // aggressive when enemy is high up, cautious when it's already past mid
        return (target && target.y < CH * 0.5) ? CH * 0.68 : CH * 0.75;
    }

    function triggerBreak() {
        pilotState = 'break';
        breakTimer = BREAK_DURATION;
        // break hard away from the next remaining enemy (or screen centre)
        var next = enemies.length > 0 ? enemies[0] : null;
        var awayX = next ? (ship.x - next.x) : (ship.x - CW * 0.5);
        var awayLen = Math.abs(awayX) + 0.001;
        breakVx = (awayX / awayLen) * 300;
        breakVy = -55;  // slight upward kick — feels like pulling back
    }

    function steer(dt) {
        if (flightState === 'grounded' || flightState === 'ignition') return;

        // burn animation (unchanged)
        if (flightState === 'cruising') {
            var spd0 = Math.sqrt(ship.vx * ship.vx + ship.vy * ship.vy);
            if (spd0 > 20) {
                burnTimer += dt;
                if (burnTimer >= BURN_INTERVAL) {
                    burnTimer = 0;
                    burnFrame = 1 - burnFrame;
                    shipEl.src = burnFrame === 0 ? 'assets/ship-cruise.png' : 'assets/ship-cruise2.png';
                }
            } else {
                shipEl.src = 'assets/ship-cruise.png';
                burnFrame = 0;
            }
        }

        var fx = 0, fy = 0;
        var damp = 0.82;
        var target = nearestEnemy();

        if (pilotState === 'seek') {
            if (target) {
                var ey = engageY(target);
                // snap directly below the target — crisp, purposeful
                fx += (target.x - ship.x) * 34.0;
                fy += (ey - ship.y) * 24.0;
                damp = 0.82;  // low damping → snappy positioning
                // arrived: lock in and commit
                if (Math.abs(ship.x - target.x) < 12 && Math.abs(ship.y - ey) < 18) {
                    pilotState = 'engage';
                }
            } else {
                // no enemy — pull back on Y only, hold current X
                fy += (CH * 0.78 - ship.y) * 9;
                damp = 0.80;
            }
        } else if (pilotState === 'engage') {
            if (!target) {
                pilotState = 'seek';
            } else {
                var ey2 = engageY(target);
                // track enemy X tightly, hold engage Y — settled but alive
                fx += (target.x - ship.x) * 24.0;
                fy += (ey2 - ship.y) * 14.0;
                damp = 0.85;

                // enemy slipped past — break off, don't chase downward
                if (target.y > ship.y + SHIP_H) {
                    triggerBreak();
                }
            }
        } else if (pilotState === 'break') {
            breakTimer -= dt;
            // impulse fades as break completes — front-loaded punch
            var bf = Math.max(0, breakTimer / BREAK_DURATION);
            fx += breakVx * bf * 7;
            fy += breakVy * bf * 7;
            damp = 0.78;

            if (breakTimer <= 0) {
                pilotState = 'seek';
            }
        }

        // canvas boundary forces
        var m = 38 * SCALE;
        if (ship.x < m) fx += (m - ship.x) * 6;
        if (ship.x > CW - m) fx += (CW - m - ship.x) * 6;
        if (ship.y < m) fy += (m - ship.y) * 6;
        if (ship.y > CH - m) fy += (CH - m - ship.y) * 6;

        ship.vx = (ship.vx + fx * dt) * damp;
        ship.vy = (ship.vy + fy * dt) * damp;

        var spd = Math.sqrt(ship.vx * ship.vx + ship.vy * ship.vy);
        var maxSpd = 300;
        if (spd > maxSpd) { ship.vx *= maxSpd / spd; ship.vy *= maxSpd / spd; }

        ship.x += ship.vx * dt;
        ship.y += ship.vy * dt;
    }

    // ── combat update ─────────────────────────────────────────────────────────
    function fireRate() {
        var spm = parseFloat(getSPM()) || 0;
        return Math.min(0.6 + spm * 0.22, 7);   // 0.6/s at rest → 7/s at 30 spm
    }

    function tryFire(now) {
        var target = nearestEnemy();
        if (!target || gen <= 0) return;
        // only fire when X-aligned with the nearest enemy (within 36 px)
        if (Math.abs(ship.x - target.x) > 36) return;
        if (now - lastFireMs < 1000 / fireRate()) return;

        bullets.push({ x: ship.x, y: ship.y - SHIP_H * 0.45, vy: -385 });
        gen = Math.max(0, gen - GEN_COST);
        lastFireMs = now;
    }

    // ── secondary weapon: missile ─────────────────────────────────────────────
    function tryFireSecondary(now) {
        if (!secondaryWeapon) return;
        var target = nearestEnemy();
        if (!target || gen <= 0) return;
        if (flightState !== 'cruising') return;

        secondaryWeapon.timer -= (now - (secondaryWeapon._last || now)) / 1000;
        secondaryWeapon._last = now;
        if (secondaryWeapon.timer > 0) return;

        var offsets = [-10, 10];
        for (var o = 0; o < offsets.length; o++) {
            missiles.push({
                x: ship.x + offsets[o] * SCALE,
                y: ship.y - SHIP_H * 0.3,
                vx: 0, vy: 0,
                target: target,
                phase: 'eject',
                age: 0,
                angle: Math.atan2(target.y - ship.y, target.x - ship.x),
                ejectOffset: offsets[o],
                launchDelay: o * 0.05,
                trail: [],
            });
        }
        secondaryWeapon.timer = secondaryWeapon.cooldown;
        gen = Math.max(0, gen - MISSILE_GEN_COST);
    }

    // ── missile physics ───────────────────────────────────────────────────────
    function updateMissiles(dt) {
        for (var i = missiles.length - 1; i >= 0; i--) {
            var m = missiles[i];
            m.age += dt;

            m.trail.push({ x: m.x, y: m.y, age: 0 });
            for (var t = m.trail.length - 1; t >= 0; t--) {
                m.trail[t].age += dt;
                if (m.trail[t].age > 0.35) m.trail.splice(t, 1);
            }

            if (m.launchDelay > 0) { m.launchDelay -= dt; continue; }

            if (m.phase === 'eject') {
                m.x += (m.ejectOffset > 0 ? 1 : -1) * 28 * SCALE * dt;
                m.y += -8 * SCALE * dt;
                if (m.target && m.target.hp > 0) m.angle = Math.atan2(m.target.y - m.y, m.target.x - m.x);
                if (m.age > 0.15) { m.phase = 'hang'; m.age = 0; }

            } else if (m.phase === 'hang') {
                m.x += (m.ejectOffset > 0 ? 1 : -1) * 4 * SCALE * dt;
                m.y += 2 * SCALE * dt;
                if (m.target && m.target.hp > 0) m.angle = Math.atan2(m.target.y - m.y, m.target.x - m.x);
                if (m.age > 0.12) { m.phase = 'lock'; m.age = 0; }

            } else if (m.phase === 'lock') {
                var spd = Math.min(60 + m.age * 100, 620);
                if (!m.target || m.target.hp <= 0) {
                    m.x += Math.cos(m.angle) * spd * dt;
                    m.y += Math.sin(m.angle) * spd * dt;
                } else {
                    var ddx = m.target.x - m.x;
                    var ddy = m.target.y - m.y;
                    var targetAngle = Math.atan2(ddy, ddx);
                    var da = targetAngle - m.angle;
                    while (da > Math.PI) da -= Math.PI * 2;
                    while (da < -Math.PI) da += Math.PI * 2;
                    m.angle += da * Math.min(6 * dt * 8, 1);
                    m.vx = Math.cos(m.angle) * spd;
                    m.vy = Math.sin(m.angle) * spd;
                    m.x += m.vx * dt;
                    m.y += m.vy * dt;
                }
            }

            if (m.y < -80 || m.y > CH + 80 || m.x < -80 || m.x > CW + 80) {
                missiles.splice(i, 1); continue;
            }

            if (m.target && m.target.hp > 0) {
                var hdx = m.x - m.target.x;
                var hdy = m.y - m.target.y;
                if (Math.abs(hdx) < 22 * SCALE && Math.abs(hdy) < 22 * SCALE) {
                    m.target.hp -= 3;
                    m.target.flash = 0.2;
                    if (m.target.hp <= 0) {
                        var streakMult = 1 + (window.streak || 0) * 0.1;
                        var earned = Math.round(MONEY_PER_KILL * streakMult);
                        money += earned;
                        localStorage.setItem('idle_money', money);
                        if (moneyEl) moneyEl.textContent = money;
                        if (open || locked) spawnKillFloat(m.target.x, m.target.y, earned);
                        var ti = enemies.indexOf(m.target);
                        if (ti !== -1) killEnemy(m.target, ti);
                    }
                    missiles.splice(i, 1); continue;
                }
            }
        }
    }

    // ── enemy fire ────────────────────────────────────────────────────────────
    function tryEnemyFire(now) {
        if (flightState !== 'cruising') return;
        for (var i = 0; i < enemies.length; i++) {
            var e = enemies[i];
            if (!e.lastFireMs) e.lastFireMs = now;
            if ((now - e.lastFireMs) / 1000 < ENEMY_FIRE_RATE) continue;
            enemyBullets.push({ x: e.x, y: e.y + SHIP_H * 0.45, vy: 320 });
            e.lastFireMs = now;
        }
    }

    function takeDamage(amount) {
        var overflow = Math.max(0, amount - shields);
        shields = Math.max(0, shields - amount);
        armour = Math.max(0, armour - overflow);
        lastHitTime = Date.now() / 1000;
        if (shields <= 0 && armour <= 0) {
            resetToStart();
        }
    }

    function updateCombat(now, dt) {
        if (flightState === 'grounded' || flightState === 'ignition') return;

        // shield regen — respects regenDelay and drains gen at regenGenCost
        var nowSec = Date.now() / 1000;
        if (nowSec - lastHitTime >= SHIELD_REGEN_DELAY) {
            var regenAmt = SHIELD_REGEN * (gen / GEN_MAX) * dt;
            var regenCost = SHIELD_REGEN_GEN_COST * dt;
            if (shields < SHIELD_MAX) {
                shields = Math.min(SHIELD_MAX, shields + regenAmt);
                if (regenCost > 0) gen = Math.max(0, gen - regenCost);
            }
        }

        // near-zero idle drain — barely visible, so sums clearly top it up
        gen = Math.max(0, gen - GEN_IDLE * dt);

        tryFire(now);
        tryFireSecondary(now);
        tryEnemyFire(now);

        // move enemy bullets down, hit test against ship
        for (var ei = enemyBullets.length - 1; ei >= 0; ei--) {
            enemyBullets[ei].y += enemyBullets[ei].vy * dt;
            if (enemyBullets[ei].y > CH + 12) { enemyBullets.splice(ei, 1); continue; }
            var edx = enemyBullets[ei].x - ship.x;
            var edy = enemyBullets[ei].y - ship.y;
            if (Math.abs(edx) < 18 * SCALE && Math.abs(edy) < 18 * SCALE) {
                takeDamage(10);
                enemyBullets.splice(ei, 1);
            }
        }

        // move bullets upward, remove when off-screen
        for (var i = bullets.length - 1; i >= 0; i--) {
            bullets[i].y += bullets[i].vy * dt;
            if (bullets[i].y < -12) bullets.splice(i, 1);
        }

        // ── update each enemy ─────────────────────────────────────────────────
        for (var ei2 = enemies.length - 1; ei2 >= 0; ei2--) {
            var e = enemies[ei2];
            e.y += e.vy * dt;
            e.phase += dt * 0.5;
            e.x += Math.sin(e.phase) * 18 * dt;
            e.x = Math.max(CW * 0.1, Math.min(CW * 0.9, e.x));
            if (e.flash > 0) e.flash -= dt;

            // scrolled off bottom
            if (e.y > CH + SHIP_H) {
                killEnemy(e, ei2);
                continue;
            }

            // bullet hit test against this enemy
            for (var j = bullets.length - 1; j >= 0; j--) {
                var dx = bullets[j].x - e.x;
                var dy = bullets[j].y - e.y;
                if (Math.abs(dx) < 20 * SCALE && Math.abs(dy) < 20 * SCALE) {
                    e.hp--;
                    e.flash = 0.14;
                    bullets.splice(j, 1);
                    if (e.hp <= 0) {
                        var streakMult = 1 + (window.streak || 0) * 0.1;
                        var earned = Math.round(MONEY_PER_KILL * streakMult);
                        money += earned;
                        localStorage.setItem('idle_money', money);
                        if (moneyEl) moneyEl.textContent = money;
                        if (open || locked) spawnKillFloat(e.x, e.y, earned);
                        killEnemy(e, ei2);
                        break;
                    }
                }
            }
        }

        // ── wave driver ───────────────────────────────────────────────────────
        var wave = WAVES[waveIndex % WAVES.length];
        waveTimer += dt;
        if (waveTimer >= wave.duration) {
            waveTimer = 0;
            waveGapTimer = 0;
            waveIndex++;
            wave = WAVES[waveIndex % WAVES.length];
        }
        if (enemies.length < wave.maxEnemies) {
            waveGapTimer -= dt;
            if (waveGapTimer <= 0) {
                spawnEnemyWave(wave.enemyHp, wave.enemyVy);
                waveGapTimer = wave.gap + Math.random() * (wave.gap * 0.3);
            }
        }

        updateMissiles(dt);
    }
    // ── draw ──────────────────────────────────────────────────────────────────
    function drawSeaFar() {
        if (!imgFar.complete || !imgFar.naturalWidth) return;
        var cameraTop = ship.worldY - CH * 0.75;
        var nearScreenY = Math.round(-cameraTop);
        var clipH = nearScreenY > 0 ? Math.min(nearScreenY, CH) : CH;

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, CW, clipH);
        ctx.clip();
        var offset = cameraTop * 0.45;
        var startY = -(offset % SEA_TILE_H);
        if (startY > 0) startY -= SEA_TILE_H;
        for (var y = startY; y < clipH; y += SEA_TILE_H) {
            ctx.drawImage(imgFar, 0, y, CW, SEA_TILE_H);
        }
        ctx.restore();
    }

    function drawSeaNear() {
        if (!imgNear.complete || !imgNear.naturalWidth) return;
        var cameraTop = ship.worldY - CH * 0.75;
        var screenY = Math.round(-cameraTop);
        if (screenY >= CH || screenY + SEA_TILE_H <= 0) return;
        ctx.drawImage(imgNear, 0, screenY, CW, SEA_TILE_H);
    }
    function drawCombat() {
        if (flightState === 'grounded') return;
        var dark = document.documentElement.classList.contains('dark');

        // bullets — thin vertical streaks
        ctx.fillStyle = dark ? '#c8c4bc' : 'rgba(26,25,22,1)';
        for (var i = 0; i < bullets.length; i++) {
            ctx.fillRect(bullets[i].x - 2 * SCALE, bullets[i].y - 7 * SCALE, 4 * SCALE, 12 * SCALE);
        }

        // enemy bullets — slightly wider, clearly visible
        ctx.fillStyle = dark ? 'rgba(200,196,188,0.85)' : 'rgba(26,25,22,0.8)';
        for (var i = 0; i < enemyBullets.length; i++) {
            ctx.fillRect(enemyBullets[i].x - 2.5 * SCALE, enemyBullets[i].y - 6 * SCALE, 5 * SCALE, 11 * SCALE);
        }

        // missiles
        for (var i = 0; i < missiles.length; i++) {
            var m = missiles[i];
            for (var t = 0; t < m.trail.length; t++) {
                var tf = 1 - (m.trail[t].age / 0.35);
                ctx.globalAlpha = tf * (m.phase === 'lock' ? 0.55 : 0.18);
                var ts = (m.phase === 'lock' ? 2.5 : 1.5) * tf * SCALE;
                ctx.fillStyle = dark ? '#c8c4bc' : '#1a1916';
                ctx.beginPath();
                ctx.arc(m.trail[t].x, m.trail[t].y, ts, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            ctx.save();
            ctx.translate(m.x, m.y);
            ctx.rotate(m.angle + Math.PI / 2);
            ctx.globalAlpha = m.phase === 'eject' ? 0.5 : m.phase === 'hang' ? 0.65 : 0.85;
            ctx.fillStyle = dark ? '#c8c4bc' : '#1a1916';

            var bw = 2 * SCALE, bh = 7 * SCALE;
            ctx.fillRect(-bw / 2, -bh, bw, bh + 4 * SCALE);
            ctx.beginPath();
            ctx.moveTo(-bw / 2, -bh);
            ctx.lineTo(0, -bh - 5 * SCALE);
            ctx.lineTo(bw / 2, -bh);
            ctx.fill();

            if (m.phase === 'lock') {
                ctx.globalAlpha = 0.4 + Math.random() * 0.3;
                ctx.fillStyle = dark ? '#6a6660' : '#6a6660';
                ctx.fillRect(-bw / 2, 4 * SCALE, bw, (3 + Math.random() * 4) * SCALE);
            }

            ctx.globalAlpha = 1;
            ctx.restore();
        }

    }

    // ── gen bar ───────────────────────────────────────────────────────────────
    function updateGenBar() {
        if (!genBarEl) return;
        genBarEl.style.width = Math.max(0, (gen / GEN_MAX) * 100) + '%';
    }

    function updateArmourBar() {
        if (!armourBarEl) return;
        var total = SHIELD_MAX + ARMOUR_MAX;
        var filled = ((shields + armour) / total) * 100;
        var shieldFraction = shields / (shields + armour + 0.001);
        armourBarEl.style.width = Math.max(0, filled) + '%';
        var dark = document.documentElement.classList.contains('dark');
        armourBarEl.style.background = shieldFraction > 0.05
            ? (dark ? '#c8c4bc' : '#1a1916')
            : '#8a4a3a';
    }

    // ── RAF loop ──────────────────────────────────────────────────────────────
    function rafLoop(now) {
        var dt = Math.min((now - lastRaf) / 1000, 0.1);
        lastRaf = now;


        if (open || locked) {
            var spd = scrollSpeed();
            if (flightState !== 'grounded') ship.worldY -= spd * dt;
            steer(dt);
            updateCombat(now, dt);
            ctx.clearRect(0, 0, CW, CH);
            drawSeaFar();
            drawSeaNear();
            drawCombat();
            updateShipDom();
            updateEnemyDom();
            updateGenBar();
            updateArmourBar();
            updateSecondarySlotEl();
            if (MOBILE) {
                if (mobileGenEl) mobileGenEl.textContent = Math.round(gen);
                if (mobileShieldsEl) mobileShieldsEl.textContent = Math.round(shields);
                if (mobileProgFill) {
                    var _dc = typeof doneCount !== 'undefined' ? doneCount : 0;
                    var _ql = typeof queue !== 'undefined' && queue ? queue.length : 0;
                    mobileProgFill.style.width = (_dc + _ql > 0 ? (_dc / (_dc + _ql)) * 100 : 0) + '%';
                }
                if (drawerShipEl) drawerShipEl.src = shipEl.src;
            }
        }

        if (open) updateUI();

        requestAnimationFrame(rafLoop);
    }

    // ── styles ────────────────────────────────────────────────────────────────
    function injectStyles() {
        // All styles moved to idle.css
    }

    // ── missile purchase ──────────────────────────────────────────────────────
    function buyMissile() {
        if (secondaryWeapon) return;
        if (money < MISSILE_PRICE) return;
        money -= MISSILE_PRICE;
        localStorage.setItem('idle_money', money);
        localStorage.setItem('idle_missile_unlocked', '1');
        if (moneyEl) moneyEl.textContent = money;
        secondaryWeapon = { cooldown: 4.5, timer: 0, _last: 0 };
        updateSecondarySlotEl();
    }

    function updateSecondarySlotEl() {
        if (!secondarySlotEl) return;
        if (secondaryWeapon) {
            secondarySlotEl.textContent = 'M';
            secondarySlotEl.classList.add('equipped');
            secondarySlotEl.title = 'Missile';
        } else {
            secondarySlotEl.textContent = money >= MISSILE_PRICE ? MISSILE_PRICE : '\u2013';
            secondarySlotEl.classList.remove('equipped');
            secondarySlotEl.title = money >= MISSILE_PRICE ? 'Buy missile' : 'Need ' + MISSILE_PRICE;
        }
    }

    // ── loadout slots ─────────────────────────────────────────────────────────
    function buildLoadoutSlots(parentEl) {
        var tooltip = document.createElement('div');
        tooltip.id = 'idle-slot-tooltip';
        document.body.appendChild(tooltip);

        function showTip(anchorEl, lines) {
            if (suppressTooltips) return;
            tooltip.innerHTML = lines.join('<br>');
            tooltip.style.display = 'block';
            var r = anchorEl.getBoundingClientRect();
            tooltip.style.top = Math.max(4, r.top) + 'px';
            tooltip.style.left = 'auto';
            tooltip.style.right = (window.innerWidth - r.left + 6) + 'px';
        }
        function hideTip() { if (suppressTooltips) return; tooltip.style.display = 'none'; }

        function makeWeaponSlot(weapon, slotNum) {
            var el = document.createElement('div');
            var hasName = weapon && weapon.name;
            el.className = 'idle-slot' + (hasName ? ' equipped' : '');
            el.textContent = hasName ? weapon.name.charAt(0) : '\u00b7';
            el.addEventListener('mouseenter', function () {
                var lines = ['Slot\u2009' + slotNum + '\u2009\u00b7\u2009' + (hasName ? weapon.name : 'Empty')];
                if (hasName) lines.push('DMG\u2009' + weapon.damage + '\u2003GEN\u2009' + weapon.genCost);
                showTip(el, lines);
            });
            el.addEventListener('mouseleave', hideTip);
            return el;
        }

        function makeGenSlot(gen) {
            var el = document.createElement('div');
            el.className = 'idle-slot' + (gen ? ' equipped' : '');
            el.textContent = gen ? 'G' : '\u00b7';
            el.addEventListener('mouseenter', function () {
                var lines = ['Generator\u2009\u00b7\u2009' + (gen ? gen.name : 'Empty')];
                if (gen) lines.push('Regen\u2009' + gen.regenRate + '/s');
                showTip(el, lines);
            });
            el.addEventListener('mouseleave', hideTip);
            return el;
        }

        var label = document.createElement('div');
        label.id = 'idle-loadout-label';
        label.textContent = 'loadout';
        parentEl.appendChild(label);

        var row = document.createElement('div');
        row.id = 'idle-loadout-row';

        var weaponsCol = document.createElement('div');
        weaponsCol.id = 'idle-loadout-weapons';
        var weaponSlots = [primaryWeapon, secondaryWeapon, tertiaryWeapon, rearWeapon];
        for (var i = 0; i < weaponSlots.length; i++) {
            var slotEl = makeWeaponSlot(weaponSlots[i], i + 1);
            if (i === 1) {
                secondarySlotEl = slotEl;
                slotEl.addEventListener('click', function () { buyMissile(); });
                slotEl.style.cursor = 'pointer';
            }
            weaponsCol.appendChild(slotEl);
        }

        var gensCol = document.createElement('div');
        gensCol.id = 'idle-loadout-generators';
        gensCol.appendChild(makeGenSlot(generatorSlot));

        var shipDiagram = document.createElement('div');
        shipDiagram.id = 'idle-ship-diagram';

        row.appendChild(weaponsCol);
        row.appendChild(shipDiagram);
        row.appendChild(gensCol);
        parentEl.appendChild(row);
    }

    // ── DOM ───────────────────────────────────────────────────────────────────
    function buildCanvas() {
        canvasEl = document.createElement('canvas');
        canvasEl.id = 'idle-canvas';
        ctx = canvasEl.getContext('2d');
        document.body.appendChild(canvasEl);
        if (open || locked) canvasEl.classList.add('on');
    }

    function buildShip() {
        shipEl = document.createElement('img');
        shipEl.id = 'idle-ship';
        shipEl.src = 'assets/ship.png';
        document.body.appendChild(shipEl);
        if (open || locked) shipEl.classList.add('on');
    }

    function buildEnemy() {
        // template element — used only to preload image and read naturalWidth/Height
        // actual enemy sprites are created per-enemy via createEnemySpriteEl()
        enemyEl = document.createElement('img');
        enemyEl.id = 'idle-enemy';
        enemyEl.src = 'assets/enemy1.png';
        document.body.appendChild(enemyEl);
    }

    function buildDOM() {
        injectStyles();
        buildCanvas();
        buildShip();
        buildEnemy();
        positionCanvas();

        ship.x = CW / 2;
        ship.y = CH * 0.80;
        ship.worldY = CH * 0.25;
        updateShipDom();

        if (MOBILE) {
            // ── Mobile: inject compact stats into topbar ───────────────────────
            var topbarStats = document.createElement('div');
            topbarStats.id = 'idle-topbar-stats';
            topbarStats.style.display = open ? 'flex' : 'none';

            // GEN item
            var genItem = document.createElement('div');
            genItem.className = 'idle-topbar-item';
            var genLbl = document.createElement('div');
            genLbl.className = 'idle-topbar-item-label';
            genLbl.textContent = 'GEN';
            mobileGenEl = document.createElement('div');
            mobileGenEl.className = 'idle-topbar-item-val';
            mobileGenEl.textContent = Math.round(gen);
            genItem.appendChild(genLbl);
            genItem.appendChild(mobileGenEl);
            topbarStats.appendChild(genItem);

            // SH item
            var shItem = document.createElement('div');
            shItem.className = 'idle-topbar-item';
            var shLbl = document.createElement('div');
            shLbl.className = 'idle-topbar-item-label';
            shLbl.textContent = 'SH';
            mobileShieldsEl = document.createElement('div');
            mobileShieldsEl.className = 'idle-topbar-item-val';
            mobileShieldsEl.textContent = '100';
            shItem.appendChild(shLbl);
            shItem.appendChild(mobileShieldsEl);
            topbarStats.appendChild(shItem);

            // Progress bar — two raw inline-styled divs, no class names
            var progTrack = document.createElement('div');
            progTrack.style.cssText = 'width:60px;height:2px;background:#e8e4dc;overflow:hidden;flex-shrink:0';
            mobileProgFill = document.createElement('div');
            mobileProgFill.style.cssText = 'height:100%;width:0%;background:#c8c4bc;transition:width .3s ease';
            progTrack.appendChild(mobileProgFill);
            topbarStats.appendChild(progTrack);

            // Money — keep as-is
            moneyEl = document.createElement('div');
            moneyEl.id = 'idle-topbar-money';
            moneyEl.textContent = money;
            topbarStats.appendChild(moneyEl);

            var topbarDark = document.getElementById('topbar-dark');
            if (topbarDark && topbarDark.parentNode) {
                topbarDark.parentNode.insertBefore(topbarStats, topbarDark);
            }

            // ── Mobile: drawer toggle (before dark toggle) ─────────────────────
            var drawerToggleBtn = document.createElement('button');
            drawerToggleBtn.id = 'idle-drawer-toggle';
            drawerToggleBtn.setAttribute('aria-label', 'loadout drawer');
            drawerToggleBtn.textContent = '\u229e';
            drawerToggleBtn.style.display = open ? '' : 'none';
            drawerToggleBtn.addEventListener('click', function () {
                drawerOpen = !drawerOpen;
                if (drawerEl) drawerEl.style.transform = drawerOpen ? 'translateX(0)' : 'translateX(100%)';
            });
            if (topbarDark && topbarDark.parentNode) {
                topbarDark.parentNode.insertBefore(drawerToggleBtn, topbarDark);
            }

            // ── Mobile: left drawer ────────────────────────────────────────────
            drawerEl = document.createElement('div');
            drawerEl.id = 'idle-drawer';
            drawerEl.style.transform = drawerOpen ? 'translateX(0)' : 'translateX(100%)';

            // Ship diagram box — centred ship img mirroring flight state
            var diagBox = document.createElement('div');
            diagBox.id = 'idle-ship-diagram';
            diagBox.className = 'idle-drawer-shipbox';
            var diagImg = document.createElement('img');
            diagImg.src = 'assets/ship.png';
            diagImg.style.cssText = 'width:32px;image-rendering:pixelated;image-rendering:crisp-edges';
            drawerShipEl = diagImg;
            diagBox.appendChild(diagImg);
            drawerEl.appendChild(diagBox);

            buildLoadoutSlots(drawerEl);
            document.body.appendChild(drawerEl);

            // ── Mobile: canvas toggle button above submit button ───────────────
            toggleEl = document.createElement('button');
            toggleEl.id = 'idle-toggle';
            toggleEl.setAttribute('aria-label', 'idle');
            toggleEl.textContent = open ? '\u25c9' : '\u25cf';
            toggleEl.style.bottom = '88px';
            toggleEl.style.right = '14px';
            toggleEl.classList.toggle('on', open);
            toggleEl.addEventListener('click', function () {
                open = !open;
                setVisible(open);
                topbarStats.style.display = open ? 'flex' : 'none';
                drawerToggleBtn.style.display = open ? '' : 'none';
                if (!open && drawerEl) {
                    drawerOpen = false;
                    drawerEl.style.transform = 'translateX(100%)';
                }
                toggleEl.textContent = open ? '\u25c9' : '\u25cf';
                localStorage.setItem('idle_panel_open', open ? '1' : '0');
                toggleEl.classList.toggle('on', open);
            });
            document.body.appendChild(toggleEl);
        } else {
            // ── Desktop: existing panel + toggle ──────────────────────────────
            toggleEl = document.createElement('button');
            toggleEl.id = 'idle-toggle';
            toggleEl.setAttribute('aria-label', 'idle');
            toggleEl.addEventListener('click', togglePanel);
            toggleEl.textContent = locked ? '\u25c9' : '\u25cf';
            toggleEl.classList.toggle('locked', locked);
            document.body.appendChild(toggleEl);

            panelEl = document.createElement('div');
            panelEl.id = 'idle-panel';

            spmEl = document.createElement('div');
            spmEl.id = 'idle-spm';
            panelEl.appendChild(spmEl);

            var genLabel = document.createElement('div');
            genLabel.id = 'idle-gen-label';
            genLabel.textContent = 'gen';
            panelEl.appendChild(genLabel);

            var genTrack = document.createElement('div');
            genTrack.id = 'idle-gen-track';
            genBarEl = document.createElement('div');
            genBarEl.id = 'idle-gen-bar';
            genTrack.appendChild(genBarEl);
            panelEl.appendChild(genTrack);

            var armourLabel = document.createElement('div');
            armourLabel.id = 'idle-armour-label';
            armourLabel.textContent = '\u26e8 Shields';
            panelEl.appendChild(armourLabel);

            var armourTrack = document.createElement('div');
            armourTrack.id = 'idle-armour-track';
            armourBarEl = document.createElement('div');
            armourBarEl.id = 'idle-armour-bar';
            armourTrack.appendChild(armourBarEl);
            panelEl.appendChild(armourTrack);

            var moneyLabel = document.createElement('div');
            moneyLabel.id = 'idle-money-label';
            moneyLabel.textContent = 'money';
            panelEl.appendChild(moneyLabel);

            moneyEl = document.createElement('div');
            moneyEl.id = 'idle-money';
            moneyEl.textContent = money;
            panelEl.appendChild(moneyEl);

            buildLoadoutSlots(panelEl);

            var bottomRow = document.createElement('div');
            bottomRow.id = 'idle-bottom-row';

            lockBtn = document.createElement('button');
            lockBtn.id = 'idle-lock';
            lockBtn.textContent = locked ? 'Unpin view' : 'Pin view';
            lockBtn.classList.toggle('on', locked);
            lockBtn.addEventListener('click', toggleLock);
            bottomRow.appendChild(lockBtn);

            var resetBtn = document.createElement('button');
            resetBtn.id = 'idle-reset';
            resetBtn.textContent = '\u21ba';
            resetBtn.title = 'Reset progress';
            resetBtn.addEventListener('click', function () {
                if (!confirm('Reset all progress?')) return;
                localStorage.removeItem('idle_money');
                localStorage.removeItem('idle_missile_unlocked');
                money = 0;
                if (moneyEl) moneyEl.textContent = money;
                secondaryWeapon = null;
                updateSecondarySlotEl();
                // cut ship instantly so it doesn't visibly snap to pier
                shipEl.style.transition = 'opacity 0s';
                shipEl.style.opacity = '0';
                resetToStart();
                requestAnimationFrame(function () {
                    shipEl.style.transition = '';
                    shipEl.style.opacity = '';
                });
            });
            bottomRow.appendChild(resetBtn);

            panelEl.appendChild(bottomRow);

            document.body.appendChild(panelEl);
            panelEl.classList.toggle('on', open);
            toggleEl.classList.toggle('on', open);
        }

        // Set initial minimal state to match open/locked state from localStorage
        document.body.classList.toggle('idle-minimal', open || locked);
    }

    // ── visibility ────────────────────────────────────────────────────────────
    function setVisible(v) {
        canvasEl.classList.toggle('on', v);
        shipEl.classList.toggle('on', v);
        if (v) {
            for (var i = 0; i < enemies.length; i++) {
                if (enemies[i].el) enemies[i].el.style.opacity = '0.85';
            }
        } else {
            // immediately remove all enemy elements and reset — no fading ghosts
            resetToStart();
        }
        document.body.classList.toggle('idle-minimal', v);
    }

    function togglePanel() {
        open = !open;
        panelEl.classList.toggle('on', open);
        toggleEl.classList.toggle('on', open);
        setVisible(open || locked);
        localStorage.setItem('idle_panel_open', open ? '1' : '0');
    }

    function toggleLock() {
        locked = !locked;
        lockBtn.textContent = locked ? 'Unpin view' : 'Pin view';
        lockBtn.classList.toggle('on', locked);
        toggleEl.textContent = locked ? '\u25c9' : '\u25cf';
        toggleEl.classList.toggle('locked', locked);
        setVisible(open || locked);
        localStorage.setItem('idle_locked', locked ? '1' : '0');
    }

    // ── float ─────────────────────────────────────────────────────────────────
    function spawnEnergyFloat(amount) {
        var q = document.getElementById('question');
        var x, y;
        if (q) {
            var r = q.getBoundingClientRect();
            x = r.left + r.width / 2 - 20;
            y = r.top;
        } else {
            x = window.innerWidth / 2;
            y = window.innerHeight * 0.4;
        }
        var el = document.createElement('span');
        el.className = 'idle-float';
        el.textContent = '⁂' + (amount || GEN_AWARD);
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        document.body.appendChild(el);
        el.addEventListener('animationend', function () { el.remove(); });
    }

    function spawnKillFloat(canvasX, canvasY, amount) {
        var el = document.createElement('span');
        el.className = 'idle-float-kill';
        el.textContent = '+' + amount;
        el.style.left = Math.round(cardLeft + canvasX - 16) + 'px';
        el.style.top = Math.round(canvasY) + 'px';
        document.body.appendChild(el);
        el.addEventListener('animationend', function () { el.remove(); });
    }

    function getSPM() {
        var mins = (Date.now() - sessionStart) / 60000;
        if (mins < 0.1) return '0.0';
        return (correctCount / mins).toFixed(1);
    }
    function resetToStart() {
        // clear enemies
        for (var i = 0; i < enemies.length; i++) {
            if (enemies[i].el) enemies[i].el.remove();
        }
        enemies = [];
        bullets = [];
        missiles = [];
        enemyBullets = [];

        // reset waves
        waveIndex = 0;
        waveTimer = 0;
        waveGapTimer = ENEMY_INITIAL_DELAY;

        // reset stats
        gen = GEN_MAX;
        shields = SHIELD_MAX;
        armour = ARMOUR_MAX;
        lastHitTime = 0;

        // put ship back on pier
        flightState = 'grounded';
        pilotState = 'seek';
        breakTimer = 0;
        shipEl.src = 'assets/ship.png';
        burnFrame = 0;
        burnTimer = 0;
        ship.x = CW / 2;
        ship.y = CH * 0.80;
        ship.vx = 0;
        ship.vy = 0;
        ship.worldY = CH * 0.25;
        correctCount = 0;
        sessionStart = Date.now();
    }

    window.resetToStart = function () { if (flightState === 'grounded') return; resetToStart(); };

    function takeoff() {
        if (flightState === 'grounded') {
            flightState = 'ignition';
            shipEl.src = 'assets/ship-burn.png';
            return;
        }
        if (flightState === 'ignition') {
            flightState = 'cruising';
            shipEl.src = 'assets/ship-cruise.png';
        }
    }
    function award(n, timePct) {
        correctCount++;
        var actual = Math.round(GEN_AWARD * (1 + (timePct || 0)));
        gen = Math.min(GEN_MAX, gen + actual);
        takeoff();
        if (open || locked) spawnEnergyFloat(actual);
    }

    function updateUI() {
        if (!spmEl) return;
        spmEl.textContent = correctCount > 0 ? getSPM() + '\u2009/spm' : '';
    }

    // ── submit patch ──────────────────────────────────────────────────────────
    function patchSubmitAnswer() {
        if (typeof window.submitAnswer !== 'function') return;
        var orig = window.submitAnswer;
        window.submitAnswer = function () {
            var timerFill = document.getElementById('timer-fill');
            var timePct = timerFill ? (parseFloat(timerFill.style.width) || 0) / 100 : 0;
            orig.apply(this, arguments);
            var fb = document.getElementById('feedback');
            if (fb && fb.className.indexOf('correct') !== -1) {
                var path = window.location.pathname;
                var amt =
                    path.indexOf('index') !== -1 ? 0.1 :
                        path.indexOf('division') !== -1 ? 0.25 :
                            path.indexOf('addsubtract') !== -1 ? (window.idleQuestionValue || 0.3) :
                                path.indexOf('fractions') !== -1 ? 5 : 0.1;
                award(amt, timePct);
            }
        };
    }

    // ── init ──────────────────────────────────────────────────────────────────
    window.addEventListener('DOMContentLoaded', function () {
        if (localStorage.getItem('idle_missile_unlocked') === '1') {
            secondaryWeapon = { cooldown: 4.5, timer: 0, _last: 0 };
        }
        buildDOM();
        if (MOBILE && window.visualViewport) {
            function updateCanvasToViewport() {
                var vv = window.visualViewport;
                CH = Math.round(vv.height);
                canvasEl.style.top = Math.round(vv.offsetTop) + 'px';
                canvasEl.style.height = CH + 'px';
                canvasEl.height = CH;
                positionCanvas();
                if (toggleEl) {
                    var kbH = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
                    toggleEl.style.bottom = (kbH + 96) + 'px';
                }
                if (flightState === 'grounded') { ship.y = CH * 0.80; }
                updateShipDom();
            }
            window.visualViewport.addEventListener('resize', updateCanvasToViewport);
            window.visualViewport.addEventListener('scroll', updateCanvasToViewport);
            updateCanvasToViewport();
        }
        patchSubmitAnswer();
        spawnLevel();
        // clear enemies spawned by spawnLevel — use initial delay from config
        for (var i = 0; i < enemies.length; i++) {
            if (enemies[i].el) enemies[i].el.remove();
        }
        enemies = [];
        waveGapTimer = ENEMY_INITIAL_DELAY;
        ship.worldY = CH * 0.25;
        updateUI();
        lastRaf = performance.now();
        requestAnimationFrame(rafLoop);
    });

    window.addEventListener('resize', function () {
        CH = window.innerHeight;
        CW = Math.round(CH * (4 / 10));
        positionCanvas();
        if (flightState === 'grounded') {
            ship.x = CW / 2;
            ship.y = CH * 0.8;
        }
    });

}());