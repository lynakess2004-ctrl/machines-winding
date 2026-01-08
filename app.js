// ========= Globals =========
let animRunning = false;
let animIndex   = 0;
let animTimer   = null;

const colors = {
    A_pos: '#fc2424ff',
    A_neg: '#ad5858ff',
    B_pos: '#11c4b8ff',
    B_neg: '#5d9996ff',
    C_pos: '#ebcb2fff',
    C_neg: '#ddce7cff'
};


let currentWinding = null;
let coils = []; // list of coils in series-connected order
let activePhaseFilter = 'ALL';   // 'ALL' | 'A' | 'B' | 'C'
let activeLayerFilter = 'BOTH';  // 'BOTH' | 'TOP' | 'BOTTOM'
let lastComboLabel = '';

// first A/B/C with sign from layout
function getPhasePatternSignature(winding) {
    const seen = new Set();
    const pattern = [];
    for (let i = 0; i < winding.length; i++) {
        const top = winding[i].top;
        if (!top) continue;
        if (!seen.has(top.phase)) {
            const signSymbol = top.polarity === 'pos' ? '+' : '−';
            pattern.push(top.phase + signSymbol);
            seen.add(top.phase);
        }
        if (pattern.length === 3) break;
    }
    return pattern.length ? pattern.join('  ') : '—';
}

// ========= Navigation & tabs =========

function showPage(pageName, btn) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(pageName).classList.add('active');
    if (btn) btn.classList.add('active');
}

function updatePitchInput() {
    const pitchType = document.getElementById('pitchType').value;
    const pitchGroup = document.getElementById('pitchInputGroup');
    pitchGroup.style.display = pitchType === 'short' ? 'block' : 'none';
}

function showDiagram(type, btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.diagram-content').forEach(d => d.classList.remove('active'));
    document.getElementById(type + 'Diagram').classList.add('active');
    if (btn) btn.classList.add('active');
}

// ========= Filters =========

function setPhaseFilter(phase) {
    activePhaseFilter = phase;
    if (currentWinding) {
        const Z = currentWinding.length;
        drawLinearDiagram(currentWinding, Z);
        drawCircularDiagram(currentWinding, Z);
    }
}

function setLayerFilter(layer) {
    activeLayerFilter = layer;
    if (currentWinding) {
        const Z = currentWinding.length;
        drawLinearDiagram(currentWinding, Z);
        drawCircularDiagram(currentWinding, Z);
    }
}

// ========= Core calculations =========

function gcd(a, b) {
    return b === 0 ? a : gcd(b, a % b);
}

function calculate() {
    try {
        // ---- inputs ----
        const Z  = parseInt(document.getElementById('slots').value, 10);
        const p2 = parseInt(document.getElementById('poles').value, 10);
        const m  = parseInt(document.getElementById('phases').value, 10);
        const pitchTypeSel = document.getElementById('pitchType').value;

        // ---- validation ----
        if (!Z || !p2 || !m || Z < 6 || p2 < 2 || m < 3) {
            throw new Error('Please enter valid values (Z≥6, 2p≥2, m≥3)');
        }
        if (p2 % 2 !== 0) {
            throw new Error('Number of poles must be even');
        }

        // ---- basic quantities ----
        const p   = p2 / 2;
        const tau = Z / p2;          // pole pitch (slots)

        // ---- coil pitch y from offset ----
        let y;
        const tauBase = Math.round(tau);   // nearest integer pole pitch

        if (pitchTypeSel === 'short') {
            // user enters offset in slots: 0 = full pitch, 1 = τ−1, ...
            const offsetInput = parseInt(
                document.getElementById('coilOffset').value,
                10
            );

            // default to 1 slot short-pitch if invalid
            const offset = Number.isInteger(offsetInput) &&
                           offsetInput >= 1 &&
                           offsetInput < tauBase
                ? offsetInput
                : 1;

            y = tauBase - offset;    // short-pitch: y = τ − offset
        } else {
            // full-pitch: y ≈ τ
            y = tauBase;
        }

        const q     = Z / (p2 * m);  // slots per pole per phase
        const alpha = (360 * p) / Z; // electrical angle between slots (deg)
        const beta  = y / tau;       // pitch ratio

        // ---- winding factors ----
        const Kp = Math.sin((beta * Math.PI) / 2);

        let Kd;
        if (Number.isInteger(q)) {
            const alphaRad = (alpha * Math.PI) / 180;
            Kd = Math.sin((q * alphaRad) / 2) / (q * Math.sin(alphaRad / 2));
        } else {
            const num      = gcd(Z, p2);
            const t        = Z / num;
            const alphaRad = (alpha * Math.PI) / 180;
            Kd = Math.sin((t * alphaRad) / 2) / (t * Math.sin(alphaRad / 2));
        }

        const Kw = Kp * Kd;

        // ---- generate winding & coils (series‑connected) ----
        const { slots, coilList } = generateWindingScheme(Z, p2, m, y, tau);
        currentWinding = slots;
        coils          = coilList;

        // ---- statistics from layout ----
        const phaseCoilCount  = { A: 0, B: 0, C: 0 };
        const topLayerUsed    = new Set();
        const bottomLayerUsed = new Set();

        slots.forEach((slot, idx) => {
            if (slot.top) {
                phaseCoilCount[slot.top.phase] =
                    (phaseCoilCount[slot.top.phase] || 0) + 1;
                topLayerUsed.add(idx);
            }
            if (slot.bottom) bottomLayerUsed.add(idx);
        });

        const allSlotsUsedTop    = topLayerUsed.size === Z;
        const allSlotsUsedBottom = bottomLayerUsed.size === Z;
        const actualQ            = phaseCoilCount.A / (p2 / 2);

        // ---- UI updates ----
        displayResults(
            Z, p2, m,
            tau, y, q, alpha, beta,
            Kp, Kd, Kw,
            slots,
            actualQ,
            phaseCoilCount,
            allSlotsUsedTop,
            allSlotsUsedBottom
        );

        createLegend('legendLinear');
        createLegend('legendCircular');
        drawLinearDiagram(slots, Z);
        drawCircularDiagram(slots, Z);
        createWindingTable(slots);

        document.getElementById('errorAlert').classList.remove('active');
        document.getElementById('results').style.display = 'block';

        resizeCanvases();

    } catch (error) {
        document.getElementById('errorAlert').textContent = error.message;
        document.getElementById('errorAlert').classList.add('active');
        document.getElementById('results').style.display = 'none';
    }
}

