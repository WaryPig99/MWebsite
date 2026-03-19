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

    var panelEl, toggleEl, spmEl, genBarEl, armourBarEl, lockBtn, shipEl, enemyEl, moneyEl, canvasEl, ctx;

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
    var gen = 0;
    var GEN_MAX = 100;
    var GEN_AWARD = 28;   // per correct answer
    var GEN_COST = 1;    // per bullet fired
    var GEN_IDLE = 0.3;  // per second passive drain (near-zero)

    //money
    var money = parseInt(localStorage.getItem('idle_money') || '0', 10);
    var MONEY_PER_KILL = 5;

    // ── WEAPONS & GENERATORS ──────────────────────────────────────────────────
    var WEAPONS = {
        vulcan:  { name: 'Vulcan',  slot: 'primary',   damage: 1, genCost: 1 },
        missile: { name: 'Missile', slot: 'secondary',  damage: 8, genCost: 6 },
    };
    var GENERATORS = {
        basicGenerator: { name: 'Basic Generator', regenRate: 0.5 },
    };

    // Weapon / generator slot state
    var primaryWeapon   = WEAPONS.vulcan;
    var secondaryWeapon = null;
    var tertiaryWeapon  = null;
    var rearWeapon      = null;
    var generatorSlot   = GENERATORS.basicGenerator;


    // ── combat ────────────────────────────────────────────────────────────────    
    var bullets = [];
    var enemy = null;
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
        if (!enemyEl) return;
        if (enemy) {
            enemyEl.style.left = Math.round(cardLeft + enemy.x - SHIP_W / 2) + 'px';
            enemyEl.style.right = '';
            enemyEl.style.top = Math.round(enemy.y - SHIP_H / 2) + 'px';
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
        return 5 + Math.min(spm * 20, 150);
    }

    // ── level / enemy spawn ───────────────────────────────────────────────────
    function spawnEnemy() {
        var w = enemyEl.naturalWidth || 16;
        var h = enemyEl.naturalHeight || 16;
        enemy = {
            x: CW * 0.2 + Math.random() * CW * 0.6,
            y: -SHIP_H,
            hp: 3,
            maxHp: 3,
            vy: 70 + scrollSpeed() * 0.25,
            phase: Math.random() * Math.PI * 2,
            flash: 0,
            hw: w * 1.5 * SCALE,   // half-width hit radius (natural px × display scale ÷ 2)
            hh: h * 1.5 * SCALE,   // half-height hit radius
        };
    }

    function spawnLevel() {
        // 1 or 2 obstacles in the middle zone
        obstacles = [];
        spawnEnemy();
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
        if (!enemy || gen <= 0) return;
        // only fire when X-aligned with the enemy (within 36 px)
        if (Math.abs(ship.x - enemy.x) > 36) return;
        if (now - lastFireMs < 1000 / fireRate()) return;

        bullets.push({ x: ship.x, y: ship.y - SHIP_H * 0.45, vy: -385 });
        gen = Math.max(0, gen - GEN_COST);
        lastFireMs = now;
    }

    function updateCombat(now, dt) {
        if (flightState === 'grounded' || flightState === 'ignition') return;

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
                    if (Math.abs(dx) < 20 * SCALE && Math.abs(dy) < 20 * SCALE) {
                        enemy.hp--;
                        enemy.flash = 0.14;
                        bullets.splice(j, 1);
                        if (enemy.hp <= 0) {
                            var streakMult = 1 + (window.streak || 0) * 0.1;
                            var earned = Math.round(MONEY_PER_KILL * streakMult);
                            money += earned;
                            localStorage.setItem('idle_money', money);
                            if (moneyEl) moneyEl.textContent = money;
                            if (open || locked) spawnKillFloat(enemy.x, enemy.y, earned);
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
            ctx.fillRect(bullets[i].x - 1.5 * SCALE, bullets[i].y - 5 * SCALE, 3 * SCALE, 9 * SCALE);
        }

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
        // All styles moved to idle.css
    }

    // ── loadout slots ─────────────────────────────────────────────────────────
    function buildLoadoutSlots(parentEl) {
        var tooltip = document.createElement('div');
        tooltip.id = 'idle-slot-tooltip';
        document.body.appendChild(tooltip);

        function showTip(anchorEl, lines) {
            tooltip.innerHTML = lines.join('<br>');
            tooltip.style.display = 'block';
            var r = anchorEl.getBoundingClientRect();
            tooltip.style.top = Math.max(4, r.top) + 'px';
            tooltip.style.left = 'auto';
            tooltip.style.right = (window.innerWidth - r.left + 6) + 'px';
        }
        function hideTip() { tooltip.style.display = 'none'; }

        function makeWeaponSlot(weapon, slotNum) {
            var el = document.createElement('div');
            el.className = 'idle-slot' + (weapon ? ' equipped' : '');
            el.textContent = weapon ? weapon.name.charAt(0) : '\u00b7';
            el.addEventListener('mouseenter', function () {
                var lines = ['Slot\u2009' + slotNum + '\u2009\u00b7\u2009' + (weapon ? weapon.name : 'Empty')];
                if (weapon) lines.push('DMG\u2009' + weapon.damage + '\u2003GEN\u2009' + weapon.genCost);
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
            weaponsCol.appendChild(makeWeaponSlot(weaponSlots[i], i + 1));
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
        enemyEl = document.createElement('img');
        enemyEl.id = 'idle-enemy';
        enemyEl.src = 'assets/enemy1.png';
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
        ship.y = CH * 0.80;
        ship.worldY = CH * 0.25; 
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

        // Set initial minimal state to match open/locked state from localStorage
        document.body.classList.toggle('idle-minimal', open || locked);
    }

    // ── visibility ────────────────────────────────────────────────────────────
    function setVisible(v) {
        canvasEl.classList.toggle('on', v);
        shipEl.classList.toggle('on', v);
        enemyEl.classList.toggle('on', v);
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
            window.visualViewport.addEventListener('scroll', updateCanvasToViewport);
            updateCanvasToViewport();
        }
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