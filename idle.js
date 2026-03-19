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

    var panelEl, toggleEl, spmEl, genBarEl, lockBtn, shipEl, moneyEl, canvasEl, ctx;

    var gameOver = false;
    var gameOverEl = null;
    var correctCount = 0;
    var sessionStart = Date.now();
    var open = localStorage.getItem('idle_panel_open') === '1';
    var locked = localStorage.getItem('idle_locked') === '1';

    var MOBILE = window.innerWidth < 768;
    var SCALE = MOBILE ? 0.5 : 1;

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
    imgFar.src = 'assets/sea-far.png';
    imgNear.src = 'assets/sea-near.png';

    // ── scroll ────────────────────────────────────────────────────────────────

    var lastRaf = performance.now();

    // ── flight ────────────────────────────────────────────────────────────────
    var flightState = 'grounded';
    var ship = { x: 0, y: 0, vx: 0, vy: 0, worldY: 0 };


    // ── generator — energy = bullets ─────────────────────────────────────────
    //   correct answer tops it up, each bullet fired drains it,
    //   barely ticks down when idle so you can see sums refilling it
    var GEN_MAX = 100;
    var gen = GEN_MAX;
    var GEN_AWARD = 28;   // per correct answer
    var GEN_COST = 1.5;    // per bullet fired
    var GEN_IDLE = 0.3;  // per second passive drain (near-zero)
    var GEN_REGEN = 0.45;


    //money────────────────────────────────────────────────────────────────
    var money = parseInt(localStorage.getItem('idle_money') || '0', 10);
    var MONEY_PER_KILL = 5;

    // ── armour ────────────────────────────────────────────────────────────────
    var SHIELD_MAX = 80;
    var ARMOUR_MAX = 20;
    var shields = SHIELD_MAX;
    var armour = ARMOUR_MAX;
    var SHIELD_REGEN = 12;  // points/sec at full gen
    var armourBarEl;

    // ── combat ────────────────────────────────────────────────────────────────    
    var bullets = [];
    var enemies = [];
    var enemyBullets = [];
    var ENEMY_FIRE_RATE = 1.8;  // seconds between shots, tune this
    var obstacles = [];
    var lastFireMs = 0;
    var enemyRespawnTimer = 0;

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
        var dark = document.documentElement.classList.contains('dark');
        for (var i = 0; i < enemies.length; i++) {
            var e = enemies[i];
            e.el.style.left = Math.round(cardLeft + e.x - SHIP_W / 2) + 'px';
            e.el.style.top = Math.round(e.y - SHIP_H / 2) + 'px';
            e.el.style.filter = e.flash > 0
                ? (dark ? 'invert(1) brightness(2)' : 'brightness(2)')
                : (dark ? 'invert(1)' : 'none');
            e.el.style.display = 'block';
        }
    }

    // ── scroll speed ──────────────────────────────────────────────────────────
    function scrollSpeed() {
        if (flightState === 'grounded') return 0;
        var spm = parseFloat(getSPM()) || 0;
        return 5 + Math.min(spm * 20, 150);
    }

    // ── level / enemy spawn ───────────────────────────────────────────────────
    function spawnEnemy() {
        var el = makeEnemyEl();
        var w = el.naturalWidth || 16;
        var h = el.naturalHeight || 16;
        enemies.push({
            el: el,
            x: CW * 0.2 + Math.random() * CW * 0.6,
            y: -SHIP_H,
            hp: 3,
            maxHp: 3,
            vy: 70 + scrollSpeed() * 0.25,
            phase: Math.random() * Math.PI * 2,
            flash: 0,
            lastFireMs: 0,
            hw: w * 1.5 * SCALE,
            hh: h * 1.5 * SCALE,
        });
    }

    function spawnLevel() {
        // 1 or 2 obstacles in the middle zone
        obstacles = [];
        bullets = [];
    }

    // ── steering — 2D vector forces ───────────────────────────────────────────
    function steer(dt) {
        if (flightState === 'grounded' || flightState === 'ignition') return;

        if (flightState === 'cruising') {
            var spd = Math.sqrt(ship.vx * ship.vx + ship.vy * ship.vy);
            if (spd > 20) {   // only animate when actually moving
                burnTimer += dt;
                if (burnTimer >= BURN_INTERVAL) {
                    burnTimer = 0;
                    burnFrame = 1 - burnFrame;
                    shipEl.src = burnFrame === 0 ? 'assets/ship-cruise.png' : 'assets/ship-cruise2.png';
                }
            } else {
                shipEl.src = 'assets/ship-cruise.png';  // settled back to frame 1
                burnFrame = 0;
            }
        }
        var fx = 0, fy = 0;

        var target = null;
        for (var i = 0; i < enemies.length; i++) {
            if (!target || enemies[i].y > target.y) target = enemies[i];
        }
        if (target) {
            var leadTime = 0.7;
            var predictedX = target.x + Math.sin(target.phase + leadTime * 0.5) * 18 * leadTime;
            fx += (predictedX - ship.x) * 18.0;
            fy += ((MOBILE ? CH * 0.325 : CH * 0.75) - ship.y) * 1.8;
        } else {
            fx += (CW * 0.5 - ship.x) * 0.9;
            fy += ((MOBILE ? CH * 0.35 : CH * 0.75) - ship.y) * 1.8;
        }



        // canvas boundary forces
        var m = 38 * SCALE;
        if (ship.x < m) fx += (m - ship.x) * 4;
        if (ship.x > CW - m) fx += (CW - m - ship.x) * 4;
        if (ship.y < m) fy += (m - ship.y) * 4;
        if (ship.y > CH - m) fy += (CH - m - ship.y) * 4;

        // integrate with damping
        var damp = 0.86;
        ship.vx = (ship.vx + fx * dt) * damp;
        ship.vy = (ship.vy + fy * dt) * damp;

        // speed cap
        var spd = Math.sqrt(ship.vx * ship.vx + ship.vy * ship.vy);
        var maxSpd = 155;
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
        if (!enemies.length || gen <= 0) return;
        if (now - lastFireMs < 1000 / fireRate()) return;
        var best = null;
        for (var i = 0; i < enemies.length; i++) {
            if (Math.abs(ship.x - enemies[i].x) <= 36) {
                if (!best || enemies[i].y > best.y) best = enemies[i];
            }
        }
        if (!best) return;
        var timeToTarget = (ship.y - best.y) / 385;
        var predictedX = best.x + Math.sin(best.phase + timeToTarget * 0.5) * 18 * timeToTarget;
        var vx = (predictedX - ship.x) / timeToTarget;
        bullets.push({ x: ship.x, y: ship.y - SHIP_H * 0.45, vx: vx, vy: -385 }); gen = Math.max(0, gen - GEN_COST);
        lastFireMs = now;
    }

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

    function updateCombat(now, dt) {
        if (gameOver) return;
        if (flightState === 'grounded' || flightState === 'ignition') return;

        // near-zero idle drain — barely visible, so sums clearly top it up
        gen = Math.min(GEN_MAX, Math.max(0, gen - GEN_IDLE * dt + GEN_REGEN * dt));

        var regenRate = SHIELD_REGEN * (gen / GEN_MAX);
        shields = Math.min(SHIELD_MAX, shields + regenRate * dt);

        tryFire(now);
        tryEnemyFire(now);


        // move bullets upward, remove when off-screen
        for (var i = bullets.length - 1; i >= 0; i--) {
            bullets[i].x += (bullets[i].vx || 0) * dt;
            bullets[i].y += bullets[i].vy * dt;
            if (bullets[i].y < -12) bullets.splice(i, 1);
        }

        // move enemy bullets downward
        for (var i = enemyBullets.length - 1; i >= 0; i--) {
            enemyBullets[i].y += enemyBullets[i].vy * dt;
            if (enemyBullets[i].y > CH + 12) {
                enemyBullets.splice(i, 1);
                continue;
            }
            // hit ship?
            var dx = enemyBullets[i].x - ship.x;
            var dy = enemyBullets[i].y - ship.y;
            if (Math.abs(dx) < 18 * SCALE && Math.abs(dy) < 18 * SCALE) {
                takeDamage(10);
                enemyBullets.splice(i, 1);
            }
        }

        for (var i = enemies.length - 1; i >= 0; i--) {
            var e = enemies[i];
            e.y += e.vy * dt;
            e.phase += dt * 0.5;
            e.x += Math.sin(e.phase) * 18 * dt;
            e.x = Math.max(CW * 0.1, Math.min(CW * 0.9, e.x));
            if (e.flash > 0) e.flash -= dt;

            if (e.y > CH + SHIP_H) {
                e.el.remove();
                enemies.splice(i, 1);
                continue;
            }

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
                        e.el.remove();
                        enemies.splice(i, 1);
                        break;
                    }
                }
            }
        }

        enemyRespawnTimer -= dt;
        if (enemyRespawnTimer <= 0) {
            if (enemies.length < 6) spawnEnemy();
            enemyRespawnTimer = 3 + Math.random() * 7;  // 3–7 seconds

        }
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
        ctx.fillStyle = dark ? 'rgba(200,196,188,0.9)' : 'rgba(26,25,22,0.85)';
        for (var i = 0; i < bullets.length; i++) {
            ctx.fillRect(bullets[i].x - 1.5 * SCALE, bullets[i].y - 5 * SCALE, 3 * SCALE, 9 * SCALE);
        }

        // enemy bullets — slightly wider, same streak style
        ctx.fillStyle = dark ? 'rgba(200,196,188,0.5)' : 'rgba(26,25,22,0.45)';
        for (var i = 0; i < enemyBullets.length; i++) {
            ctx.fillRect(enemyBullets[i].x - 2 * SCALE, enemyBullets[i].y - 5 * SCALE, 4 * SCALE, 9 * SCALE);
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
        armourBarEl.style.background = shieldFraction > 0.05
            ? '#1a1916'   // shields still up — normal colour
            : '#8a4a3a';  // armour only — warmer tone as warning
    }

    function takeDamage(amount) {
        if (gameOver) return;
        var overflow = Math.max(0, amount - shields);
        shields = Math.max(0, shields - amount);
        if (overflow > 0) {
            armour = Math.max(0, armour - overflow);
            if (armour <= 0) triggerGameOver();
        }
    }
    // ── RAF loop ──────────────────────────────────────────────────────────────
    function rafLoop(now) {
        var dt = Math.min((now - lastRaf) / 1000, 0.1);
        lastRaf = now;

        var spd = scrollSpeed();
        if (flightState !== 'grounded') ship.worldY -= spd * dt;


        steer(dt);
        updateCombat(now, dt);

        if (open || locked) {
            ctx.clearRect(0, 0, CW, CH);
            drawSeaFar();
            drawSeaNear();
            drawCombat();
            updateShipDom();
            updateEnemyDom();
            updateGenBar();
            updateArmourBar();

        }

        if (open) updateUI();

        requestAnimationFrame(rafLoop);
    }

    // ── styles ────────────────────────────────────────────────────────────────
    function injectStyles() {
        var s = document.createElement('style');
        s.textContent = `

        /* ── toggle ────────────────────────────────────────────────────────── */
        #idle-toggle {
            position: fixed;
            bottom: 1.2rem;
            right: 1.4rem;
            background: none;
            border: none;
            cursor: pointer;
            font-size: 36px;
            color: #d8d4ce;
            line-height: 1;
            padding: 4px;
            z-index: 300;
            user-select: none;
            transition: color .25s;
            font-family: serif;
        }
        #idle-toggle:hover,
        #idle-toggle.on       { color: #8a8680; }
        #idle-toggle.locked   { font-size: 28px; }

        /* ── panel ─────────────────────────────────────────────────────────── */
        #idle-panel {
            position: fixed;
            top: 0; right: 0; bottom: 0;
            width: ${MOBILE ? 140 : 216}px;
            background: rgba(250,249,247,0.82);
            backdrop-filter: blur(5px);
            -webkit-backdrop-filter: blur(5px);
            border-left: 0.5px solid #c8c4bc;
            transform: translateX(100%);
            transition: transform .26s ease;
            z-index: 250;
            display: flex;
            flex-direction: column;
            padding: 2.2rem 1.4rem 1.5rem;
            font-family: "EB Garamond","Times New Roman",serif;
            color: #1a1916;
        }
        #idle-panel.on { transform: translateX(0); }

        /* ── spm ────────────────────────────────────────────────────────────── */
        #idle-spm {
            font-size: 32px;
            color: #aaa69e;
            letter-spacing: .08em;
            font-style: italic;
            min-height: 32px;
            margin-bottom: 0;
        }

        /* ── money ──────────────────────────────────────────────────────────── */
        #idle-money-label {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: .16em;
            color: #c8c4bc;
            margin-top: 0;
            margin-bottom: 4px;
        }
        #idle-money {
            font-size: 22px;
            letter-spacing: .04em;
            color: #1a1916;
            line-height: 1;
            margin-bottom: 1.2rem;
        }
        html.dark #idle-money-label { color: #3d4148; }
        html.dark #idle-money       { color: #c8c4bc; }

        /* ── gen bar ────────────────────────────────────────────────────────── */
        #idle-gen-label {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: .16em;
            color: #c8c4bc;
            margin-bottom: 10px;
        }
        #idle-gen-track {
            width: 100%;
            height: 2px;
            background: #e8e4dc;
            overflow: hidden;
        }
        #idle-gen-bar {
            height: 100%;
            width: 0%;
            background: #1a1916;
            transition: width .08s linear;
        }
        html.dark #idle-gen-label { color: #3d4148; }
        html.dark #idle-gen-track { background: #252830; }
        html.dark #idle-gen-bar   { background: #c8c4bc; }

        /* ── armour bar ─────────────────────────────────────────────────────── */
        #idle-armour-label {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: .16em;
            color: #c8c4bc;
            margin-top: 10px;
            margin-bottom: 10px;
        }
        #idle-armour-track {
            width: 100%;
            height: 2px;
            background: #e8e4dc;
            overflow: visible;
            position: relative;
        }
        #idle-armour-track::after {
            content: '';
            position: absolute;
            left: 20%;
            top: -2px;
            width: 1px;
            height: 6px;
            background: #c8c4bc;
        }
        #idle-armour-bar {
            height: 100%;
            width: 100%;
            background: #1a1916;
            transition: width .08s linear;
        }
        html.dark #idle-armour-label       { color: #3d4148; }
        html.dark #idle-armour-track       { background: #252830; }
        html.dark #idle-armour-track::after { background: #3a3d45; }
        html.dark #idle-armour-bar         { background: #c8c4bc; }

        /* ── game over ──────────────────────────────────────────────────────── */
        #idle-gameover {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            z-index: 500;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 1.4rem;
            pointer-events: none;
        }
        #idle-gameover-msg {
            font-family: "EB Garamond","Times New Roman",serif;
            font-size: 28px;
            font-style: italic;
            color: #aaa69e;
            letter-spacing: .08em;
        }
        #idle-gameover-btn {
            font-size: 10px;
            font-family: "EB Garamond","Times New Roman",serif;
            text-transform: uppercase;
            letter-spacing: .16em;
            color: #c8c4bc;
            background: none;
            border: 0.5px solid #e0ddd8;
            border-radius: 1px;
            padding: 6px 16px;
            cursor: pointer;
            pointer-events: all;
            transition: color .15s, border-color .15s;
        }
        #idle-gameover-btn:hover              { color: #1a1916; border-color: #8a8680; }
        html.dark #idle-gameover-msg          { color: #3a3d45; }
        html.dark #idle-gameover-btn          { color: #3a3d45; border-color: #252830; }
        html.dark #idle-gameover-btn:hover    { color: #c8c4bc; border-color: #6a6660; }

        /* ── lock button ────────────────────────────────────────────────────── */
        #idle-lock {
            font-size: 10px;
            color: #c8c4bc;
            background: none;
            border: 0.5px solid #e0ddd8;
            border-radius: 1px;
            padding: 4px 10px;
            letter-spacing: .1em;
            text-transform: uppercase;
            cursor: pointer;
            margin-top: auto;
            font-family: inherit;
            align-self: flex-start;
            transition: color .15s, border-color .15s;
        }
        #idle-lock:hover,
        #idle-lock.on { color: #1a1916; border-color: #8a8680; }
        html.dark #idle-lock          { color: #3a3d45; border-color: #252830; }
        html.dark #idle-lock:hover,
        html.dark #idle-lock.on       { color: #c8c4bc; border-color: #6a6660; }

        /* ── card transparency ──────────────────────────────────────────────── */
        .card            { background: rgba(255,255,255,0.15) !important; backdrop-filter: none; }
        html.dark .card  { background: rgba(13,15,18,0.15)   !important; }

        /* ── canvas ─────────────────────────────────────────────────────────── */
        #idle-canvas {
            position: fixed;
            top: 0; left: 0;
            height: 100%;
            z-index: 1;
            pointer-events: none;
            opacity: 0;
            transition: opacity 1.2s ease;
        }
        #idle-canvas.on          { opacity: 0.2; }
        html.dark #idle-canvas   { filter: invert(1); }

        /* ── ship ───────────────────────────────────────────────────────────── */
        #idle-ship {
            position: fixed;
            pointer-events: none;
            z-index: 3;
            width: ${48 * SCALE}px;
            height: auto;
            opacity: 0;
            transition: opacity 1.4s ease;
            image-rendering: pixelated;
            image-rendering: crisp-edges;
        }
        #idle-ship.on          { opacity: 0.3; }
        html.dark #idle-ship   { filter: invert(1); }

        /* ── enemy ──────────────────────────────────────────────────────────── */
        .idle-enemy {
            position: fixed;
            pointer-events: none;
            z-index: 2;
            width: ${48 * SCALE}px;
            height: auto;
            opacity: 0;
            transition: opacity 1.4s ease;
            image-rendering: pixelated;
            image-rendering: crisp-edges;
            transform-origin: center center;
        }
        .idle-enemy.on         { opacity: 0.3; }
        html.dark .idle-enemy  { filter: invert(1); }

        /* ── kill float ─────────────────────────────────────────────────────── */
        @keyframes idle-kill {
            0%   { transform: translate(0px,0px)   scale(1);    opacity: 1; }
            30%  { transform: translate(2px,-18px)  scale(1.05); opacity: 1; }
            70%  { transform: translate(-3px,-38px) scale(1.09); opacity: 0.7; }
            100% { transform: translate(1px,-52px)  scale(1.12); opacity: 0; }
        }
        .idle-float-kill {
            position: fixed;
            pointer-events: none;
            z-index: 400;
            font-family: "EB Garamond","Times New Roman",serif;
            font-size: 14px;
            letter-spacing: .1em;
            color: #1a1916;
            transform-origin: center bottom;
            animation: idle-kill 3.5s cubic-bezier(0.2,0.1,0.4,1) forwards;
        }
        html.dark .idle-float-kill { color: #c8c4bc; }

        /* ── energy float ───────────────────────────────────────────────────── */
        @keyframes idle-smoke {
            0%   { transform: translate(0px,0px)     scale(1);    opacity: 1; }
            20%  { transform: translate(3px,-24px)   scale(1.03); opacity: 1; }
            45%  { transform: translate(-4px,-54px)  scale(1.07); opacity: 1; }
            70%  { transform: translate(5px,-86px)   scale(1.11); opacity: 1; }
            100% { transform: translate(-2px,-118px) scale(1.14); opacity: 1; }
        }
        .idle-float {
            position: fixed;
            pointer-events: none;
            z-index: 400;
            font-family: "EB Garamond","Times New Roman",serif;
            font-size: 16px;
            letter-spacing: .06em;
            color: #aaa69e;
            transform-origin: center bottom;
            animation: idle-smoke 2.6s cubic-bezier(0.25,0.1,0.35,1) forwards;
        }
        html.dark .idle-float { color: #4a4d55; }

        /* ── dark panel overrides ───────────────────────────────────────────── */
        html.dark #idle-panel   { background: rgba(13,15,18,0.85); border-left-color: #252830; color: #c8c4bc; }
        html.dark #idle-toggle  { color: #2e3038; }
        html.dark #idle-toggle:hover,
        html.dark #idle-toggle.on { color: #6a6660; }
        html.dark #idle-spm     { color: #6a6660; }

        /* ── mobile topbar ──────────────────────────────────────────────────── */
        #idle-topbar-stats {
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 1;
            justify-content: center;
        }
        #idle-topbar-gen-track {
            width: 48px;
            height: 1px;
            background: transparent;
            overflow: hidden;
        }
        #idle-topbar-gen-bar {
            height: 100%;
            width: 0%;
            background: #1a1916;
            transition: width .08s linear;
        }
        #idle-topbar-money {
            font-size: 11px;
            letter-spacing: .1em;
            font-family: "EB Garamond","Times New Roman",serif;
            color: #aaa69e;
            min-width: 24px;
        }
        html.dark #idle-topbar-gen-track { background: transparent; }
        html.dark #idle-topbar-gen-bar   { background: #c8c4bc; }
        html.dark #idle-topbar-money     { color: #6a6660; }

        `;
        document.head.appendChild(s);
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

    function makeEnemyEl() {
        var el = document.createElement('img');
        el.className = 'idle-enemy';
        el.src = 'assets/enemy1.png';
        document.body.appendChild(el);
        if (open || locked) el.classList.add('on');
        return el;
    }

    function buildDOM() {
        injectStyles();
        buildCanvas();
        buildShip();
        positionCanvas();

        ship.x = CW / 2;
        ship.y = MOBILE ? CH * 0.80 : CH * 0.80;
        ship.worldY = CH * 0.2;
        updateShipDom();

        if (MOBILE) {
            // ── Mobile: inject compact stats into topbar ───────────────────────
            var topbarStats = document.createElement('div');
            topbarStats.id = 'idle-topbar-stats';
            topbarStats.style.display = open ? 'flex' : 'none';

            var topbarGenTrack = document.createElement('div');
            topbarGenTrack.id = 'idle-topbar-gen-track';
            genBarEl = document.createElement('div');
            genBarEl.id = 'idle-topbar-gen-bar';
            topbarGenTrack.appendChild(genBarEl);
            topbarStats.appendChild(topbarGenTrack);

            moneyEl = document.createElement('div');
            moneyEl.id = 'idle-topbar-money';
            moneyEl.textContent = money;
            topbarStats.appendChild(moneyEl);

            var topbarDark = document.getElementById('topbar-dark');
            if (topbarDark && topbarDark.parentNode) {
                topbarDark.parentNode.insertBefore(topbarStats, topbarDark);
            }

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

            var moneyLabel = document.createElement('div');
            moneyLabel.id = 'idle-money-label';
            moneyLabel.textContent = 'money';
            panelEl.appendChild(moneyLabel);

            moneyEl = document.createElement('div');
            moneyEl.id = 'idle-money';
            moneyEl.textContent = money;
            panelEl.appendChild(moneyEl);

            var genLabel = document.createElement('div');
            genLabel.id = 'idle-gen-label';
            genLabel.textContent = 'ϟ gen';
            panelEl.appendChild(genLabel);

            var genTrack = document.createElement('div');
            genTrack.id = 'idle-gen-track';
            genBarEl = document.createElement('div');
            genBarEl.id = 'idle-gen-bar';
            genTrack.appendChild(genBarEl);
            panelEl.appendChild(genTrack);

            var armourLabel = document.createElement('div');
            armourLabel.id = 'idle-armour-label';
            armourLabel.textContent = '⛨ Shields';
            panelEl.appendChild(armourLabel);

            var armourTrack = document.createElement('div');
            armourTrack.id = 'idle-armour-track';
            armourBarEl = document.createElement('div');
            armourBarEl.id = 'idle-armour-bar';
            armourTrack.appendChild(armourBarEl);
            panelEl.appendChild(armourTrack);

            lockBtn = document.createElement('button');
            lockBtn.id = 'idle-lock';
            lockBtn.textContent = locked ? 'Unpin view' : 'Pin view';
            lockBtn.classList.toggle('on', locked);
            lockBtn.addEventListener('click', toggleLock);
            panelEl.appendChild(lockBtn);

            document.body.appendChild(panelEl);
            panelEl.classList.toggle('on', open);
            toggleEl.classList.toggle('on', open);
        }
    }

    // ── visibility ────────────────────────────────────────────────────────────
    function setVisible(v) {
        canvasEl.classList.toggle('on', v);
        shipEl.classList.toggle('on', v);
        for (var i = 0; i < enemies.length; i++) {
            enemies[i].el.classList.toggle('on', v);
        }
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
    function spawnEnergyFloat() {
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
        el.textContent = '⁂' + GEN_AWARD;
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
    function award(n) {
        correctCount++;
        gen = Math.min(GEN_MAX, gen + GEN_AWARD);
        takeoff();
        if (open || locked) spawnEnergyFloat();
    }

    function resetGame() {
        gameOver = false;
        shields = SHIELD_MAX;
        armour = ARMOUR_MAX;
        gen = GEN_MAX;
        for (var i = 0; i < enemies.length; i++) enemies[i].el.remove();
        enemies = [];
        bullets = [];
        enemyBullets = [];
        enemyRespawnTimer = 17;
        flightState = 'grounded';
        shipEl.src = 'assets/ship.png';
        ship.x = CW / 2;
        ship.y = CH * 0.80;
        ship.vx = 0; ship.vy = 0;
        ship.worldY = CH * 0.2;
        correctCount = 0;
        sessionStart = Date.now();
        if (gameOverEl) { gameOverEl.remove(); gameOverEl = null; }
    }
    function triggerGameOver() {
        gameOver = true;
        flightState = 'grounded';
        shipEl.src = 'assets/ship.png';

        if (!open && !locked) {
            setTimeout(resetGame, 0);
            return;
        }

        gameOverEl = document.createElement('div');
        gameOverEl.id = 'idle-gameover';

        var msg = document.createElement('div');
        msg.id = 'idle-gameover-msg';
        msg.textContent = 'Ship destroyed.';
        gameOverEl.appendChild(msg);

        var btn = document.createElement('button');
        btn.id = 'idle-gameover-btn';
        btn.textContent = 'Retry?';
        btn.addEventListener('click', resetGame);
        gameOverEl.appendChild(btn);

        document.body.appendChild(gameOverEl);
    }

    function updateUI() {
        if (!spmEl) return;
        spmEl.textContent = getSPM() + '\u2009/spm';
    }

    // ── submit patch ──────────────────────────────────────────────────────────
    function patchSubmitAnswer() {
        if (typeof window.submitAnswer !== 'function') return;
        var orig = window.submitAnswer;
        window.submitAnswer = function () {
            orig.apply(this, arguments);
            var fb = document.getElementById('feedback');
            if (fb && fb.className.indexOf('correct') !== -1) {
                var path = window.location.pathname;
                var amt =
                    path.indexOf('index') !== -1 ? 0.1 :
                        path.indexOf('division') !== -1 ? 0.25 :
                            path.indexOf('addsubtract') !== -1 ? (window.idleQuestionValue || 0.3) :
                                path.indexOf('fractions') !== -1 ? 5 : 0.1;
                award(amt);
            }
        };
    }

    // ── init ──────────────────────────────────────────────────────────────────
    window.addEventListener('DOMContentLoaded', function () {
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
            }
            window.visualViewport.addEventListener('resize', updateCanvasToViewport);
            updateCanvasToViewport();
        }
        patchSubmitAnswer();
        spawnLevel();
        enemyRespawnTimer = 17;
        ship.worldY = CH * 0.2;
        updateUI();
        lastRaf = performance.now();
        requestAnimationFrame(rafLoop);

        window.addEventListener('resize', function () {
            CH = window.innerHeight;
            CW = Math.round(CH * (4 / 10));
            positionCanvas();
            if (flightState === 'grounded') {
                ship.x = CW / 2;
                ship.y = CH * 0.8;
            }
        });
    });
}());