function redrawWithAnimation() {
    if (!currentWinding || !coils.length) return;
    const Z = currentWinding.length;

    // clone coils array up to animIndex
    const visibleCoils = coils.slice(0, animIndex);

    // temporarily replace global coils when drawing
    const saved = coils;
    coils = visibleCoils;
    drawLinearDiagram(currentWinding, Z);
    drawCircularDiagram(currentWinding, Z);
    coils = saved;
}
function stepAnimation() {
    if (!currentWinding || !coils.length) return;
    if (animIndex < coils.length) {
        animIndex++;
        redrawWithAnimation();
    } else {
        animRunning = false;
        clearInterval(animTimer);
        animTimer = null;
    }
}

function startWindingAnimation() {
    if (!currentWinding || !coils.length) return;
    if (animRunning) return;
    animRunning = true;

    const speedSlider = document.getElementById('animSpeed');
    const speedFactor = speedSlider ? parseFloat(speedSlider.value) : 1;
    const baseInterval = 700; // ms per coil at speed 1
    const interval = baseInterval / speedFactor;

    stepAnimation(); // draw first/next immediately
    animTimer = setInterval(stepAnimation, interval);
}

function pauseWindingAnimation() {
    animRunning = false;
    if (animTimer) {
        clearInterval(animTimer);
        animTimer = null;
    }
}

function resetWindingAnimation() {
    pauseWindingAnimation();
    animIndex = 0;
    // redraw with no coils or with full winding, your choice:
    redrawWithAnimation(); // shows slots only
    // or: drawLinearDiagram(currentWinding, currentWinding.length);
    //     drawCircularDiagram(currentWinding, currentWinding.length);
}

// ========= Winding generation with SERIES CONNECTION =========

function generateWindingScheme(Z, p2, m, y, tau) {
    const slots = [];
    for (let i = 0; i < Z; i++) {
        slots.push({
            slot: i + 1,
            top: null,
            bottom: null
        });
    }

    const q = Z / (m * p2);
    const isIntegerQ = Number.isInteger(q);
    const phaseSequence = ['A', 'B', 'C'];
    const coilList = [];

    if (isIntegerQ && m === 3) {
        // ===== Integer-slot, 3-phase =====
        const alpha = (360 * (p2 / 2)) / Z;
        const deltaSlots = Math.round(120 / alpha);

        const startA = 0;
        const startB = (startA + deltaSlots) % Z;
        const startC = (startA + 2 * deltaSlots) % Z;

        const phaseStartSlots = { A: startA, B: startB, C: startC };
        const coilsPerPhasePerPole = q;
        const polePitchSlots = Z / p2;

        let coilId = 1;

        for (const phase of phaseSequence) {
            for (let pole = 0; pole < p2; pole++) {
                const localCoils = [];
                const baseStart = phaseStartSlots[phase];

                // build coils for this phase & pole
                for (let c = 0; c < coilsPerPhasePerPole; c++) {
                    const slotIndex =
                        (baseStart +
                         Math.round(pole * polePitchSlots) +
                         c) % Z;

                    const endSlotIndex = (slotIndex + y) % Z;

                    localCoils.push({
                        id: coilId++,
                        phase,
                        pole: Math.floor(pole / 2) + 1,
                        startSlot: slotIndex + 1,
                        endSlot: endSlotIndex + 1,
                        polarity: pole % 2 === 0 ? 'pos' : 'neg',
                        nextCoil: null
                    });
                }

                // order around stator and link in series
                localCoils.sort((c1, c2) => c1.startSlot - c2.startSlot);
                for (let i = 0; i < localCoils.length - 1; i++) {
                    localCoils[i].nextCoil = localCoils[i + 1].id;
                }

                // write into slots and push to global list
                localCoils.forEach(coil => {
                    const startIdx = (coil.startSlot - 1 + Z) % Z;
                    const endIdx   = (coil.endSlot   - 1 + Z) % Z;

                    // top side
                    slots[startIdx].top = {
                        phase: coil.phase,
                        polarity: coil.polarity,
                        pole: coil.pole,
                        coilEnd: coil.endSlot,
                        coilId: coil.id,
                        layer: 'top'
                    };

                    // bottom side (return)
                    slots[endIdx].bottom = {
                        phase: coil.phase,
                        polarity: coil.polarity === 'pos' ? 'neg' : 'pos',
                        pole: coil.pole,
                        coilStart: coil.startSlot,
                        coilId: coil.id,
                        layer: 'bottom'
                    };

                    coilList.push(coil);
                });
            }
        }
    } else {
        // ===== Fractional-slot (general) =====
        const qCeil  = Math.ceil(q);
        const qFloor = Math.floor(q);
        let slotIndex = 0;
        let coilId = 1;
        const phases = ['A', 'B', 'C'];

        for (let pole = 0; pole < p2; pole++) {
            for (const phase of phases) {
                const nCoils = phase === 'C' ? qFloor : qCeil;
                const localCoils = [];

                // build coils
                for (let s = 0; s < nCoils && slotIndex < Z; s++) {
                    const startIdx = slotIndex;
                    const endIdx   = (startIdx + y) % Z;

                    localCoils.push({
                        id: coilId++,
                        phase,
                        pole: Math.floor(pole / 2) + 1,
                        startSlot: startIdx + 1,
                        endSlot: endIdx + 1,
                        polarity: pole % 2 === 0 ? 'pos' : 'neg',
                        nextCoil: null
                    });

                    slotIndex++;
                }

                // order and link series
                localCoils.sort((c1, c2) => c1.startSlot - c2.startSlot);
                for (let i = 0; i < localCoils.length - 1; i++) {
                    localCoils[i].nextCoil = localCoils[i + 1].id;
                }

                // write into slots and push to global list
                localCoils.forEach(coil => {
                    const startIdx = (coil.startSlot - 1 + Z) % Z;
                    const endIdx   = (coil.endSlot   - 1 + Z) % Z;

                    slots[startIdx].top = {
                        phase: coil.phase,
                        polarity: coil.polarity,
                        pole: coil.pole,
                        coilEnd: coil.endSlot,
                        coilId: coil.id,
                        layer: 'top'
                    };

                    slots[endIdx].bottom = {
                        phase: coil.phase,
                        polarity: coil.polarity === 'pos' ? 'neg' : 'pos',
                        pole: coil.pole,
                        coilStart: coil.startSlot,
                        coilId: coil.id,
                        layer: 'bottom'
                    };

                    coilList.push(coil);
                });
            }
        }
    }

    return { slots, coilList };
}

