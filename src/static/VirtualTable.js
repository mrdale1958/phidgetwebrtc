console.log("[VirtualTable.js] Script execution started");

(function() {
  console.log("[VirtualTable.js] IIFE entered");

  function setupVirtualTable() {
    console.log("[VirtualTable.js] setupVirtualTable running");
    let annotation;

    // Create the container for the circles (hidden by default)
    let root = document.createElement('div');
    root.style.position = "fixed";
    root.style.top = "70px";
    root.style.left = "50%";
    root.style.transform = "translateX(-50%)";
    root.style.width = "320px";
    root.style.zIndex = "1000";
    root.style.margin = "0 auto";

    root.innerHTML = `
      <style>
        #test-circles-container { width:320px; height:320px; position:relative; display:none; margin:0 auto; }
      </style>
      <div id="test-circles-container">
        <svg id="test-circles-svg" width="320" height="320" style="touch-action:none; display:block; margin:0 auto;">
          <!-- Outer ring: 10% of radius (radius 144, stroke-width 32) -->
          <circle id="outer-circle" cx="160" cy="160" r="144" fill="none" stroke="#888" stroke-width="32"/>
          <!-- Inner circle: 90% of radius (radius 144) -->
          <g id="inner-group">
            <circle id="inner-circle" cx="160" cy="160" r="144" fill="#cce" stroke="#44a" stroke-width="3"/>
            <line id="tilt-line" x1="160" y1="160" x2="160" y2="16" stroke="#44a" stroke-width="4"/>
          </g>
          <circle id="spin-dot" cx="160" cy="160" r="8" fill="#e33" stroke="#fff" stroke-width="2" />
          <text id="spin-label" x="160" y="40" text-anchor="middle" fill="#444" font-size="16"></text>
          <text id="tilt-label" x="160" y="310" text-anchor="middle" fill="#444" font-size="16"></text>
        </svg>
      </div>
    `;
    document.body.appendChild(root);

    // Add a box to the right of the circles for delta history
    let historyBox = document.createElement('div');
    historyBox.id = "delta-history-box";
    historyBox.style.position = "fixed";
    historyBox.style.top = "70px";
    historyBox.style.left = "calc(50% + 180px)";
    historyBox.style.width = "180px";
    historyBox.style.height = "320px";
    historyBox.style.background = "#fff";
    historyBox.style.border = "1px solid #888";
    historyBox.style.borderRadius = "8px";
    historyBox.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
    historyBox.style.overflowY = "auto";
    historyBox.style.zIndex = "1000";
    historyBox.style.padding = "8px";
    historyBox.innerHTML = `
      <b>Last 20 Δ (zoom)</b>
      <table id="delta-history-table" style="width:100%; font-family:monospace; font-size:13px; border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:right; padding-right:8px;">Angle&nbsp;(°)</th>
            <th style="text-align:right;">Ticks</th>
          </tr>
        </thead>
        <tbody id="delta-history-tbody"></tbody>
      </table>
    `;
    document.body.appendChild(historyBox);

    // Hide both by default
    const container = document.getElementById('test-circles-container');
    root.style.display = 'none';
    historyBox.style.display = 'none';

    // WebRTC connection (reuse or fallback)
    let testConn = (typeof conn !== "undefined") ? conn : null;
    let deltaHistory = [];

    // --- Spin (outer ring) ---
    let isSpinning = false;
    let lastSpinAngle = 0;
    let spinStartAngle = 0;
    let spinTotalDelta = 0;
    let lastTickPosition = 0;
    let currentSpinPosition = 0;

    const svg = document.getElementById('test-circles-svg');
    const outer = document.getElementById('outer-circle');
    const spinLabel = document.getElementById('spin-label');

    outer.addEventListener('pointerdown', function(e) {
      isSpinning = true;
      const pt = getSVGPoint(e);
      spinStartAngle = getAngle(pt.x, pt.y);
      lastSpinAngle = spinStartAngle;
      lastTickPosition = Math.round((lastSpinAngle / 360) * clicksPerRev);
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', function(e) {
      if (!isSpinning) return;
      const pt = getSVGPoint(e);
      const angle = getAngle(pt.x, pt.y);
      let delta = angle - lastSpinAngle;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      lastSpinAngle = angle;

      // Calculate current tick position
      let tickPosition = Math.round((lastSpinAngle / 360) * clicksPerRev);
      let tickDelta = tickPosition - lastTickPosition;
      if (tickDelta > clicksPerRev / 2) tickDelta -= clicksPerRev;
      if (tickDelta < -clicksPerRev / 2) tickDelta += clicksPerRev;

      if (tickDelta !== 0) {
        currentSpinPosition += tickDelta;
        updateSpinDot(currentSpinPosition);

        // --- Send zoom gesture to main app ---
        sendTestPacket({
          gesture: "zoom",
          vector: { delta: tickDelta }
        });

        // --- Update delta history table ---
        deltaHistory.push({ angle: delta, ticks: tickDelta });
        if (deltaHistory.length > 20) deltaHistory.shift();
        let tbody = document.getElementById('delta-history-tbody');
        if (tbody) {
          tbody.innerHTML = deltaHistory.map(v =>
            `<tr>
              <td style="text-align:right; padding-right:8px;">${v.angle.toFixed(2)}</td>
              <td style="text-align:right;">${v.ticks}</td>
            </tr>`
          ).join('');
        }

        lastTickPosition = tickPosition;
      }
    });
    svg.addEventListener('pointerup', function(e) {
      isSpinning = false;
      spinTotalDelta = 0;
      spinLabel.textContent = '';
      svg.releasePointerCapture(e.pointerId);
    });

    // --- Tilt (inner circle) ---
    let isTilting = false;
    const inner = document.getElementById('inner-circle');
    const tiltLine = document.getElementById('tilt-line');
    const tiltLabel = document.getElementById('tilt-label');

    inner.addEventListener('pointerdown', function(e) {
      isTilting = true;
      handleTilt(e);
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', function(e) {
      if (isTilting) handleTilt(e);
    });
    svg.addEventListener('pointerup', function(e) {
      isTilting = false;
      tiltLabel.textContent = '';
      // Reset tilt line to center (level)
      tiltLine.setAttribute('x2', 160);
      tiltLine.setAttribute('y2', 160);
      // Optionally, send a "level" tilt packet
      sendTestPacket({
        gesture: "pan",
        vector: { x: 0, y: 0 }
      });
      svg.releasePointerCapture(e.pointerId);
    });

    function handleTilt(e) {
      const pt = getSVGPoint(e);
      const dx = pt.x - 160, dy = pt.y - 160;
      const r = Math.sqrt(dx*dx + dy*dy);
      const maxR = 144;
      const clampedR = Math.min(r, maxR);
      const angle = Math.atan2(dy, dx);
      tiltLine.setAttribute('x2', 160 + clampedR * Math.cos(angle));
      tiltLine.setAttribute('y2', 160 + clampedR * Math.sin(angle));
      const xNorm = clampedR * Math.cos(angle) / maxR;
      const yNorm = clampedR * Math.sin(angle) / maxR;
      tiltLabel.textContent = `Tilt x:${xNorm.toFixed(2)} y:${yNorm.toFixed(2)}`;
      sendTestPacket({
        gesture: "pan",
        vector: { x: xNorm, y: yNorm }
      });
    }

    function getSVGPoint(e) {
      const rect = svg.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    }
    function getAngle(x, y) {
      return (Math.atan2(y - 160, x - 160) * 180 / Math.PI + 360) % 360;
    }

    function sendTestPacket(obj) {
      if (testConn && testConn.isOpen) {
        testConn.put_nowait ? testConn.put_nowait(obj) : testConn.send(JSON.stringify(obj));
      } else {
        if (typeof handleWebSocketMessage === "function") handleWebSocketMessage({data: JSON.stringify(obj)});
      }
    }

    // Just before defining the annotation function:
    console.log("[VirtualTable.js] Defining window.showTestCirclesWithAnnotation");
    window.showTestCirclesWithAnnotation = function(annotationText) {
      console.log("[VirtualTable.js] showTestCirclesWithAnnotation CALLED with:", annotationText);
      if (!annotation) {
        annotation = document.createElement("div");
        annotation.id = "test-circles-annotation";
        annotation.style.textAlign = "center";
        annotation.style.color = "#b00";
        annotation.style.fontWeight = "bold";
        annotation.style.margin = "10px 0";
        container.parentNode.insertBefore(annotation, container);
      }
      annotation.textContent = annotationText || "Phidget server is not available";

      // --- Show the circles interface and history box ---
      container.style.display = 'block';
      root.style.display = 'block';
      historyBox.style.display = 'block';
    };

    // After defining the function:
    console.log("[VirtualTable.js] window.showTestCirclesWithAnnotation is now defined:", typeof window.showTestCirclesWithAnnotation);

    function updateSpinDot(currentSpinPosition) {
      const centerX = 160, centerY = 160;
      const dotRadius = 128;
      let angle = ((currentSpinPosition % clicksPerRev) / clicksPerRev) * 2 * Math.PI - Math.PI/2;
      let x = centerX + dotRadius * Math.cos(angle);
      let y = centerY + dotRadius * Math.sin(angle);
      let spinDot = document.getElementById('spin-dot');
      if (spinDot) {
        spinDot.setAttribute('cx', x);
        spinDot.setAttribute('cy', y);
      }
    }
    window.updateSpinDot = updateSpinDot;

    updateSpinDot(0);
    console.log("[VirtualTable.js] DOMContentLoaded handler complete");
    console.log("[VirtualTable.js] IIFE setup complete");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupVirtualTable);
  } else {
    setupVirtualTable();
  }
})();

console.log("[VirtualTable.js] Script execution complete");