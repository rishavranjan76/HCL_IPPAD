/**
 * IPPAD DataService - Adaptive Baseline Anomaly Detector & Telemetry Engine
 * Turbomachinery Cell #4 SCADA Architecture
 * 
 * Configured with:
 * - 25s Baseline learning duration (50 samples @ 2 Hz)
 * - 2 Operating Modes: Demo Simulation Mode vs Real-Time Hardware Mode (ESP32)
 * - Dual Status Tracking: Localhost API Server & ESP32 Microcontroller link
 * - Certified Normal & Critical Ranges:
 *     Bearing Temp: 30-65 °C (Critical > 85 °C)
 *     Vibration RMS Velocity: 0.28 mm/s (Critical > 7.1 mm/s)
 *     Vibration Peak Accel: 0-1 g (Critical > 2 g)
 *     Shock Rate: 0-5 events/min (Critical > 15 events/min)
 *     Load Current: 0-100% rated [0-2.0A] (Critical > 110% [> 2.2A])
 *     DC Bus Voltage: 95-100% nominal [4.75-5.0V] (Critical < 90% [< 4.5V])
 *     Ambient Humidity: 20-70 %RH (Critical > 70%)
 */

class DataService {
  constructor() {
    this.mode = 'demo'; // 'demo' (Simulation) or 'real' (Real-Time ESP32 / Server)
    this.serverUrl = window.location.origin && window.location.origin.startsWith('http') 
      ? window.location.origin 
      : 'http://localhost:8000';
    
    this.pollInterval = 500; // 2 Hz = 500ms
    this.pollTimer = null;
    this.healthTimer = null;

    // Dual link statuses
    this.serverOnline = false;
    this.esp32Online = false;
    this.esp32LastSeenSec = -1;

    // Event listeners
    this.listeners = {
      telemetry: [],
      incident: [],
      stateChange: [],
      status: []
    };

    // ABAD Detector Configuration (Per Specification)
    this.learningDurationSec = 25; // 25 seconds baseline
    this.learningSamplesTotal = 50; // 25s @ 2 Hz = 50 samples
    this.sampleCount = 50;
    this.isLearning = false;

    // Thresholds
    this.thrWatch = 2.5;
    this.thrCrit = 4.0;

    // Weights: Vibration 1.5, Current 1.5, Temperature 1.0, Voltage 1.0, Shock 1.0
    this.weights = {
      vib_velocity_mms: 1.5,
      current_a: 1.5,
      temp_c: 1.0,
      bus_v: 1.0,
      shock_rate: 1.0
    };

    // Certified Hard Safety Limits
    this.hardLimits = {
      temp_c: 85.0,              // Critical: above 85 °C
      vib_velocity_mms: 7.1,     // Critical: above 7.1 mm/s (ISO 10816 Zone D)
      vib_peak_g: 2.0,           // Critical: above 2 g
      current_pct: 110.0,        // Critical: above 110% rated (> 2.2A on 2.0A base)
      current_a: 2.20,
      voltage_pct_min: 90.0,     // Critical: below 90% nominal (< 4.5V on 5.0V base)
      bus_v_min: 4.50,
      shock_rate: 15.0,          // Critical: above 15 events/min
      humidity_pct_max: 70.0     // Critical: above 70 %RH
    };

    // Baseline Mean & Variance storage (Persisted to localStorage)
    this.baseline = this.loadBaseline() || {
      mean: { temp_c: 42.5, vib_velocity_mms: 0.28, current_a: 0.85, bus_v: 4.98, shock_rate: 0.5 },
      var:  { temp_c: 0.35, vib_velocity_mms: 0.004, current_a: 0.006, bus_v: 0.003, shock_rate: 0.2 }
    };

    // Exponential smoothing (e = 0.3 * x + 0.7 * e_prev)
    this.smoothed = { ...this.baseline.mean };

    // Persistence counters
    this.consecutiveWatch = 0;
    this.consecutiveCrit = 0;
    this.consecutiveStepDown = 0;
    this.lastEventTime = 0;

    // Active Fault Injection in Demo Mode
    this.activeFault = 'none';
    this.faultRemaining = 0;

    // Initial Telemetry Snapshot
    this.telemetry = {
      uptime_s: 0,
      temp_c: 42.5,
      temp_src: 0, // 0 = DHT11, 1 = DS18B20
      humidity_pct: 52.0,
      vib_velocity_mms: 0.28,
      vib_rms_g: 0.045,
      vib_peak_g: 0.35,
      vib_freq_hz: 49.2,
      shock_rate: 0.0,
      current_a: 0.85,
      current_pct: 42.5,
      current_acs_a: 0.84,
      current_sct_a: 0.0,
      bus_v: 4.98,
      voltage_pct: 99.6,
      power_w: 4.23,
      rssi_dbm: -58,
      score: 0.32,
      state: 1, // 0 = LEARNING, 1 = NORMAL, 2 = WATCH, 3 = CRITICAL
      state_name: 'NORMAL',
      learn_pct: 100,
      learn_seconds_remaining: 0,
      z_temp: 0.10,
      z_vib: 0.15,
      z_cur: 0.12,
      z_volt: 0.06,
      z_shock: 0.00,
      top_channel: 'vib_velocity_mms',
      thr_watch: this.thrWatch,
      thr_crit: this.thrCrit,
      last_packet: new Date(),
      server_online: false,
      esp32_online: false
    };

    // History buffer for real-time waveform charts (Last 30 samples)
    this.history = {
      labels: [],
      temp: [],
      hum: [],
      vib_velocity: [],
      vib_peak: [],
      shock: [],
      cur_ina: [],
      cur_acs: [],
      bus_v: [],
      power: [],
      score: [],
      z_vib: [],
      z_cur: [],
      z_temp: []
    };

    // Start background loops
    this.initStream();
    this.startHealthCheck();
  }