// ========= Results & legend =========

function displayResults(
    Z, p2, m, tau, y, q, alpha, beta,
    Kp, Kd, Kw,
    winding,
    actualQ,
    phaseCoilCount,
    allSlotsUsedTop,
    allSlotsUsedBottom
) {
    const resultsGrid = document.getElementById('resultsGrid');

    const qIsInteger = Number.isInteger(q);
    const qType      = qIsInteger ? 'Integer-slot' : 'Fractional-slot';

    let pitchType, pitchInfo;
    if (Number.isInteger(tau)) {
        pitchType = y === tau ? 'Full-pitch' : 'Short-pitch';
        pitchInfo = y === tau ? 'y = τ' : `y = τ - ${tau - y}`;
    } else {
        if (y === Math.ceil(tau)) {
            pitchType = 'Full-pitch';
            pitchInfo = `y = ceil(${tau.toFixed(2)}) = ${y}`;
        } else {
            pitchType = 'Short-pitch';
            pitchInfo = `y = floor(${tau.toFixed(2)}) or less = ${y}`;
        }
    }

    const comboLabel = `${qIsInteger ? 'Integer-slot' : 'Fractional-slot'}, ${pitchType}`;
    lastComboLabel = comboLabel;

    const phasePatternSignature = getPhasePatternSignature(winding);
    let phaseDistributionLabel, phaseDistributionDetail;

    if (m === 3) {
        phaseDistributionLabel = phasePatternSignature;
        phaseDistributionDetail = qIsInteger
            ? 'Example slot pattern · 3‑phase · ≈120° separation'
            : 'Example slot pattern · 3‑phase fractional q';
    } else {
        phaseDistributionLabel = `${m}-phase`;
        phaseDistributionDetail = 'General multi‑phase distribution';
    }

    const actualQText = isFinite(actualQ) ? actualQ.toFixed(3) : '—';

    resultsGrid.innerHTML = `
        <div class="result-card">
            <h4>Slots per Pole per Phase (q) <button class="info-icon" onclick="showInfo('q')">i</button></h4>
            <div class="value">${q.toFixed(3)}</div>
            <small style="opacity:0.9;font-size:12px;">Theoretical q · ${qType}</small>
        </div>
        <div class="result-card">
            <h4>Effective q from Layout <button class="info-icon" onclick="showInfo('actualq')">i</button></h4>
            <div class="value">${actualQText}</div>
            <small style="opacity:0.9;font-size:12px;">From winding (A-phase coils / poles)</small>
        </div>
        <div class="result-card">
            <h4>Pole Pitch (τ) <button class="info-icon" onclick="showInfo('tau')">i</button></h4>
            <div class="value">${tau.toFixed(3)}</div>
            <small style="opacity:0.9;font-size:12px;">${Number.isInteger(tau) ? 'Integer' : 'Fractional'} slots</small>
        </div>
        <div class="result-card">
            <h4>Coil Pitch (y) <button class="info-icon" onclick="showInfo('y')">i</button></h4>
            <div class="value">${y}</div>
            <small style="opacity:0.9;font-size:12px;">${pitchInfo}</small>
        </div>
        <div class="result-card">
            <h4>Winding Type <button class="info-icon" onclick="showInfo('combo')">i</button></h4>
            <div class="value" style="font-size:18px;">${comboLabel}</div>
            <small style="opacity:0.9;font-size:12px;">q: ${qType} · Pitch: ${pitchType}</small>
        </div>
        <div class="result-card">
            <h4>Phase Distribution <button class="info-icon" onclick="showInfo('alpha')">i</button></h4>
            <div class="value">${phaseDistributionLabel}</div>
            <small style="opacity:0.9;font-size:12px;">${phaseDistributionDetail}</small>
        </div>
        <div class="result-card">
            <h4>Coils per Phase <button class="info-icon" onclick="showInfo('coils')">i</button></h4>
            <div class="value">${phaseCoilCount.A}</div>
            <small style="opacity:0.9;font-size:12px;">
                A:${phaseCoilCount.A} · B:${phaseCoilCount.B} · C:${phaseCoilCount.C}
            </small>
        </div>
        <div class="result-card">
            <h4>Winding Verification <button class="info-icon" onclick="showInfo('verify')">i</button></h4>
            <div class="value">${allSlotsUsedTop && allSlotsUsedBottom ? '✓' : '✗'}</div>
            <small style="opacity:0.9;font-size:12px;">
                ${allSlotsUsedTop && allSlotsUsedBottom ? 'All slots filled (top & bottom)' : 'Check configuration'}
            </small>
        </div>
        <div class="result-card">
            <h4>Pitch Factor (Kp) <button class="info-icon" onclick="showInfo('kp')">i</button></h4>
            <div class="value">${Kp.toFixed(4)}</div>
        </div>
        <div class="result-card">
            <h4>Distribution Factor (Kd) <button class="info-icon" onclick="showInfo('kd')">i</button></h4>
            <div class="value">${Kd.toFixed(4)}</div>
        </div>
        <div class="result-card">
            <h4>Winding Factor (Kw) <button class="info-icon" onclick="showInfo('kw')">i</button></h4>
            <div class="value">${Kw.toFixed(4)}</div>
        </div>
    `;
}

