/**
 * IPPAD App - Main UI Controller for Industrial Turbomachinery Dashboard
 * Coordinates DataService, ChartsManager, Digital Twin Visualizer, and DOM interactions.
 * Configured with:
 *   - 25s Baseline learning duration
 *   - Dual online/offline status check (Localhost Server & ESP32 Microcontroller)
 *   - 2 Operating Modes: Demo Simulation Mode vs Real-Time Hardware Data
 *   - Certified Normal & Critical Ranges
 */

document.addEventListener('DOMContentLoaded', () => {
  const dataService = window.dataService;
  const chartsManager = new window.ChartsManager(dataService);
  const visualizer = new window.TurbomachineVisualizer(dataService);

  // In-memory incidents list
  let incidents = [
    {
      id: 1,
      time: new Date().toLocaleTimeString(),
      severity: 'INFO',
      parameter: 'system',
      cause: 'IPPAD Turbomachinery Cell #4 online. ABAD baseline ready.',
      action: 'Autonomous anomaly monitoring active. 25s baseline ready.',
      score: 0.32
    }
  ];

  // =========================================================================
  // DOM References
  // =========================================================================
  // Mode Buttons
  const btnModeDemo = document.getElementById('btnModeDemo');
  const btnModeReal = document.getElementById('btnModeReal');

  // Dual Status Indicators
  const dotServer = document.getElementById('dotServer');
  const txtServerStatus = document.getElementById('txtServerStatus');
  const lblServerLabel = document.getElementById('lblServerLabel');
  const dotEsp32 = document.getElementById('dotEsp32');
  const txtEsp32Status = document.getElementById('txtEsp32Status');
  const txtLastUpdate = document.getElementById('txtLastUpdate');

  // Controls
  const btnOpenSettingsModal = document.getElementById('btnOpenSettingsModal');
  const btnLearnBaseline = document.getElementById('btnLearnBaseline');
  const btnCalAcs = document.getElementById('btnCalAcs');

  // Status Strip Elements
  const badgeMachineState = document.getElementById('badgeMachineState');
  const txtMachineState = document.getElementById('txtMachineState');
  const valAnomalyScore = document.getElementById('valAnomalyScore');
  const barAnomalyScore = document.getElementById('barAnomalyScore');
  const valLearnProgress = document.getElementById('valLearnProgress');
  const barLearnProgress = document.getElementById('barLearnProgress');
  const lblLearnDetail = document.getElementById('lblLearnDetail');
  const valSystemUptime = document.getElementById('valSystemUptime');
  const txtTopChannel = document.getElementById('txtTopChannel');

  // Top 8 Telemetry Cards
  const valVibVel = document.getElementById('valVibVel');
  const barVibVel = document.getElementById('barVibVel');
  const lblVibPeak = document.getElementById('lblVibPeak');

  const valPeakAccel = document.getElementById('valPeakAccel');
  const barPeakAccel = document.getElementById('barPeakAccel');

  const valTemp = document.getElementById('valTemp');
  const barTemp = document.getElementById('barTemp');
  const lblTempSrc = document.getElementById('lblTempSrc');

  const valHumidity = document.getElementById('valHumidity');
  const barHumidity = document.getElementById('barHumidity');

  const valCurrentIna = document.getElementById('valCurrentIna');
  const barCurrentIna = document.getElementById('barCurrentIna');
  const lblCurrentAcs = document.getElementById('lblCurrentAcs');

  const valVoltage = document.getElementById('valVoltage');
  const barVoltage = document.getElementById('barVoltage');

  const valShockRate = document.getElementById('valShockRate');
  const barShockRate = document.getElementById('barShockRate');

  const valPower = document.getElementById('valPower');
  const barPower = document.getElementById('barPower');
  const lblPowerFreq = document.getElementById('lblPowerFreq');

  // Z-Score Bars (Panel 5)
  const zValVib = document.getElementById('zValVib');
  const zBarVib = document.getElementById('zBarVib');

  const zValCur = document.getElementById('zValCur');
  const zBarCur = document.getElementById('zBarCur');

  const zValTemp = document.getElementById('zValTemp');
  const zBarTemp = document.getElementById('zBarTemp');

  const zValVolt = document.getElementById('zValVolt');
  const zBarVolt = document.getElementById('zBarVolt');

  const zValShock = document.getElementById('zValShock');
  const zBarShock = document.getElementById('zBarShock');

  // Incident Register Table (Panel 6)
  const incidentTableBody = document.querySelector('#incidentTable tbody');
  const btnClearIncidents = document.getElementById('btnClearIncidents');

  // Demo Fault Injection Controls
  const btnFaultImbalance = document.getElementById('btnFaultImbalance');
  const btnFaultThermal = document.getElementById('btnFaultThermal');
  const btnFaultJam = document.getElementById('btnFaultJam');
  const btnFaultShock = document.getElementById('btnFaultShock');
  const btnFaultMismatch = document.getElementById('btnFaultMismatch');
  const btnResetFaults = document.getElementById('btnResetFaults');

  // Modal Elements
  const settingsModal = document.getElementById('settingsModal');
  const btnCloseSettingsModal = document.getElementById('btnCloseSettingsModal');
  const btnSaveSettings = document.getElementById('btnSaveSettings');
  const cfgConnectionMode = document.getElementById('cfgConnectionMode');

  // Format seconds to HH:MM:SS
  function formatUptime(sec) {
    const hrs = Math.floor(sec / 3600).toString().padStart(2, '0');
    const mins = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${hrs}:${mins}:${s}`;
  }

  // =========================================================================
  // 1. Mode Switcher (Demo Simulation vs Real-Time Hardware Data)
  // =========================================================================
  function updateModeUI(mode) {
    if (mode === 'demo') {
      if (btnModeDemo) btnModeDemo.classList.add('active');
      if (btnModeReal) btnModeReal.classList.remove('active');
    } else {
      if (btnModeDemo) btnModeDemo.classList.remove('active');
      if (btnModeReal) btnModeReal.classList.add('active');
    }
  }

  if (btnModeDemo) {
    btnModeDemo.addEventListener('click', () => {
      dataService.setMode('demo');
      updateModeUI('demo');
    });
  }

  if (btnModeReal) {
    btnModeReal.addEventListener('click', () => {
      dataService.setMode('real');
      updateModeUI('real');
    });
  }

  
  // =========================================================================
  // 2. Supabase and hardware feed status listener
  // =========================================================================
   dataService.on('status', (st) => {
    // Demo mode uses the built-in simulation engine.
    // Real mode receives telemetry through Supabase Realtime.
    if (lblServerLabel) {
      lblServerLabel.textContent =
        st.mode === 'real' ? 'Supabase Realtime' : 'Demo Simulation';
    }

    if (st.mode === 'demo') {
      if (dotServer) dotServer.className = 'status-indicator-dot pulse';

      if (txtServerStatus) {
        txtServerStatus.className = 'status-val online';
        txtServerStatus.textContent = 'SIMULATION ACTIVE';
      }
    } else if (st.serverOnline) {
      if (dotServer) dotServer.className = 'status-indicator-dot pulse';

      if (txtServerStatus) {
        txtServerStatus.className = 'status-val online';
        txtServerStatus.textContent = 'CONNECTED';
      }
    } else {
      if (dotServer) dotServer.className = 'status-indicator-dot offline';

      if (txtServerStatus) {
        txtServerStatus.className = 'status-val offline';
        txtServerStatus.textContent = 'DISCONNECTED';
      }
    }

    // ESP32 Hardware Status Check
    if (st.mode === 'demo') {
      if (dotEsp32) dotEsp32.className = 'status-indicator-dot standby';
      if (txtEsp32Status) {
        txtEsp32Status.className = 'status-val standby';
        txtEsp32Status.textContent = 'SIMULATED (Demo Engine)';
      }
    } else {
      if (st.esp32Online) {
        if (dotEsp32) dotEsp32.className = 'status-indicator-dot pulse';
        if (txtEsp32Status) {
          txtEsp32Status.className = 'status-val online';
          txtEsp32Status.textContent = 'ONLINE (Active Feed)';
        }
      } else {
        if (dotEsp32) dotEsp32.className = 'status-indicator-dot offline';
        if (txtEsp32Status) {
          txtEsp32Status.className = 'status-val offline';
          txtEsp32Status.textContent = 'OFFLINE (Awaiting Packets)';
        }
      }
    }
  });

  // =========================================================================
  // 3. Telemetry Update Dispatcher
  // =========================================================================
  dataService.on('telemetry', (t) => {
    // Header Last Update & Uptime
    if (txtLastUpdate) txtLastUpdate.textContent = 'Just now (2.0 Hz)';
    if (valSystemUptime) valSystemUptime.textContent = formatUptime(Number(t.uptime_s || 0));

    // Operating State Badge
    if (txtMachineState && badgeMachineState) {
      txtMachineState.textContent = t.state_name;
      badgeMachineState.className = `machine-state-badge ${t.state_name.toLowerCase()}`;
    }

    // Anomaly Score Gauge (0-6.0)
    if (valAnomalyScore && Number.isFinite(Number(t.score))) valAnomalyScore.textContent = Number(t.score).toFixed(2);
    if (barAnomalyScore) {
      const scorePct = Math.min(100, Math.max(0, (Number(t.score || 0) / 6.0) * 100));
      barAnomalyScore.style.width = `${scorePct}%`;
    }

    // 25s Baseline Learning Progress
    if (valLearnProgress) {
      if (t.state === 0) {
        valLearnProgress.textContent = `${t.learn_pct}% (${t.learn_seconds_remaining}s left)`;
        if (lblLearnDetail) lblLearnDetail.textContent = `Collecting 25s baseline (${t.learn_seconds_remaining}s left)...`;
      } else {
        valLearnProgress.textContent = '100% (Locked)';
        if (lblLearnDetail) lblLearnDetail.textContent = '25s baseline locked • 50 samples @ 2 Hz';
      }
    }
    if (barLearnProgress) barLearnProgress.style.width = `${t.learn_pct}%`;

    // Top Contributor
    if (txtTopChannel) {
      txtTopChannel.textContent = t.device_id || (window.APP_CONFIG && window.APP_CONFIG.deviceId) || 'cell4';
    }

    // Top 8 Telemetry Cards with Certified Specifications:
    // 1. Vibration RMS Velocity (Normal: ~0.28 mm/s, Critical: > 7.1 mm/s)
    if (valVibVel) {
      valVibVel.textContent = t.vib_velocity_mms.toFixed(3);
      valVibVel.style.color = t.vib_velocity_mms > 7.1 ? '#ff0055' : 'var(--c-vib)';
    }
    if (barVibVel) {
      const pct = Math.min(100, (t.vib_velocity_mms / 7.1) * 100);
      barVibVel.style.width = `${pct}%`;
      barVibVel.style.background = t.vib_velocity_mms > 7.1 ? '#ff0055' : 'var(--c-vib)';
    }
    if (lblVibPeak) lblVibPeak.textContent = `Peak: ${t.vib_peak_g.toFixed(2)} g`;

    // 2. Vibration Peak Acceleration (Normal: 0 - 1.0 g, Critical: > 2.0 g)
    if (valPeakAccel) {
      valPeakAccel.textContent = t.vib_peak_g.toFixed(3);
      valPeakAccel.style.color = t.vib_peak_g > 2.0 ? '#ff0055' : 'var(--c-volt)';
    }
    if (barPeakAccel) {
      const pct = Math.min(100, (t.vib_peak_g / 2.0) * 100);
      barPeakAccel.style.width = `${pct}%`;
      barPeakAccel.style.background = t.vib_peak_g > 2.0 ? '#ff0055' : 'var(--c-volt)';
    }

    // 3. Bearing Temp (Normal: 30 - 65 °C, Critical: > 85 °C)
    if (valTemp) {
      valTemp.textContent = t.temp_c.toFixed(1);
      valTemp.style.color = t.temp_c > 85 ? '#ff0055' : (t.temp_c > 65 ? '#ffb703' : 'var(--c-temp)');
    }
    if (barTemp) {
      const pct = Math.min(100, Math.max(0, ((t.temp_c - 20) / (85 - 20)) * 100));
      barTemp.style.width = `${pct}%`;
      barTemp.style.background = t.temp_c > 85 ? '#ff0055' : 'var(--c-temp)';
    }
    if (lblTempSrc) lblTempSrc.textContent = t.temp_src === 1 ? 'DS18B20 Primary' : 'DHT11 Bearing Stand-in';

    // 4. Ambient Humidity (Normal: 20 - 70 %RH, Critical: > 70 %RH)
    if (valHumidity) {
      valHumidity.textContent = t.humidity_pct.toFixed(1);
      valHumidity.style.color = (t.humidity_pct > 70 || t.humidity_pct < 20) ? '#ffb703' : 'var(--c-hum)';
    }
    if (barHumidity) barHumidity.style.width = `${Math.min(100, t.humidity_pct)}%`;

    // 5. Load Current (Normal: 0 - 100% rated [2.0A], Critical: > 110% [> 2.2A])
    if (valCurrentIna) {
      valCurrentIna.textContent = `${t.current_a.toFixed(3)}`;
      valCurrentIna.style.color = t.current_pct > 110 ? '#ff0055' : 'var(--c-cur)';
    }
    if (barCurrentIna) {
      const pct = Math.min(100, (t.current_pct / 110) * 100);
      barCurrentIna.style.width = `${pct}%`;
      barCurrentIna.style.background = t.current_pct > 110 ? '#ff0055' : 'var(--c-cur)';
    }
    if (lblCurrentAcs) lblCurrentAcs.textContent = `${t.current_pct.toFixed(1)}% rated • ACS712: ${t.current_acs_a.toFixed(2)}A`;

    // 6. DC Bus Voltage (Normal: 95 - 100% [5.0V], Critical: < 90% [< 4.5V])
    if (valVoltage) {
      valVoltage.textContent = `${t.bus_v.toFixed(2)}`;
      valVoltage.style.color = t.voltage_pct < 90 ? '#ff0055' : 'var(--c-volt)';
    }
    if (barVoltage) {
      const pct = Math.min(100, t.voltage_pct);
      barVoltage.style.width = `${pct}%`;
      barVoltage.style.background = t.voltage_pct < 90 ? '#ff0055' : 'var(--c-volt)';
    }

    // 7. Shock Rate (Normal: 0 - 5 events/min, Critical: > 15 events/min)
    if (valShockRate) {
      valShockRate.textContent = t.shock_rate.toFixed(1);
      valShockRate.style.color = t.shock_rate > 15 ? '#ff0055' : 'var(--c-shock)';
    }
    if (barShockRate) {
      const pct = Math.min(100, (t.shock_rate / 15) * 100);
      barShockRate.style.width = `${pct}%`;
      barShockRate.style.background = t.shock_rate > 15 ? '#ff0055' : 'var(--c-shock)';
    }

    // 8. Instantaneous Power Draw & Rotor Frequency
    if (valPower) valPower.textContent = t.power_w.toFixed(2);
    if (barPower) barPower.style.width = `${Math.min(100, (t.power_w / 10.0) * 100)}%`;
    if (lblPowerFreq) lblPowerFreq.textContent = `${t.vib_freq_hz.toFixed(1)} Hz (~${Math.round(t.vib_freq_hz * 60)} RPM)`;

    // Panel 5: Z-Scores Breakdown
    updateZScoreBar(zValVib, zBarVib, t.z_vib);
    updateZScoreBar(zValCur, zBarCur, t.z_cur);
    updateZScoreBar(zValTemp, zBarTemp, t.z_temp);
    updateZScoreBar(zValVolt, zBarVolt, t.z_volt);
    updateZScoreBar(zValShock, zBarShock, t.z_shock);
  });

  function updateZScoreBar(valEl, barEl, z) {
    if (!valEl || !barEl) return;
    valEl.textContent = z.toFixed(2);
    const absZ = Math.abs(z);
    const pct = Math.min(100, (absZ / 4.0) * 100);
    barEl.style.width = `${pct}%`;
    if (absZ >= 4.0) {
      barEl.style.background = '#ff0055';
    } else if (absZ >= 2.5) {
      barEl.style.background = '#ffb703';
    } else {
      barEl.style.background = '#00f0ff';
    }
  }

  // =========================================================================
  // Incident Register Table
  // =========================================================================
  dataService.on('incident', (inc) => {
    incidents.unshift(inc);
    if (incidents.length > 50) incidents.pop();
    renderIncidentTable();
  });

  function renderIncidentTable() {
    if (!incidentTableBody) return;
    incidentTableBody.innerHTML = '';

    incidents.slice(0, 15).forEach((inc) => {
      const tr = document.createElement('tr');
      const sevClass = inc.severity.toLowerCase();

      tr.innerHTML = `
        <td style="font-family: var(--font-mono); color: #94a3b8;">${inc.time}</td>
        <td><span class="severity-pill ${sevClass}">${inc.severity}</span></td>
        <td style="font-family: var(--font-mono); color: var(--c-vib);">${inc.parameter}</td>
        <td style="color: #f1f5f9; font-weight: 500;">${inc.cause}</td>
        <td style="color: #94a3b8;">${inc.action}</td>
        <td style="font-family: var(--font-mono); font-weight: 700; color: var(--c-score);">${inc.score.toFixed(2)}</td>
      `;
      incidentTableBody.appendChild(tr);
    });
  }

  if (btnClearIncidents) {
    btnClearIncidents.addEventListener('click', () => {
      incidents = [];
      renderIncidentTable();
    });
  }

  // =========================================================================
  // Control Commands
  // =========================================================================
  if (btnLearnBaseline) {
    btnLearnBaseline.addEventListener('click', () => {
      dataService.commandLearn();
    });
  }

  if (btnCalAcs) {
    btnCalAcs.addEventListener('click', () => {
      dataService.commandCalAcs();
    });
  }

  // =========================================================================
  // Fault Injection Suite (Matching Certified Critical Limits)
  // =========================================================================
  function setFaultActive(activeBtn, faultName) {
    [btnFaultImbalance, btnFaultThermal, btnFaultJam, btnFaultShock, btnFaultMismatch].forEach(b => {
      if (b) b.classList.remove('active');
    });
    if (activeBtn) activeBtn.classList.add('active');
    dataService.injectFault(faultName);
  }

  if (btnFaultImbalance) {
    btnFaultImbalance.addEventListener('click', () => setFaultActive(btnFaultImbalance, 'imbalance'));
  }
  if (btnFaultThermal) {
    btnFaultThermal.addEventListener('click', () => setFaultActive(btnFaultThermal, 'thermal'));
  }
  if (btnFaultJam) {
    btnFaultJam.addEventListener('click', () => setFaultActive(btnFaultJam, 'jam'));
  }
  if (btnFaultShock) {
    btnFaultShock.addEventListener('click', () => setFaultActive(btnFaultShock, 'shock'));
  }
  if (btnFaultMismatch) {
    btnFaultMismatch.addEventListener('click', () => setFaultActive(btnFaultMismatch, 'sensor_mismatch'));
  }
  if (btnResetFaults) {
    btnResetFaults.addEventListener('click', () => {
      [btnFaultImbalance, btnFaultThermal, btnFaultJam, btnFaultShock, btnFaultMismatch].forEach(b => {
        if (b) b.classList.remove('active');
      });
      dataService.clearFault();
    });
  }

  // Keyboard Shortcuts (b, t, j, s, l, r)
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const key = e.key.toLowerCase();
    if (key === 'b') setFaultActive(btnFaultImbalance, 'imbalance');
    if (key === 't') setFaultActive(btnFaultThermal, 'thermal');
    if (key === 'j') setFaultActive(btnFaultJam, 'jam');
    if (key === 's') setFaultActive(btnFaultShock, 'shock');
    if (key === 'l') dataService.commandLearn();
    if (key === 'r') {
      [btnFaultImbalance, btnFaultThermal, btnFaultJam, btnFaultShock, btnFaultMismatch].forEach(b => {
        if (b) b.classList.remove('active');
      });
      dataService.clearFault();
    }
  });

  // Settings Modal
  if (btnOpenSettingsModal) {
    btnOpenSettingsModal.addEventListener('click', () => settingsModal.classList.add('open'));
  }
  if (btnCloseSettingsModal) {
    btnCloseSettingsModal.addEventListener('click', () => settingsModal.classList.remove('open'));
  }
  if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', () => {
      const mode = cfgConnectionMode.value;
      dataService.setMode(mode);
      updateModeUI(mode);
      settingsModal.classList.remove('open');
    });
  }

  // Initial render
  updateModeUI(dataService.mode);
  if (cfgConnectionMode) cfgConnectionMode.value = dataService.mode;
  renderIncidentTable();
});
