(function () {
    'use strict';

    var ITEMS = [
        { name: 'Item 1', cost: 10, rate: 0.01 },
        { name: 'Item 2', cost: 100, rate: 0.05 },
        { name: 'Item 3', cost: 11000, rate: 0.03 },
        { name: 'Item 4', cost: 90000, rate: 0.2 },
        { name: 'Item 5', cost: 700000, rate: 1.20 },
        { name: 'Item 6', cost: 5500000, rate: 70.0 },
    ];

    var STATE_KEY = 'idle_state';
    var state = { points: 0, owned: [0, 0, 0, 0, 0, 0] };
    var lastTick = Date.now();

    // Load saved state and apply offline gains
    try {
        var raw = localStorage.getItem(STATE_KEY);
        if (raw) {
            var s = JSON.parse(raw);
            if (typeof s.points === 'number') state.points = s.points;
            if (Array.isArray(s.owned)) {
                state.owned = ITEMS.map(function (_, i) { return s.owned[i] || 0; });
            }
            if (typeof s.ts === 'number') {
                var secs = Math.max(0, Math.min((Date.now() - s.ts) / 1000, 3600));
                if (secs > 0) {
                    var offlineRate = ITEMS.reduce(function (acc, item, i) {
                        return acc + item.rate * state.owned[i];
                    }, 0);
                    state.points += offlineRate * secs;
                }
            }
        }
    } catch (e) { }

    function passiveRate() {
        return ITEMS.reduce(function (acc, item, i) {
            return acc + item.rate * state.owned[i];
        }, 0);
    }

    function save() {
        try {
            localStorage.setItem(STATE_KEY, JSON.stringify({
                points: state.points,
                owned: state.owned,
                ts: Date.now(),
            }));
        } catch (e) { }
    }

    function fmt(n) {
        n = Math.floor(n);
        if (n >= 1e9) return (n / 1e9).toFixed(2) + 'b';
        if (n >= 1e6) return (n / 1e6).toFixed(2) + 'm';
        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
        return n.toString();
    }

    function fmtRate(r) {
        if (r <= 0) return '';
        return (r < 1 ? r.toFixed(2) : r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)) + '\u2009/s';
    }

    // DOM refs
    var panelEl, toggleEl, totalEl, psEl, spmEl, rowRefs = [];

    var correctCount = 0;
    var sessionStart = Date.now();
    var open = localStorage.getItem('idle_panel_open') === '1';

    function injectStyles() {
        var s = document.createElement('style');
        s.textContent = [
            '#idle-toggle{position:fixed;bottom:1.2rem;right:1.4rem;background:none;border:none;',
            'cursor:pointer;font-size:42px;color:#d8d4ce;line-height:1;padding:4px;z-index:300;',
            'user-select:none;transition:color .25s;font-family:serif;}',
            '#idle-toggle:hover,#idle-toggle.on{color:#8a8680;}',
            '#idle-panel{position:fixed;top:0;right:0;bottom:0;width:216px;background:#faf9f7;',
            'border-left:0.5px solid #c8c4bc;transform:translateX(100%);transition:transform .26s ease;',
            'z-index:250;display:flex;flex-direction:column;',
            'padding:2.2rem 1.4rem 1.5rem;',
            'font-family:"EB Garamond","Times New Roman",serif;color:#1a1916;overflow-y:auto;}',
            '#idle-panel.on{transform:translateX(0);}',
            '#idle-total{font-family:"Libre Baskerville","Georgia",serif;font-size:28px;',
            'font-weight:700;letter-spacing:-0.5px;line-height:1;margin-bottom:0.25rem;}',
            '#idle-ps{font-size:16px;color:#aaa69e;letter-spacing:.08em;font-style:italic;',
            'margin-bottom:0.3rem;min-height:16px;}',
            '#idle-spm{font-size:14px;color:#aaa69e;letter-spacing:.08em;font-style:italic;',
            'margin-bottom:1.4rem;min-height:16px;}',
            'html.dark #idle-spm{color:#3a3d45;}',
            '.idle-hr{border:none;border-top:0.5px solid #e0ddd8;margin:0 0 0.8rem;}',
            '.idle-row{display:flex;align-items:baseline;padding:5px 0;',
            'border-bottom:0.5px solid #eeecea;cursor:pointer;position:relative;user-select:none;}',
            '.idle-name{font-size:13px;letter-spacing:.03em;flex:1;}',
            '.idle-owned{font-size:12px;min-width:24px;text-align:center;color:#aaa69e;}',
            '.idle-rc{font-size:11px;min-width:48px;text-align:right;color:#c8c4bc;',
            'letter-spacing:.03em;transition:color .15s;}',
            '.idle-row:hover .idle-rc{color:#8a8680;}',
            '.idle-rc.can{color:#1a1916 !important;}',
            'html.dark #idle-panel{background:#0d0f12;border-left-color:#252830;color:#c8c4bc;}',
            'html.dark #idle-toggle{color:#2e3038;}',
            'html.dark #idle-toggle:hover,html.dark #idle-toggle.on{color:#6a6660;}',
            'html.dark #idle-total{color:#faf9f7;}',
            'html.dark #idle-ps{color:#3a3d45;}',
            'html.dark .idle-hr{border-top-color:#252830;}',
            'html.dark .idle-row{border-bottom-color:#15181e;}',
            'html.dark .idle-name{color:#c8c4bc;}',
            'html.dark .idle-owned{color:#4a4d55;}',
            'html.dark .idle-rc{color:#2e3038;}',
            'html.dark .idle-row:hover .idle-rc{color:#6a6660;}',
            'html.dark .idle-rc.can{color:#c8c4bc !important;}',
            '#idle-reset{font-size:11px;color:#aaa69e;background:none;border:none;',
            'letter-spacing:.08em;text-transform:uppercase;cursor:pointer;',
            'margin-top:auto;padding-top:1.5rem;font-family:inherit;text-align:left;}',
            '#idle-reset:hover{color:#1a1916;}',
            'html.dark #idle-reset{color:#3a3d45;}',
            'html.dark #idle-reset:hover{color:#c8c4bc;}',
            '@keyframes idle-smoke{',
            '0%  {transform:translate(0px, 0px)    scale(1);    opacity:1;}',
            '20% {transform:translate(3px,-24px)   scale(1.03); opacity:1;}',
            '45% {transform:translate(-4px,-54px)  scale(1.07); opacity:1;}',
            '70% {transform:translate(5px,-86px)   scale(1.11); opacity:1;}',
            '100%{transform:translate(-2px,-118px) scale(1.14); opacity:1;}',
            '}',
            '.idle-float{position:fixed;pointer-events:none;z-index:400;',
            'font-family:"EB Garamond","Times New Roman",serif;',
            'font-size:16px;letter-spacing:.06em;color:#aaa69e;',
            'transform-origin:center bottom;',
            'animation:idle-smoke 2.6s cubic-bezier(0.25,0.1,0.35,1) forwards;}',
            'html.dark .idle-float{color:#4a4d55;}',
        ].join('');
        document.head.appendChild(s);
    }

    function buildDOM() {
        injectStyles();

        toggleEl = document.createElement('button');
        toggleEl.id = 'idle-toggle';
        toggleEl.textContent = '\u25e6'; // ◦
        toggleEl.setAttribute('aria-label', 'idle');
        toggleEl.addEventListener('click', togglePanel);
        document.body.appendChild(toggleEl);

        panelEl = document.createElement('div');
        panelEl.id = 'idle-panel';

        totalEl = document.createElement('div');
        totalEl.id = 'idle-total';
        panelEl.appendChild(totalEl);

        psEl = document.createElement('div');
        psEl.id = 'idle-ps';
        panelEl.appendChild(psEl);

        spmEl = document.createElement('div');
        spmEl.id = 'idle-spm';
        panelEl.appendChild(spmEl);

        var hr = document.createElement('hr');
        hr.className = 'idle-hr';
        panelEl.appendChild(hr);

        rowRefs = ITEMS.map(function (item, i) {
            var row = document.createElement('div');
            row.className = 'idle-row';

            var nameEl = document.createElement('span');
            nameEl.className = 'idle-name';
            nameEl.textContent = item.name;

            var ownedEl = document.createElement('span');
            ownedEl.className = 'idle-owned';
            ownedEl.textContent = '0';

            // Right column: shows rate normally, cost on hover or when affordable
            var rcEl = document.createElement('span');
            rcEl.className = 'idle-rc';

            var rateStr = fmtRate(item.rate);
            var costStr = fmt(item.cost);
            rcEl.textContent = rateStr;

            row.addEventListener('mouseenter', function () {
                rcEl.textContent = costStr;
            });
            row.addEventListener('mouseleave', function () {
                if (!rcEl.classList.contains('can')) rcEl.textContent = rateStr;
            });
            row.addEventListener('click', function () { buy(i); });

            row.appendChild(nameEl);
            row.appendChild(ownedEl);
            row.appendChild(rcEl);
            panelEl.appendChild(row);

            return { ownedEl: ownedEl, rcEl: rcEl, rateStr: rateStr, costStr: costStr };
        });

        var resetBtn = document.createElement('button');
        resetBtn.id = 'idle-reset';
        resetBtn.textContent = 'Reset progress';
        resetBtn.addEventListener('click', function () {
            if (!confirm('Reset all progress?')) return;
            state.points = 0;
            state.owned = ITEMS.map(function () { return 0; });
            save();
            updateUI();
        });
        panelEl.appendChild(resetBtn);

        document.body.appendChild(panelEl);

        // Restore open state
        panelEl.classList.toggle('on', open);
        toggleEl.classList.toggle('on', open);
    }

    function togglePanel() {
        open = !open;
        panelEl.classList.toggle('on', open);
        toggleEl.classList.toggle('on', open);
        if (open) updateUI();
        localStorage.setItem('idle_panel_open', open ? '1' : '0');

    }

    function buy(i) {
        if (state.points < ITEMS[i].cost) return;
        state.points -= ITEMS[i].cost;
        state.owned[i] = (state.owned[i] || 0) + 1;
        save();
        updateUI();
    }

    function spawnFloat(n) {
        var q = document.getElementById('question');
        var x, y;
        if (q) {
            var r = q.getBoundingClientRect();
            x = r.left + r.width / 2 - 20;
            y = r.top + r.height * 0;
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
        if (mins < 0.1) return 0;
        return (correctCount / mins).toFixed(1);
    }

    function award(n) {
        state.points += n;
        correctCount++;
        if (open) spawnFloat(n);
    }

    function updateUI() {
        if (!totalEl) return;
        totalEl.textContent = fmt(state.points);
        var rate = passiveRate();
        psEl.textContent = rate > 0 ? fmtRate(rate) : '';
        spmEl.textContent = correctCount > 0 ? getSPM() + ' /spm' : '';

        rowRefs.forEach(function (ref, i) {
            ref.ownedEl.textContent = state.owned[i] || 0;
            var can = state.points >= ITEMS[i].cost;
            ref.rcEl.classList.toggle('can', can);
            // If not hovered and affordable, show cost
            if (can) ref.rcEl.textContent = ref.costStr;
        });
    }

    // Game tick — passive income
    function tick() {
        var now = Date.now();
        var dt = (now - lastTick) / 1000;
        lastTick = now;
        var rate = passiveRate();
        if (rate > 0) state.points += rate * dt;
        if (open) updateUI();
        requestAnimationFrame(tick);
    }

    // Wrap submitAnswer to detect correct answers
    function patchSubmitAnswer() {
        if (typeof window.submitAnswer !== 'function') return;
        var orig = window.submitAnswer;
        window.submitAnswer = function () {
            orig.apply(this, arguments);
            var fb = document.getElementById('feedback');
            if (fb && fb.className.indexOf('correct') !== -1) {
                var path = window.location.pathname;
                var award_amount =
                    path.indexOf('index') !== -1 ? 0.1 :
                        path.indexOf('division') !== -1 ? 0.25 :
                            path.indexOf('addsubtract') !== -1 ? (window.idleQuestionValue || 0.3) :
                                path.indexOf('fractions') !== -1 ? 5 :
                                    0.1;

                award(award_amount);
                save();
            }
        };
    }

    window.addEventListener('DOMContentLoaded', function () {
        buildDOM();
        patchSubmitAnswer();
        updateUI();
        lastTick = Date.now();
        requestAnimationFrame(tick);
        setInterval(save, 15000);
    });

    window.addEventListener('beforeunload', save);

}());