function createLegend(elementId) {
    const legend = document.getElementById(elementId);
    legend.innerHTML = `
        <div class="legend-item">
            <div class="legend-color" style="background:${colors.A_pos}"></div>
            <span>Phase A (+)</span>
        </div>
        <div class="legend-item">
            <div class="legend-color" style="background:${colors.A_neg}"></div>
            <span>Phase A (−)</span>
        </div>
        <div class="legend-item">
            <div class="legend-color" style="background:${colors.B_pos}"></div>
            <span>Phase B (+)</span>
        </div>
        <div class="legend-item">
            <div class="legend-color" style="background:${colors.B_neg}"></div>
            <span>Phase B (−)</span>
        </div>
        <div class="legend-item">
            <div class="legend-color" style="background:${colors.C_pos}"></div>
            <span>Phase C (+)</span>
        </div>
        <div class="legend-item">
            <div class="legend-color" style="background:${colors.C_neg}"></div>
            <span>Phase C (−)</span>
        </div>
    `;
}

// ========= Linear diagram =========

function drawLinearDiagram(winding, Z) {
    const canvas = document.getElementById('linearCanvas');
    const ctx = canvas.getContext('2d');

    canvas.width  = Math.max(1400, Z * 60);
    canvas.height = 460;

    const slotWidth  = canvas.width / Z;
    const slotHeight = 45;
    const startY     = 190;
    const topEdgeY   = startY;
    const botEdgeY   = startY + slotHeight * 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#1e3a8a';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('Double Layer Winding - Linear Hairpin Diagram', 20, 30);

    // draw slots
    winding.forEach((slot, i) => {
        const x = i * slotWidth;

        ctx.fillStyle = '#f9fafb';
        ctx.fillRect(x + 4, startY, slotWidth - 8, slotHeight * 2);

        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 4, startY, slotWidth - 8, slotHeight * 2);

        ctx.strokeStyle = '#999';
        ctx.beginPath();
        ctx.moveTo(x + 4, startY + slotHeight);
        ctx.lineTo(x + slotWidth - 4, startY + slotHeight);
        ctx.stroke();

        ctx.fillStyle = '#1e3a8a';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(String(slot.slot), x + slotWidth / 2, startY - 8);

        // top
        if (slot.top && activeLayerFilter !== 'BOTTOM') {
            if (activePhaseFilter === 'ALL' || slot.top.phase === activePhaseFilter) {
                const color = colors[`${slot.top.phase}_${slot.top.polarity}`];
                ctx.fillStyle = color;
                ctx.fillRect(x + 6, startY + 3, slotWidth - 12, slotHeight - 6);

                ctx.strokeStyle = '#222';
                ctx.lineWidth = 1;
                ctx.strokeRect(x + 6, startY + 3, slotWidth - 12, slotHeight - 6);

                ctx.fillStyle = 'white';
                ctx.font = 'bold 13px Arial';
                const signTop = slot.top.polarity === 'pos' ? '+' : '−';
                ctx.fillText(
                    `${slot.top.phase}${signTop}`,
                    x + slotWidth / 2,
                    startY + slotHeight / 2 + 4
                );
            }
        }

        // bottom
        if (slot.bottom && activeLayerFilter !== 'TOP') {
            if (activePhaseFilter === 'ALL' || slot.bottom.phase === activePhaseFilter) {
                const color = colors[`${slot.bottom.phase}_${slot.bottom.polarity}`];
                ctx.fillStyle = color;
                ctx.fillRect(
                    x + 6,
                    startY + slotHeight + 3,
                    slotWidth - 12,
                    slotHeight - 6
                );

                ctx.strokeStyle = '#222';
                ctx.lineWidth = 1;
                ctx.strokeRect(
                    x + 6,
                    startY + slotHeight + 3,
                    slotWidth - 12,
                    slotHeight - 6
                );

                ctx.fillStyle = 'white';
                ctx.font = 'bold 13px Arial';
                const signBot = slot.bottom.polarity === 'pos' ? '+' : '−';
                ctx.fillText(
                    `${slot.bottom.phase}${signBot}`,
                    x + slotWidth / 2,
                    startY + slotHeight + slotHeight / 2 + 4
                );
            }
        }
    });

    // coils: follow top-side to bottom-side, show series continuity using coil ids
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.9;
    ctx.textAlign = 'center';
    ctx.font = '10px Arial';

    const topHairpinHeight = 60;
    const bottomHairpinHeight = 60;

    let topCoilIndex = 1;
    let bottomCoilIndex = 1;

    // top-start hairpins
    if (activeLayerFilter !== 'BOTTOM') {
        coils.forEach(coil => {
            const startIndex = (coil.startSlot - 1 + Z) % Z;
            const endIndex   = (coil.endSlot   - 1 + Z) % Z;

            if (activePhaseFilter !== 'ALL' && coil.phase !== activePhaseFilter) return;

            const x1 = startIndex * slotWidth + slotWidth / 2;
            const x2 = endIndex   * slotWidth + slotWidth / 2;

            const color = colors[`${coil.phase}_${coil.polarity}`];
            ctx.strokeStyle = color;

            const offset = ((topCoilIndex - 1) % 3) * 8;
            const midY   = topEdgeY - topHairpinHeight - offset;

            ctx.beginPath();
            ctx.moveTo(x1, topEdgeY);
            ctx.lineTo(x1, midY);
            ctx.lineTo(x2, midY);
            ctx.lineTo(x2, botEdgeY);
            ctx.stroke();

            ctx.fillStyle = color;
            ctx.fillText(`C${coil.id}`, (x1 + x2) / 2, midY - 4);

            topCoilIndex++;
        });
    }

    // bottom-start hairpins (return path)
    if (activeLayerFilter !== 'TOP') {
        coils.forEach(coil => {
            const startIndex = (coil.startSlot - 1 + Z) % Z;
            const endIndex   = (coil.endSlot   - 1 + Z) % Z;

            if (activePhaseFilter !== 'ALL' && coil.phase !== activePhaseFilter) return;

            const x1 = startIndex * slotWidth + slotWidth / 2;
            const x2 = endIndex   * slotWidth + slotWidth / 2;

            const color = colors[`${coil.phase}_${coil.polarity === 'pos' ? 'neg' : 'pos'}`];
            ctx.strokeStyle = color;

            const offset = ((bottomCoilIndex - 1) % 3) * 8;
            const midY   = botEdgeY + bottomHairpinHeight + offset;

            ctx.beginPath();
            ctx.moveTo(x1, botEdgeY);
            ctx.lineTo(x1, midY);
            ctx.lineTo(x2, midY);
            ctx.lineTo(x2, topEdgeY);
            ctx.stroke();

            ctx.fillStyle = color;
            ctx.fillText(`C${coil.id}`, (x1 + x2) / 2, midY + 12);

            bottomCoilIndex++;
        });
    }

    ctx.globalAlpha = 1;

    const legendY = canvas.height - 40;
    ctx.fillStyle = '#333';
    ctx.font = '11px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('C# = coil in series chain (top → bottom)', 20, legendY);
    ctx.fillText(
        '+ / − = current direction in that coil side · use filters to isolate phases/layers',
        20,
        legendY + 14
    );
}
function drawSeriesChains(ctx, cx, cy, slotAngle, rChordTop, rChordBot, Z) {
    const visited = new Set();

    coils.forEach(coil => {
        if (visited.has(coil.id)) return;
        if (activePhaseFilter !== 'ALL' && coil.phase !== activePhaseFilter) return;

        const chain = [];
        let cur = coil;
        while (cur && !visited.has(cur.id)) {
            chain.push(cur);
            visited.add(cur.id);
            cur = coils.find(c => c.id === cur.nextCoil);
        }

        // draw even if chain.length === 1
        if (chain.length === 0) return;

        // TOP chain
        if (activeLayerFilter !== 'BOTTOM') {
            const colorTop = colors[`${coil.phase}_${coil.polarity}`];
            ctx.strokeStyle = colorTop;
            ctx.setLineDash([]);
            ctx.beginPath();
            chain.forEach((c, idx) => {
                const idxSlot = (c.startSlot - 1 + Z) % Z;
                const a = -Math.PI / 2 + (idxSlot + 0.5) * slotAngle;
                const x = cx + rChordTop * Math.cos(a);
                const y = cy + rChordTop * Math.sin(a);
                if (idx === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();
        }

        // BOTTOM chain
        if (activeLayerFilter !== 'TOP') {
            const colorBot = colors[`${coil.phase}_${coil.polarity === 'pos' ? 'neg' : 'pos'}`];
            ctx.strokeStyle = colorBot;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            chain.forEach((c, idx) => {
                const idxSlot = (c.endSlot - 1 + Z) % Z;
                const a = -Math.PI / 2 + (idxSlot + 0.5) * slotAngle;
                const x = cx + rChordBot * Math.cos(a);
                const y = cy + rChordBot * Math.sin(a);
                if (idx === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();
        }
    });

    ctx.setLineDash([]);
}

// ========= Circular diagram with full series chains =========

/// ========= Circular diagram with clear 2‑layer webs + series chain =========

function drawCircularDiagram(winding, Z) {
    const canvas = document.getElementById('circularCanvas');
    const ctx = canvas.getContext('2d');

    const size = 600;
    canvas.width  = size;
    canvas.height = size;

    const cx = size / 2;
    const cy = size / 2;

    // slot rings (same as original)
    const rOuterTop = 250;
    const rInnerTop = 220;
    const rOuterBot = 210;
    const rInnerBot = 180;

    // chord radii
    const rTopChord = (rOuterTop + rInnerTop) / 2;
    const rBotChord = (rOuterBot + rInnerBot) / 2;

    ctx.clearRect(0, 0, size, size);
    const slotAngle = (2 * Math.PI) / Z;

    // ---------- title ----------
    ctx.fillStyle = '#1e3a8a';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Double Layer Winding - Circular Diagram', cx, 30);

    // ---------- slot sectors ----------
    for (let i = 0; i < Z; i++) {
        const slot = winding[i];
        const a0 = -Math.PI / 2 + i * slotAngle;
        const a1 = a0 + slotAngle;
        const am = (a0 + a1) / 2;

        // TOP ring
        if (activeLayerFilter !== 'BOTTOM') {
            let colorTop = '#e5e7eb';
            if (slot.top &&
                (activePhaseFilter === 'ALL' || slot.top.phase === activePhaseFilter)) {
                colorTop = colors[`${slot.top.phase}_${slot.top.polarity}`];
            }

            ctx.beginPath();
            ctx.arc(cx, cy, rOuterTop, a0, a1, false);
            ctx.arc(cx, cy, rInnerTop, a1, a0, true);
            ctx.closePath();
            ctx.fillStyle = colorTop;
            ctx.fill();
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 0.7;
            ctx.stroke();

            // slot numbers
            ctx.fillStyle = '#111';
            ctx.font = '10px Arial';
            const rn = rOuterTop + 18;
            const nx = cx + rn * Math.cos(am);
            const ny = cy + rn * Math.sin(am) + 3;
            ctx.textAlign = 'center';
            ctx.fillText(String(i + 1), nx, ny);

            // top labels
            if (slot.top &&
                (activePhaseFilter === 'ALL' || slot.top.phase === activePhaseFilter)) {
                ctx.fillStyle = 'white';
                ctx.font = '10px Arial';
                const signTop = slot.top.polarity === 'pos' ? '+' : '−';
                const rt = (rOuterTop + rInnerTop) / 2;
                const tx = cx + rt * Math.cos(am);
                const ty = cy + rt * Math.sin(am) + 3;
                ctx.fillText(`${slot.top.phase}${signTop}`, tx, ty);
            }
        }

        // BOTTOM ring
        if (activeLayerFilter !== 'TOP') {
            let colorBot = '#e5e7eb';
            if (slot.bottom &&
                (activePhaseFilter === 'ALL' || slot.bottom.phase === activePhaseFilter)) {
                colorBot = colors[`${slot.bottom.phase}_${slot.bottom.polarity}`];
            }

            ctx.beginPath();
            ctx.arc(cx, cy, rOuterBot, a0, a1, false);
            ctx.arc(cx, cy, rInnerBot, a1, a0, true);
            ctx.closePath();
            ctx.fillStyle = colorBot;
            ctx.globalAlpha = 0.9;
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 0.7;
            ctx.stroke();

            if (slot.bottom &&
                (activePhaseFilter === 'ALL' || slot.bottom.phase === activePhaseFilter)) {
                ctx.fillStyle = 'white';
                ctx.font = '9px Arial';
                const signBot = slot.bottom.polarity === 'pos' ? '+' : '−';
                const rb = (rOuterBot + rInnerBot) / 2;
                const bx = cx + rb * Math.cos(am);
                const by = cy + rb * Math.sin(am) + 3;
                ctx.fillText(`${slot.bottom.phase}${signBot}`, bx, by);
            }
        }
    }

    // ---------- helpers ----------
    function angleForSlot(i) {
        return -Math.PI / 2 + (i + 0.5) * slotAngle;
    }

    function topPoint(i) {
        const a = angleForSlot(i);
        return { x: cx + rTopChord * Math.cos(a), y: cy + rTopChord * Math.sin(a) };
    }

    function bottomPoint(i) {
        const a = angleForSlot(i);
        return { x: cx + rBotChord * Math.cos(a), y: cy + rBotChord * Math.sin(a) };
    }

    // -----------------------------------
    // 1) clearer layer webs (local pitch y)
    // -----------------------------------

    // estimate y from first coil (same y for all)
    let y = 1;
    if (coils && coils.length) {
        const c0 = coils[0];
        const sIdx = (c0.startSlot - 1 + Z) % Z;
        const eIdx = (c0.endSlot   - 1 + Z) % Z;
        y = (eIdx - sIdx + Z) % Z;
        if (y === 0) y = 1;
    }

    // TOP web: solid arcs on top ring
    if (activeLayerFilter !== 'BOTTOM') {
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([]);

        for (let i = 0; i < Z; i++) {
            const top = winding[i].top;
            if (!top) continue;
            if (activePhaseFilter !== 'ALL' && top.phase !== activePhaseFilter) continue;

            const j = (i + y) % Z;
            const nxtTop = winding[j].top;
            if (!nxtTop || nxtTop.phase !== top.phase) continue;

            const a1 = angleForSlot(i);
            const a2 = angleForSlot(j);

            const color = colors[`${top.phase}_${top.polarity}`];
            ctx.strokeStyle = color;

            ctx.beginPath();
            ctx.moveTo(
                cx + rTopChord * Math.cos(a1),
                cy + rTopChord * Math.sin(a1)
            );
            ctx.lineTo(
                cx + rTopChord * Math.cos(a2),
                cy + rTopChord * Math.sin(a2)
            );
            ctx.stroke();
        }
    }

    // BOTTOM web: dashed arcs on bottom ring
    if (activeLayerFilter !== 'TOP') {
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([8, 5]);

        for (let i = 0; i < Z; i++) {
            const bot = winding[i].bottom;
            if (!bot) continue;
            if (activePhaseFilter !== 'ALL' && bot.phase !== activePhaseFilter) continue;

            const j = (i + y) % Z;
            const nxtBot = winding[j].bottom;
            if (!nxtBot || nxtBot.phase !== bot.phase) continue;

            const a1 = angleForSlot(i);
            const a2 = angleForSlot(j);

            const color = colors[`${bot.phase}_${bot.polarity}`];
            ctx.strokeStyle = color;

            ctx.beginPath();
            ctx.moveTo(
                cx + rBotChord * Math.cos(a1),
                cy + rBotChord * Math.sin(a1)
            );
            ctx.lineTo(
                cx + rBotChord * Math.cos(a2),
                cy + rBotChord * Math.sin(a2)
            );
            ctx.stroke();
        }
    }

    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // -----------------------------------
    // 2) bold series chain (top ↔ bottom)
    // -----------------------------------

    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.9;

    const visited = new Set();
    const phaseOrder = ['A', 'B', 'C'];

    phaseOrder.forEach(phase => {
        coils.forEach(startCoil => {
            if (startCoil.phase !== phase) return;
            if (activePhaseFilter !== 'ALL' && phase !== activePhaseFilter) return;
            if (visited.has(startCoil.id)) return;

            // build chain for this phase
            const chain = [];
            let c = startCoil;
            while (c && !visited.has(c.id)) {
                visited.add(c.id);
                chain.push(c);
                c = coils.find(k => k.id === c.nextCoil);
            }
            if (!chain.length) return;

            const phaseOffset =
                phase === 'A' ? 0 :
                phase === 'B' ? 5 : 10;

            chain.forEach((coil, idx) => {
                const startIdx = (coil.startSlot - 1 + Z) % Z;
                const endIdx   = (coil.endSlot   - 1 + Z) % Z;

                const colorTop = colors[`${phase}_${coil.polarity}`];
                const colorBot = colors[
                    `${phase}_${coil.polarity === 'pos' ? 'neg' : 'pos'}`
                ];

                // segment 1: top(start) -> bottom(end)
                if (activeLayerFilter !== 'BOTTOM') {
                    const a1 = angleForSlot(startIdx);
                    const a2 = angleForSlot(endIdx);

                    const x1 = cx + (rTopChord - phaseOffset) * Math.cos(a1);
                    const y1 = cy + (rTopChord - phaseOffset) * Math.sin(a1);
                    const x2 = cx + (rBotChord + phaseOffset) * Math.cos(a2);
                    const y2 = cy + (rBotChord + phaseOffset) * Math.sin(a2);

                    ctx.strokeStyle = colorTop;
                    ctx.setLineDash([]);
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.stroke();
                }

                // segment 2: bottom(end) -> top(start of next coil)
                const next = chain[idx + 1] || null;
                if (next && activeLayerFilter !== 'TOP') {
                    const nextStartIdx = (next.startSlot - 1 + Z) % Z;

                    const a1b = angleForSlot(endIdx);
                    const a2b = angleForSlot(nextStartIdx);

                    const xb1 = cx + (rBotChord + phaseOffset) * Math.cos(a1b);
                    const yb1 = cy + (rBotChord + phaseOffset) * Math.sin(a1b);
                    const xb2 = cx + (rTopChord - phaseOffset) * Math.cos(a2b);
                    const yb2 = cy + (rTopChord - phaseOffset) * Math.sin(a2b);

                    ctx.strokeStyle = colorBot;
                    ctx.setLineDash([6, 4]);
                    ctx.beginPath();
                    ctx.moveTo(xb1, yb1);
                    ctx.lineTo(xb2, yb2);
                    ctx.stroke();
                }
            });
        });
    });

    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
}


// ========= Winding table =========

function createWindingTable(winding) {
    const table = document.getElementById('windingTable');
    let html = `
        <tr>
            <th rowspan="2">Slot #</th>
            <th colspan="5">Top Layer (Forward Side)</th>
            <th colspan="5">Bottom Layer (Return Side)</th>
        </tr>
        <tr>
            <th>Color</th>
            <th>Phase</th>
            <th>Polarity</th>
            <th>Pole</th>
            <th>Goes To →</th>
            <th>Color</th>
            <th>Phase</th>
            <th>Polarity</th>
            <th>Pole</th>
            <th>← Comes From</th>
        </tr>
    `;

    winding.forEach(slot => {
        const topColor    = slot.top    ? colors[`${slot.top.phase}_${slot.top.polarity}`]       : '#e5e7eb';
        const bottomColor = slot.bottom ? colors[`${slot.bottom.phase}_${slot.bottom.polarity}`] : '#e5e7eb';

        html += `
            <tr>
                <td style="background:#f0f9ff;"><strong style="font-size:16px;">${slot.slot}</strong></td>

                <td><div style="width:40px;height:25px;background:${topColor};margin:0 auto;border-radius:4px;border:2px solid #333;"></div></td>
                <td><strong style="font-size:15px;color:#1e40af;">${slot.top ? slot.top.phase : '—'}</strong></td>
                <td><strong style="font-size:18px;">${slot.top ? (slot.top.polarity === 'pos' ? '●' : '⊗') : '—'}</strong></td>
                <td style="color:#666;">${slot.top ? `Pole ${slot.top.pole}` : '—'}</td>
                <td style="background:#fef3c7;"><strong style="color:#1e40af;">${slot.top && slot.top.coilEnd ? `→ Slot ${slot.top.coilEnd} (Bottom)` : '—'}</strong></td>

                <td><div style="width:40px;height:25px;background:${bottomColor};margin:0 auto;border-radius:4px;border:2px solid #333;"></div></td>
                <td><strong style="font-size:15px;color:#1e40af;">${slot.bottom ? slot.bottom.phase : '—'}</strong></td>
                <td><strong style="font-size:18px;">${slot.bottom ? (slot.bottom.polarity === 'pos' ? '●' : '⊗') : '—'}</strong></td>
                <td style="color:#666;">${slot.bottom ? `Pole ${slot.bottom.pole}` : '—'}</td>
                <td style="background:#fef3c7;"><strong style="color:#1e40af;">${slot.bottom && slot.bottom.coilStart ? `← Slot ${slot.bottom.coilStart} (Top)` : '—'}</strong></td>
            </tr>
        `;
    });

    html += `
        <tr style="background:#e0f2fe;font-weight:600;">
            <td colspan="11" style="padding:15px;text-align:center;font-size:14px;">
                <strong>Winding Summary:</strong> Each coil starts in a TOP layer (forward side) and ends in a BOTTOM layer (return side) after spanning the coil pitch.
                <br>
                <span style="color:#1e40af;">● = Current OUT (positive) | ⊗ = Current IN (negative)</span>
            </td>
        </tr>
    `;

    table.innerHTML = html;
}

// ========= Info modal =========

function showInfo(param) {
    const modal = document.getElementById('modal');
    const body  = document.getElementById('modalBody');

    const info = {
        q: {
            title: 'Slots per Pole per Phase (q)',
            formula: 'q = Z / (2p × m)',
            description: 'Number of slots occupied by one phase under one pole. Integer-slot (q integer) gives regular distribution; fractional-slot (q non-integer) gives special distribution used to reduce cogging torque and harmonics.'
        },
        actualq: {
            title: 'Effective q from Layout',
            formula: 'q_eff = (A-phase coils) / (number of poles)',
            description: 'Computed directly from the generated winding. It tells you what the implemented layout actually achieved in terms of slots per pole per phase for A-phase.'
        },
        tau: {
            title: 'Pole Pitch (τ)',
            formula: 'τ = Z / 2p',
            description: 'Distance between two consecutive poles in slots. This sets the natural full-pitch coil span and strongly influences the MMF waveform.'
        },
        y: {
            title: 'Coil Pitch (y)',
            formula: 'Full-pitch: y ≈ τ · Short-pitch: y < τ',
            description: 'Distance between the two sides of a coil, in slots. Full-pitch coils span approximately one pole pitch; short-pitched coils are shorter to reduce harmonics and copper in the end connections.'
        },
        combo: {
            title: 'Winding Type: 4 Combinations',
            formula: 'Integer/Fractional-slot × Full/Short-pitch',
            description:
`This project classifies your design into four regimes:
• Integer-slot, Full-pitch: classical distributed winding with y ≈ τ.
• Integer-slot, Short-pitch: same slot pattern, coils shortened to cut harmonics.
• Fractional-slot, Full-pitch: q non-integer but coils span ≈ τ.
• Fractional-slot, Short-pitch: both fractional distribution and short coils, popular in modern PM machines.
Current design: ${lastComboLabel}.`
        },
        pitchtype: {
            title: 'Pitch Type',
            formula: 'Full-pitch vs Short-pitch',
            description: 'Full-pitch winding maximizes fundamental EMF but passes all harmonics. Short-pitch winding slightly reduces fundamental EMF but can cancel selected harmonics (5th, 7th, etc.) and shortens end-winding length.'
        },
        alpha: {
            title: 'Electrical Angle (α)',
            formula: 'α = 360°p / Z',
            description: 'Electrical angle between adjacent slots. Used with q to compute distribution factor and to position phase axes about 120° apart in three-phase machines.'
        },
        coils: {
            title: 'Coils per Phase',
            formula: 'Total coils = Z / 2 (double-layer)',
            description: 'Each coil occupies two slots (top and bottom). For balanced three-phase winding, each phase should have nearly the same number of coils to keep MMF symmetrical.'
        },
        verify: {
            title: 'Winding Verification',
            formula: 'Check slots, layers, and coil connections',
            description: 'Valid design: every slot has exactly one top and one bottom coil side; coil connections follow the chosen pitch; each phase has similar coil count; and phase axes are roughly 120° apart for a 3‑phase machine.'
        },
        kp: {
            title: 'Pitch Factor (Kp)',
            formula: 'Kp = sin(β × 90°),  β = y / τ',
            description: 'Measures EMF reduction due to short-pitching. Kp = 1 for full-pitch; Kp < 1 for short-pitch. Designers trade some EMF for better harmonic behaviour and shorter copper ends.'
        },
        kd: {
            title: 'Distribution Factor (Kd)',
            formula: 'Kd = sin(qα/2) / (q × sin(α/2))',
            description: 'Measures EMF reduction due to distributing coils over several slots instead of concentrating them in one slot. Typical values are 0.9–0.97 for good distributed windings.'
        },
        kw: {
            title: 'Winding Factor (Kw)',
            formula: 'Kw = Kp × Kd',
            description: 'Overall effectiveness of the winding in producing fundamental EMF. Higher Kw means better utilization of copper. Practical designs often target Kw above 0.9.'
        }
    };

    const data = info[param];
    if (!data) return;

    body.innerHTML = `
        <h2 style="color:#1e3a8a;margin-bottom:20px;">${data.title}</h2>
        <div style="background:#dbeafe;padding:15px;border-radius:10px;margin:20px 0;font-family:'Courier New',monospace;font-size:18px;font-weight:600;color:#1e40af;border:2px solid #2563eb;">
            ${data.formula}
        </div>
        <p style="line-height:1.8;color:#555;font-size:16px;">${data.description}</p>
    `;

    modal.classList.add('active');
}

function closeModal() {
    document.getElementById('modal').classList.remove('active');
}

window.onclick = function (event) {
    const modal = document.getElementById('modal');
    if (event.target === modal) closeModal();
};

// ========= Responsive canvases =========

function resizeCanvases() {
    const dpr = window.devicePixelRatio || 1;
    ['linearCanvas', 'circularCanvas'].forEach(id => {
        const canvas = document.getElementById(id);
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        canvas.width  = rect.width  * dpr;
        canvas.height = rect.height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });

    if (currentWinding) {
        const Z = currentWinding.length;
        drawLinearDiagram(currentWinding, Z);
        drawCircularDiagram(currentWinding, Z);
    }
}

window.addEventListener('resize', resizeCanvases);
window.addEventListener('orientationchange', resizeCanvases);

// ========= Theme toggle with localStorage =========

const themeToggleBtn = document.getElementById('themeToggle');

if (themeToggleBtn) {
    const savedTheme = localStorage.getItem('theme') || 'dark';

    if (savedTheme === 'light') {
        document.body.classList.add('light');
        themeToggleBtn.textContent = '🌙 Dark';
    } else {
        document.body.classList.remove('light');
        themeToggleBtn.textContent = '☀️ Light';
    }

    themeToggleBtn.addEventListener('click', () => {
        const isLight = document.body.classList.toggle('light');
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
        themeToggleBtn.textContent = isLight ? '🌙 Dark' : '☀️ Light';
    });
}