  loadBaseline() {
    try {
      const data = localStorage.getItem('ippad_abad_baseline_v2');
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  }

  saveBaseline() {
    try {
      localStorage.setItem('ippad_abad_baseline_v2', JSON.stringify(this.baseline));
    } catch (e) {}
  }

  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }

  // Set Mode: 'demo' or 'real'
  setMode(mode) {
    this.mode = mode;
    this.emit('incident', {
      id: Date.now(),
      time: new Date().toLocaleTimeString(),
      severity: 'INFO',
      parameter: 'mode',
      cause: mode === 'demo' ? 'Switched to Demo Simulation Mode.' : 'Switched to Real-Time Hardware Mode (Polling ESP32/API).',
      action: mode === 'demo' ? 'Interactive physical scenarios active.' : 'Listening for real ESP32 packets.',
      score: this.telemetry.score
    });
    this.initStream();
  }

  initStream() {
    if (this.pollTimer) clearInterval(this.pollTimer);

    if (this.mode === 'demo') {
      this.pollTimer = setInterval(() => this.runSimulationStep(), this.pollInterval);
    } else {
      // Real-time mode: poll server/ESP32 every 500ms
      this.pollTimer = setInterval(() => this.fetchHttpTelemetry(), this.pollInterval);
    }
  }

  // Periodic health check for localhost server & ESP32 link
  startHealthCheck() {
    const probe = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1200);
        const res = await fetch(`${this.serverUrl}/api/health`, { 
          cache: 'no-cache', 
          signal: controller.signal 
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const healthData = await res.json();
          this.serverOnline = true;
          if (this.mode === 'real') {
            this.esp32Online = healthData.esp32_online || false;
            this.esp32LastSeenSec = healthData.esp32_last_seen;
          } else {
            // In demo mode, simulator acts as live model
            this.esp32Online = true;
          }
        } else {
          this.serverOnline = false;
          if (this.mode === 'real') this.esp32Online = false;
        }
      } catch (err) {
        this.serverOnline = false;
        if (this.mode === 'real') this.esp32Online = false;
      }

      this.telemetry.server_online = this.serverOnline;
      this.telemetry.esp32_online = this.esp32Online;

