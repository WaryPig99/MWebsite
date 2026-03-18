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

    var panelEl, toggleEl, spmEl, genBarEl, lockBtn, shipEl, enemyEl, canvasEl, ctx;

    var correctCount = 0;
    var sessionStart = Date.now();
    var open = localStorage.getItem('idle_panel_open') === '1';
    var locked = localStorage.getItem('idle_locked') === '1';

    var PANEL_W = 216;
    var CANVAS_GAP = 50;
    var SHIP_W = 48;
    var SHIP_H = 64;
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
    var gen = 0;
    var GEN_MAX = 100;
    var GEN_AWARD = 28;   // per correct answer
    var GEN_COST = 4;    // per bullet fired
    var GEN_IDLE = 0.3;  // per second passive drain (near-zero)

    // ── combat ────────────────────────────────────────────────────────────────
    var bullets = [];
    var enemy = null;
    var obstacles = [];
    var lastFireMs = 0;
    var enemyRespawnTimer = 0;

    // ── canvas positioning ────────────────────────────────────────────────────
    function positionCanvas() {
        var card = document.querySelector('.card');
        if (!card) return;
        var rect = card.getBoundingClientRect();
        cardLeft = Math.round(rect.left);
        CW = Math.round(rect.width);
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
        if (!enemyEl) return;
        if (enemy) {
            enemyEl.style.left = Math.round(cardLeft + enemy.x - SHIP_W / 2) + 'px';
            enemyEl.style.right = '';
            enemyEl.style.top = Math.round(enemy.y - SHIP_H / 2) + 'px';
            enemyEl.style.transform = 'rotate(180deg)';
            enemyEl.style.filter = enemy.flash > 0 ? 'brightness(2)' : 'none';
            enemyEl.style.display = 'block';
        } else {
            enemyEl.style.display = 'none';
        }
    }

    // ── scroll speed ──────────────────────────────────────────────────────────
    function scrollSpeed() {
        if (flightState === 'grounded') return 0;
        var spm = parseFloat(getSPM()) || 0;
        return 5 + Math.min(spm * 20, 400);
    }

    // ── level / enemy spawn ───────────────────────────────────────────────────
    function spawnEnemy() {
        enemy = {
            x: CW * 0.2 + Math.random() * CW * 0.6,
            y: -SHIP_H,
            hp: 3,
            maxHp: 3,
            vy: 70 + scrollSpeed() * 0.25,
            phase: Math.random() * Math.PI * 2,
            flash: 0,
        };
    }

    function spawnLevel() {
        // 1 or 2 obstacles in the middle zone
        obstacles = [];
        var count = Math.random() > 0.45 ? 2 : 1;
        for (var i = 0; i < count; i++) {
            obstacles.push({
                x: CW * 0.18 + Math.random() * CW * 0.64,
                y: CH * 0.30 + Math.random() * CH * 0.32,
                r: 14 + Math.random() * 13,
            });
        }
        spawnEnemy();
        bullets = [];
    }

    // ── steering — 2D vector forces ───────────────────────────────────────────
    function steer(dt) {
        if (flightState === 'grounded') return;

        var fx = 0, fy = 0;

        if (enemy) {
            var leadTime = 0.7;
            var predictedX = enemy.x + Math.sin(enemy.phase + leadTime * 0.5) * 18 * leadTime;
            fx += (predictedX - ship.x) * 18.0;
            fy += (CH * 0.75 - ship.y) * 1.8;
        } else {
            // no enemy — drift back toward lower-centre while waiting
            fx += (CW * 0.5 - ship.x) * 0.9;
            fy += (CH * 0.75 - ship.y) * 0.9;
        }

        // repel from each obstacle — forces the ship to arc around them
        for (var i = 0; i < obstacles.length; i++) {
            var o = obstacles[i];
            var odx = ship.x - o.x;
            var ody = ship.y - o.y;
            var od = Math.sqrt(odx * odx + ody * ody) || 1;
            var repR = o.r + 68;
            if (od < repR) {
                var str = ((repR - od) / repR) * 310;
                fx += (odx / od) * str;
                fy += (ody / od) * str;
            }
        }

        // canvas boundary forces
        var m = 38;
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
        if (!enemy || gen <= 0) return;
        // only fire when X-aligned with the enemy (within 36 px)
        if (Math.abs(ship.x - enemy.x) > 36) return;
        if (now - lastFireMs < 1000 / fireRate()) return;

        bullets.push({ x: ship.x, y: ship.y - SHIP_H * 0.45, vy: -385 });
        gen = Math.max(0, gen - GEN_COST);
        lastFireMs = now;
    }

    function updateCombat(now, dt) {
        if (flightState === 'grounded') return;

        // near-zero idle drain — barely visible, so sums clearly top it up
        gen = Math.max(0, gen - GEN_IDLE * dt);

        tryFire(now);

        // move bullets upward, remove when off-screen
        for (var i = bullets.length - 1; i >= 0; i--) {
            bullets[i].y += bullets[i].vy * dt;
            if (bullets[i].y < -12) bullets.splice(i, 1);
        }

        if (enemy) {
            enemy.y += enemy.vy * dt;
            enemy.phase += dt * 0.5;
            enemy.x += Math.sin(enemy.phase) * 18 * dt;
            enemy.x = Math.max(CW * 0.1, Math.min(CW * 0.9, enemy.x));
            if (enemy.flash > 0) enemy.flash -= dt;

            if (enemy.y > CH + SHIP_H) {
                enemy = null;
                enemyRespawnTimer = 1.5;
            }

            // ← ADD this guard so we don't touch enemy after nulling it above
            if (enemy) {
                for (var j = bullets.length - 1; j >= 0; j--) {
                    var dx = bullets[j].x - enemy.x;
                    var dy = bullets[j].y - enemy.y;
                    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) {
                        enemy.hp--;
                        enemy.flash = 0.14;
                        bullets.splice(j, 1);
                        if (enemy.hp <= 0) {
                            enemy = null;
                            enemyRespawnTimer = 1.5;
                            break;
                        }
                    }
                }
            }
        } else {
            enemyRespawnTimer -= dt;
            if (enemyRespawnTimer <= 0) spawnEnemy();
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
            ctx.fillRect(bullets[i].x - 1.5, bullets[i].y - 5, 3, 9);
        }

        // obstacles — lumpy hexagons
        for (var k = 0; k < obstacles.length; k++) {
            var o = obstacles[k];
            ctx.save();
            ctx.translate(o.x, o.y);
            ctx.beginPath();
            for (var s = 0; s <= 6; s++) {
                var ang = (s / 6) * Math.PI * 2;
                var r = o.r * (0.82 + 0.18 * Math.sin(s * 2.3 + 0.5));
                s === 0
                    ? ctx.moveTo(Math.cos(ang) * r, Math.sin(ang) * r)
                    : ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
            }
            ctx.closePath();
            ctx.strokeStyle = dark ? 'rgba(100,96,90,0.5)' : 'rgba(110,106,98,0.4)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();
        }

        // enemy — ship.png flipped 180° to face down toward the player
        
    }

    // ── gen bar ───────────────────────────────────────────────────────────────
    function updateGenBar() {
        if (!genBarEl) return;
        genBarEl.style.width = Math.max(0, (gen / GEN_MAX) * 100) + '%';
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
        }

        if (open) updateUI();

        requestAnimationFrame(rafLoop);
    }

    // ── styles ────────────────────────────────────────────────────────────────
    function injectStyles() {
        var s = document.createElement('style');
        s.textContent = [
            '#idle-toggle{position:fixed;bottom:1.2rem;right:1.4rem;background:none;border:none;',
            'cursor:pointer;font-size:36px;color:#d8d4ce;line-height:1;padding:4px;z-index:300;',
            'user-select:none;transition:color .25s;font-family:serif;}',
            '#idle-toggle:hover,#idle-toggle.on{color:#8a8680;}',
            '#idle-toggle.locked{font-size:28px;}',

            '#idle-panel{position:fixed;top:0;right:0;bottom:0;width:216px;',
            'background:rgba(250,249,247,0.82);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);',
            'border-left:0.5px solid #c8c4bc;transform:translateX(100%);',
            'transition:transform .26s ease;z-index:250;display:flex;flex-direction:column;',
            'padding:2.2rem 1.4rem 1.5rem;',
            'font-family:"EB Garamond","Times New Roman",serif;color:#1a1916;}',
            '#idle-panel.on{transform:translateX(0);}',

            '#idle-spm{font-size:14px;color:#aaa69e;letter-spacing:.08em;font-style:italic;',
            'min-height:16px;margin-bottom:1.8rem;}',

            '#idle-gen-label{font-size:10px;text-transform:uppercase;letter-spacing:.16em;',
            'color:#c8c4bc;margin-bottom:7px;}',
            '#idle-gen-track{width:100%;height:2px;background:#e8e4dc;overflow:hidden;}',
            '#idle-gen-bar{height:100%;width:0%;background:#1a1916;transition:width .08s linear;}',

            '#idle-lock{font-size:10px;color:#c8c4bc;background:none;',
            'border:0.5px solid #e0ddd8;border-radius:1px;padding:4px 10px;',
            'letter-spacing:.1em;text-transform:uppercase;cursor:pointer;',
            'margin-top:auto;font-family:inherit;align-self:flex-start;',
            'transition:color .15s,border-color .15s;}',
            '#idle-lock:hover,#idle-lock.on{color:#1a1916;border-color:#8a8680;}',

            '.card{background:rgba(255,255,255,0.15) !important;backdrop-filter:none;}',
            'html.dark .card{background:rgba(13,15,18,0.15) !important;}',

            '#idle-canvas{position:fixed;top:0;left:0;height:100%;z-index:1;pointer-events:none;',
            'opacity:0;transition:opacity 1.2s ease;}',
            '#idle-canvas.on{opacity:0.35;}',

            '#idle-ship{position:fixed;pointer-events:none;z-index:3;width:48px;height:auto;',
            'opacity:0;transition:opacity 1.4s ease;',
            'image-rendering:pixelated;image-rendering:crisp-edges;}',
            '#idle-ship.on{opacity:0.6;}',

            '#idle-enemy{position:fixed;pointer-events:none;z-index:2;width:48px;height:auto;',
            'opacity:0;transition:opacity 1.4s ease;',  
            'image-rendering:pixelated;image-rendering:crisp-edges;transform-origin:center center;}',
            '#idle-enemy.on{opacity:0.6;}',

            '@keyframes idle-smoke{',
            '0%  {transform:translate(0px,0px)    scale(1);   opacity:1;}',
            '20% {transform:translate(3px,-24px)  scale(1.03);opacity:1;}',
            '45% {transform:translate(-4px,-54px) scale(1.07);opacity:1;}',
            '70% {transform:translate(5px,-86px)  scale(1.11);opacity:1;}',
            '100%{transform:translate(-2px,-118px)scale(1.14);opacity:1;}',
            '}',
            '.idle-float{position:fixed;pointer-events:none;z-index:400;',
            'font-family:"EB Garamond","Times New Roman",serif;',
            'font-size:16px;letter-spacing:.06em;color:#aaa69e;transform-origin:center bottom;',
            'animation:idle-smoke 2.6s cubic-bezier(0.25,0.1,0.35,1) forwards;}',
            'html.dark .idle-float{color:#4a4d55;}',

            'html.dark #idle-panel{background:rgba(13,15,18,0.85);border-left-color:#252830;color:#c8c4bc;}',
            'html.dark #idle-toggle{color:#2e3038;}',
            'html.dark #idle-toggle:hover,html.dark #idle-toggle.on{color:#6a6660;}',
            'html.dark #idle-spm{color:#6a6660;}',
            'html.dark #idle-gen-label{color:#3d4148;}',
            'html.dark #idle-gen-track{background:#252830;}',
            'html.dark #idle-gen-bar{background:#c8c4bc;}',
            'html.dark #idle-lock{color:#3a3d45;border-color:#252830;}',
            'html.dark #idle-lock:hover,html.dark #idle-lock.on{color:#c8c4bc;border-color:#6a6660;}',
        ].join('');
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

    function buildEnemy() {
        enemyEl = document.createElement('img');
        enemyEl.id = 'idle-enemy';
        enemyEl.src = 'assets/ship.png';
        document.body.appendChild(enemyEl);
        if (open || locked) enemyEl.classList.add('on');  

    }

    function buildDOM() {
        injectStyles();
        buildCanvas();
        buildShip();
        buildEnemy();
        positionCanvas();

        ship.x = CW / 2;
        ship.y = CH * 0.95;
        ship.worldY = CH * 0.25; 
        updateShipDom();

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

    // ── visibility ────────────────────────────────────────────────────────────
    function setVisible(v) {
        canvasEl.classList.toggle('on', v);
        shipEl.classList.toggle('on', v);
        enemyEl.classList.toggle('on', v);
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
    function spawnFloat(n) {
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
        el.textContent = '+' + (n < 1 ? n.toFixed(2) : n % 1 === 0 ? n.toFixed(0) : n.toFixed(1));
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        document.body.appendChild(el);
        el.addEventListener('animationend', function () { el.remove(); });
    }

    function getSPM() {
        var mins = (Date.now() - sessionStart) / 60000;
        if (mins < 0.1) return '0.0';
        return (correctCount / mins).toFixed(1);
    }

    function takeoff() {
        if (flightState !== 'grounded') return;
        flightState = 'cruising';
    }

    function award(n) {
        correctCount++;
        gen = Math.min(GEN_MAX, gen + GEN_AWARD);
        takeoff();
        if (open || locked) spawnFloat(n);
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
        patchSubmitAnswer();
        spawnLevel();
        enemy = null;
        enemyRespawnTimer = 17;   // seconds before first enemy appears
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