      this.emit('status', {
        serverOnline: this.serverOnline,
        esp32Online: this.esp32Online,
        mode: this.mode,
        esp32LastSeenSec: this.esp32LastSeenSec
      });
    };

    probe();
    this.healthTimer = setInterval(probe, 2000);
  }

  // Trigger 25s Baseline Learning
  commandLearn() {
    this.sampleCount = 0;
    this.isLearning = true;
    this.telemetry.state = 0;
    this.telemetry.state_name = 'LEARNING';
    this.telemetry.learn_pct = 0;
    this.telemetry.learn_seconds_remaining = this.learningDurationSec;

    this.emit('incident', {
      id: Date.now(),
      time: new Date().toLocaleTimeString(),
      severity: 'INFO',
      parameter: 'baseline',
      cause: 'Manual 25s Baseline Learn command triggered.',
      action: 'Keep turbomachinery running under stable nominal load for 25 seconds.',
      score: 0.0
    });

    // Notify backend if running
    if (this.serverOnline) {
      fetch(`${this.serverUrl}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'learn' })
      }).catch(() => {});
    }
  }

  commandResetBaseline() {
    localStorage.removeItem('ippad_abad_baseline_v2');
    this.baseline = {
      mean: { temp_c: 42.5, vib_velocity_mms: 0.28, current_a: 0.85, bus_v: 4.98, shock_rate: 0.5 },
      var:  { temp_c: 0.35, vib_velocity_mms: 0.004, current_a: 0.006, bus_v: 0.003, shock_rate: 0.2 }
    };
    this.commandLearn();
  }

  commandCalAcs() {
    this.emit('incident', {
      id: Date.now(),
      time: new Date().toLocaleTimeString(),
      severity: 'INFO',
      parameter: 'ACS712',
      cause: 'Zero-current calibration executed.',
      action: 'Zero-offset voltage stored in NVS.',
      score: this.telemetry.score
    });
  }

  injectFault(faultType) {
    this.activeFault = faultType;
    this.faultRemaining = 30; // 15 seconds @ 2 Hz
    if (this.serverOnline) {
      fetch(`${this.serverUrl}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: `fault_${faultType}` })
      }).catch(() => {});
    }
  }

  clearFault() {
    this.activeFault = 'none';
    this.faultRemaining = 0;
    if (this.serverOnline) {
      fetch(`${this.serverUrl}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'reset' })
      }).catch(() => {});
    }
  }

  // -------------------------------------------------------------------------
  // Demo Mode: 2 Hz Simulation Step with Exact Normal & Critical Parameters
  // -------------------------------------------------------------------------
  runSimulationStep() {
    this.telemetry.uptime_s += 1;

    // Base nominal values within requested normal ranges:
    let rawTemp = 42.5 + (Math.random() - 0.5) * 0.8;             // Normal: 30-65 °C
    let rawVibVel = 0.28 + (Math.random() - 0.5) * 0.04;          // Normal: 0.28 mm/s
    let rawPeakG = 0.35 + (Math.random() - 0.5) * 0.06;           // Normal: 0 - 1.0 g
    let rawCur = 0.85 + (Math.random() - 0.5) * 0.05;             // Normal: 0-100% (2.0A rated)
    let rawVolt = 4.98 + (Math.random() - 0.5) * 0.03;            // Normal: 95-100% (5.0V nom)
    let rawShock = Math.max(0.0, 0.4 + (Math.random() - 0.5) * 0.4); // Normal: 0-5 ev/min
    let rawHum = 52.0 + (Math.random() - 0.5) * 1.0;              // Normal: 20-70 %RH
    let rawFreq = 49.2 + (Math.random() - 0.5) * 0.6;             // ~2952 RPM

    // Apply active injected fault dynamics matching critical thresholds:
    if (this.faultRemaining > 0) {
      this.faultRemaining--;
      if (this.activeFault === 'imbalance') {
        rawVibVel = 8.5 + (Math.random() - 0.5) * 0.8;            // Critical: above 7.1 mm/s!
        rawPeakG = 2.45 + (Math.random() - 0.5) * 0.3;            // Critical: above 2.0 g!
        rawShock = 8.0 + (Math.random() - 0.5) * 3;
        rawFreq = 73.0 + (Math.random() - 0.5) * 2;
      } else if (this.activeFault === 'thermal') {
        rawTemp = 74.0 + (30 - this.faultRemaining) * 0.65;       // Critical: above 85 °C!
      } else if (this.activeFault === 'jam') {
        rawCur = 2.70 + (Math.random() - 0.5) * 0.25;             // Critical: above 110% rated (2.2A)!
        rawVolt = 4.15 + (Math.random() - 0.5) * 0.08;            // Critical: below 90% nominal (4.5V)!
      } else if (this.activeFault === 'shock') {
        rawShock = 19.5 + Math.random() * 8;                      // Critical: above 15 ev/min!
        rawVibVel += 2.0;
        rawPeakG += 0.8;
      }
    } else {
      this.activeFault = 'none';
    }

    // Redundant ACS712
    let curAcs = rawCur + (Math.random() - 0.5) * 0.03;
    if (this.activeFault === 'sensor_mismatch') {
      curAcs = rawCur * 0.42; // Mismatch > 25%
    }

    // Exponential smoothing e = 0.3 * x + 0.7 * e_prev
    this.smoothed.temp_c = 0.3 * rawTemp + 0.7 * this.smoothed.temp_c;
    this.smoothed.vib_velocity_mms = 0.3 * rawVibVel + 0.7 * this.smoothed.vib_velocity_mms;
    this.smoothed.current_a = 0.3 * rawCur + 0.7 * this.smoothed.current_a;
    this.smoothed.bus_v = 0.3 * rawVolt + 0.7 * this.smoothed.bus_v;
    this.smoothed.shock_rate = 0.3 * rawShock + 0.7 * this.smoothed.shock_rate;

    // 25s Learning Phase (50 samples @ 2 Hz)
    if (this.isLearning) {
      this.sampleCount++;
      const pct = Math.min(100, Math.floor((this.sampleCount / this.learningSamplesTotal) * 100));
      const secLeft = Math.max(0, Math.ceil((this.learningSamplesTotal - this.sampleCount) / 2));
      
      this.telemetry.learn_pct = pct;
      this.telemetry.learn_seconds_remaining = secLeft;
      this.telemetry.state = 0;
      this.telemetry.state_name = 'LEARNING';

      const keys = ['temp_c', 'vib_velocity_mms', 'current_a', 'bus_v', 'shock_rate'];
      const rawVals = {
        temp_c: rawTemp,
        vib_velocity_mms: rawVibVel,
        current_a: rawCur,
        bus_v: rawVolt,
        shock_rate: rawShock
      };

      keys.forEach(k => {
        const delta = rawVals[k] - this.baseline.mean[k];
        this.baseline.mean[k] += delta / this.sampleCount;
        const delta2 = rawVals[k] - this.baseline.mean[k];
        this.baseline.var[k] += delta * delta2 / Math.max(1, this.sampleCount - 1);
      });

      if (this.sampleCount >= this.learningSamplesTotal) {
        this.isLearning = false;
        this.saveBaseline();
        this.telemetry.state = 1;
        this.telemetry.state_name = 'NORMAL';
        this.telemetry.learn_seconds_remaining = 0;
        this.emit('incident', {
          id: Date.now(),
          time: new Date().toLocaleTimeString(),
          severity: 'INFO',
          parameter: 'baseline',
          cause: '25-second baseline learning complete (50 samples @ 2 Hz).',
          action: 'Adaptive Baseline Anomaly Detector locked. Machine in NORMAL state.',
          score: 0.24
        });
      }
    } else {
      this.telemetry.learn_pct = 100;
      this.telemetry.learn_seconds_remaining = 0;
    }

    // Sigma floors
    const sigmas = {
      temp_c: Math.max(Math.sqrt(Math.max(0.0001, this.baseline.var.temp_c)), 0.3, Math.abs(this.baseline.mean.temp_c) * 0.02),
      vib_velocity_mms: Math.max(Math.sqrt(Math.max(0.00001, this.baseline.var.vib_velocity_mms)), 0.02, Math.abs(this.baseline.mean.vib_velocity_mms) * 0.02),
      current_a: Math.max(Math.sqrt(Math.max(0.0001, this.baseline.var.current_a)), 0.05, Math.abs(this.baseline.mean.current_a) * 0.02),
      bus_v: Math.max(Math.sqrt(Math.max(0.0001, this.baseline.var.bus_v)), 0.05, Math.abs(this.baseline.mean.bus_v) * 0.02),
      shock_rate: Math.max(Math.sqrt(Math.max(0.001, this.baseline.var.shock_rate)), 0.5, Math.abs(this.baseline.mean.shock_rate) * 0.02)
    };

    // Z-scores
    const z = {
      temp_c: (this.smoothed.temp_c - this.baseline.mean.temp_c) / sigmas.temp_c,
      vib_velocity_mms: (this.smoothed.vib_velocity_mms - this.baseline.mean.vib_velocity_mms) / sigmas.vib_velocity_mms,
      current_a: (this.smoothed.current_a - this.baseline.mean.current_a) / sigmas.current_a,
      bus_v: (this.smoothed.bus_v - this.baseline.mean.bus_v) / sigmas.bus_v,
      shock_rate: (this.smoothed.shock_rate - this.baseline.mean.shock_rate) / sigmas.shock_rate
    };

    // Fused Score S
    const w = this.weights;
    const sumW = w.temp_c + w.vib_velocity_mms + w.current_a + w.bus_v + w.shock_rate;
    const sumWz2 = (w.vib_velocity_mms * (z.vib_velocity_mms ** 2)) +
                   (w.current_a * (z.current_a ** 2)) +
                   (w.temp_c * (z.temp_c ** 2)) +
                   (w.bus_v * (z.bus_v ** 2)) +
                   (w.shock_rate * (z.shock_rate ** 2));

    const score = Number(Math.sqrt(sumWz2 / sumW).toFixed(2));

    // Attribution
    const contribs = {
      vib_velocity_mms: w.vib_velocity_mms * (z.vib_velocity_mms ** 2),
      current_a: w.current_a * (z.current_a ** 2),
      temp_c: w.temp_c * (z.temp_c ** 2),
      bus_v: w.bus_v * (z.bus_v ** 2),
      shock_rate: w.shock_rate * (z.shock_rate ** 2)
    };
    const topChannel = Object.keys(contribs).reduce((a, b) => contribs[a] > contribs[b] ? a : b);

    // Hard Safety Limits Checks (Certified Specifications)
    let hardTripped = false;
    let hardReason = '';
    const curPct = (rawCur / 2.0) * 100;
    const voltPct = (rawVolt / 5.0) * 100;

    if (rawTemp > this.hardLimits.temp_c) {
      hardTripped = true;
      hardReason = `Bearing temperature exceeded critical limit (${rawTemp.toFixed(1)} °C > 85 °C)`;
    } else if (rawVibVel > this.hardLimits.vib_velocity_mms) {
      hardTripped = true;
      hardReason = `Vibration RMS velocity exceeded critical threshold (${rawVibVel.toFixed(2)} mm/s > 7.1 mm/s)`;
    } else if (rawPeakG > this.hardLimits.vib_peak_g) {
      hardTripped = true;
      hardReason = `Vibration Peak acceleration exceeded critical threshold (${rawPeakG.toFixed(2)} g > 2.0 g)`;
    } else if (curPct > this.hardLimits.current_pct) {
      hardTripped = true;
      hardReason = `Load current exceeded 110% rated current (${curPct.toFixed(1)}% [${rawCur.toFixed(2)}A] > 110%)`;
    } else if (voltPct < this.hardLimits.voltage_pct_min) {
      hardTripped = true;
      hardReason = `DC bus voltage collapsed below 90% nominal (${voltPct.toFixed(1)}% [${rawVolt.toFixed(2)}V] < 90%)`;
    } else if (rawShock > this.hardLimits.shock_rate) {
      hardTripped = true;
      hardReason = `Shock rate exceeded critical limit (${rawShock.toFixed(1)} ev/min > 15 ev/min)`;
    }

    // State machine persistence & hysteresis
    const prevState = this.telemetry.state;
    let nextState = prevState;

    if (hardTripped || score >= this.thrCrit) {
      this.consecutiveCrit++;
      if (this.consecutiveCrit >= 4 || hardTripped) {
        nextState = 3; // CRITICAL
      }
    } else {
      this.consecutiveCrit = 0;
    }

    if (nextState !== 3) {
      if (score >= this.thrWatch) {
        this.consecutiveWatch++;
        if (this.consecutiveWatch >= 3) {
          nextState = 2; // WATCH
        }
      } else {
        this.consecutiveWatch = 0;
      }
    }

    // Step-down hysteresis: score < 0.8 * threshold for 5 samples
    if (nextState === 3 && score < (0.8 * this.thrCrit) && !hardTripped) {
      this.consecutiveStepDown++;
      if (this.consecutiveStepDown >= 5) {
        nextState = 2;
        this.consecutiveStepDown = 0;
      }
    } else if (nextState === 2 && score < (0.8 * this.thrWatch)) {
      this.consecutiveStepDown++;
      if (this.consecutiveStepDown >= 5) {
        nextState = 1;
        this.consecutiveStepDown = 0;
      }
    }

    if (this.isLearning) nextState = 0;
    const stateNames = { 0: 'LEARNING', 1: 'NORMAL', 2: 'WATCH', 3: 'CRITICAL' };

    // Incident logging on state change
    if (nextState !== prevState && !this.isLearning) {
      const now = Date.now();
      if (now - this.lastEventTime >= 8000) {
        let sev = nextState === 1 ? 'INFO' : (nextState === 2 ? 'WARNING' : (hardTripped ? 'EMERGENCY' : 'CRITICAL'));
        let cause = 'Machine parameters shifted from learned normal.';
        let action = 'Check telemetry waveforms.';

        if (topChannel === 'vib_velocity_mms') {
          cause = 'Vibration RMS velocity exceeded ISO standard. Likely bearing wear or rotor imbalance.';
          action = 'Inspect bearing lubrication, shaft balance, and foundation bolts.';
        } else if (topChannel === 'current_a' && z.bus_v > 1.2) {
          cause = 'Motor overloaded / jammed and supply is sagging below 90%.';
          action = 'Stop machine immediately, clear rotor jam, and inspect windings.';
        } else if (topChannel === 'current_a') {
          cause = 'Motor draws over 110% rated current.';
          action = 'Check driven load, mechanical friction, and alignment.';
        } else if (topChannel === 'temp_c') {
          cause = 'Bearing temperature rising above normal operating range (30-65 °C).';
          action = 'Check cooling, bearing lubrication, and reduce machine load.';
        } else if (topChannel === 'shock_rate') {
          cause = 'Repeated mechanical impact events detected (> 15 events/min).';
          action = 'Check for loose components or knocking parts.';
        } else if (topChannel === 'bus_v') {
          cause = 'DC bus voltage sagged below 90% nominal.';
          action = 'Check DC power supply, line drop, and terminal connections.';
        }

        if (hardTripped) {
          cause = `CRITICAL LIMIT EXCEEDED: ${hardReason}`;
          action = 'Emergency shutdown and immediate inspection recommended.';
        }

        this.emit('incident', {
          id: now,
          time: new Date().toLocaleTimeString(),
          severity: sev,
          parameter: topChannel,
          cause: cause,
          action: action,
          score: score
        });
        this.lastEventTime = now;
      }
      this.emit('stateChange', { from: prevState, to: nextState, name: stateNames[nextState] });
    }

    // Slow drift tracking in NORMAL (0.0005 rate)
    if (nextState === 1 && !this.isLearning) {
      const alpha = 0.0005;
      const rawVals = { temp_c: rawTemp, vib_velocity_mms: rawVibVel, current_a: rawCur, bus_v: rawVolt, shock_rate: rawShock };
      ['temp_c', 'vib_velocity_mms', 'current_a', 'bus_v', 'shock_rate'].forEach(k => {
        this.baseline.mean[k] = (1.0 - alpha) * this.baseline.mean[k] + alpha * rawVals[k];
      });
    }

    // Populate Telemetry
    this.telemetry.temp_c = Number(rawTemp.toFixed(2));
    this.telemetry.humidity_pct = Number(rawHum.toFixed(1));
    this.telemetry.vib_velocity_mms = Number(rawVibVel.toFixed(3));
    this.telemetry.vib_rms_g = Number((rawVibVel * 0.16).toFixed(3));
    this.telemetry.vib_peak_g = Number(rawPeakG.toFixed(3));
    this.telemetry.vib_freq_hz = Number(rawFreq.toFixed(1));
    this.telemetry.shock_rate = Number(rawShock.toFixed(1));
    this.telemetry.current_a = Number(rawCur.toFixed(3));
    this.telemetry.current_pct = Number(curPct.toFixed(1));
    this.telemetry.current_acs_a = Number(curAcs.toFixed(3));
    this.telemetry.bus_v = Number(rawVolt.toFixed(2));
    this.telemetry.voltage_pct = Number(voltPct.toFixed(1));
    this.telemetry.power_w = Number((rawVolt * rawCur).toFixed(2));
    this.telemetry.score = score;
    this.telemetry.state = nextState;
    this.telemetry.state_name = stateNames[nextState];
    this.telemetry.z_temp = Number(z.temp_c.toFixed(2));
    this.telemetry.z_vib = Number(z.vib_velocity_mms.toFixed(2));
    this.telemetry.z_cur = Number(z.current_a.toFixed(2));
    this.telemetry.z_volt = Number(z.bus_v.toFixed(2));
    this.telemetry.z_shock = Number(z.shock_rate.toFixed(2));
    this.telemetry.top_channel = topChannel;
    this.telemetry.last_packet = new Date();

    this.appendHistory();
    this.emit('telemetry', this.telemetry);
  }

  // -------------------------------------------------------------------------
  // Real-Time Mode: Polling ESP32 / Server REST API
  // -------------------------------------------------------------------------
  async fetchHttpTelemetry() {
    try {
      const res = await fetch(`${this.serverUrl}/api/telemetry`, { cache: 'no-cache' });
      if (res.ok) {
        const data = await res.json();
        Object.assign(this.telemetry, data);
        this.telemetry.last_packet = new Date();
        this.serverOnline = true;
        this.esp32Online = data.esp32_online || false;
        this.appendHistory();
        this.emit('telemetry', this.telemetry);
      } else {
        this.serverOnline = false;
        this.esp32Online = false;
      }
    } catch (e) {
      this.serverOnline = false;
      this.esp32Online = false;
    }
  }

  appendHistory() {
    const timeLabel = new Date().toLocaleTimeString();
    const maxPoints = 30;

    this.history.labels.push(timeLabel);
    this.history.temp.push(this.telemetry.temp_c);
    this.history.hum.push(this.telemetry.humidity_pct);
    this.history.vib_velocity.push(this.telemetry.vib_velocity_mms);
    this.history.vib_peak.push(this.telemetry.vib_peak_g);
    this.history.shock.push(this.telemetry.shock_rate);
    this.history.cur_ina.push(this.telemetry.current_a);
    this.history.cur_acs.push(this.telemetry.current_acs_a);
    this.history.bus_v.push(this.telemetry.bus_v);
    this.history.power.push(this.telemetry.power_w);
    this.history.score.push(this.telemetry.score);
    this.history.z_vib.push(this.telemetry.z_vib);
    this.history.z_cur.push(this.telemetry.z_cur);
    this.history.z_temp.push(this.telemetry.z_temp);

    if (this.history.labels.length > maxPoints) {
      Object.keys(this.history).forEach(k => this.history[k].shift());
    }
  }
}

// Global instantiation
window.dataService = new DataService();
