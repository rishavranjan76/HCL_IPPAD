/**
 * TurbomachineVisualizer - Digital Twin 2D Industrial Plant Visualizer
 * Real-time dynamic SVG model of Turbomachinery Cell #4:
 * Shows Motor, Bearing Housing, Rotating Shaft, Impeller, Thermal Glow, and Vibration Waves
 * Configured with certified industrial thresholds:
 *   Normal Temp: 30-65 °C, Critical > 85 °C
 *   Normal Vib: 0.28 mm/s, Critical > 7.1 mm/s
 *   Current: Normal 0-100%, Critical > 110%
 *   Voltage: Normal 95-100%, Critical < 90%
 */

class TurbomachineVisualizer {
  constructor(dataService) {
    this.dataService = dataService;
    
    // DOM Elements
    this.rotorBlades = document.getElementById('twinRotorBlades');
    this.bearingBlock = document.getElementById('twinBearingBlock');
    this.bearingHeatGlow = document.getElementById('twinBearingHeatGlow');
    this.vibWaves = document.getElementById('twinVibWaves');
    this.shockIndicator = document.getElementById('twinShockIndicator');
    this.motorCoilGlow = document.getElementById('twinMotorCoilGlow');
    this.faultBanner = document.getElementById('twinFaultBanner');

    // Telemetry readouts in visualizer
    this.valTwinFreq = document.getElementById('twinValFreq');
    this.valTwinTemp = document.getElementById('twinValTemp');
    this.valTwinVib = document.getElementById('twinValVib');
    this.valTwinCur = document.getElementById('twinValCur');

    this.attachDataListener();
  }

  attachDataListener() {
    this.dataService.on('telemetry', (t) => this.render(t));
  }

  render(t) {
    // 1. Text readouts
    if (this.valTwinFreq) {
      this.valTwinFreq.textContent = `${t.vib_freq_hz.toFixed(1)} Hz (~${Math.round(t.vib_freq_hz * 60)} RPM)`;
    }
    if (this.valTwinTemp) {
      this.valTwinTemp.textContent = `${t.temp_c.toFixed(1)} °C`;
      this.valTwinTemp.style.color = t.temp_c > 85 ? '#ff0055' : (t.temp_c > 65 ? '#ffb703' : 'var(--c-temp)');
    }
    if (this.valTwinVib) {
      this.valTwinVib.textContent = `${t.vib_velocity_mms.toFixed(2)} mm/s`;
      this.valTwinVib.style.color = t.vib_velocity_mms > 7.1 ? '#ff0055' : 'var(--c-vib)';
    }
    if (this.valTwinCur) {
      this.valTwinCur.textContent = `${t.current_a.toFixed(2)} A (${t.current_pct}%)`;
      this.valTwinCur.style.color = t.current_pct > 110 ? '#ff0055' : 'var(--c-cur)';
    }

    // 2. Rotor Speed & Jam Animation
    if (this.rotorBlades) {
      if (t.state === 3 && (t.top_channel === 'current_a' || t.current_pct > 110)) {
        // Rotor Jammed
        this.rotorBlades.style.animationPlayState = 'paused';
      } else {
        this.rotorBlades.style.animationPlayState = 'running';
        const duration = Math.max(0.18, 50 / Math.max(10, t.vib_freq_hz));
        this.rotorBlades.style.animationDuration = `${duration.toFixed(2)}s`;
      }
    }

    // 3. Vibration Shaking & Wave Pulse (Velocity mm/s & Peak g)
    if (this.bearingBlock) {
      if (t.vib_velocity_mms > 2.8 || t.vib_peak_g > 1.2 || t.top_channel === 'vib_velocity_mms') {
        this.bearingBlock.classList.add('shaking');
      } else {
        this.bearingBlock.classList.remove('shaking');
      }
    }

    if (this.vibWaves) {
      // Scale wave opacity with velocity relative to 7.1 mm/s critical limit
      const opacity = Math.min(1.0, Math.max(0.1, t.vib_velocity_mms / 7.1));
      this.vibWaves.style.opacity = opacity;
    }

    // 4. Bearing Thermal Heat Glow (Normal 30-65 °C, Critical > 85 °C)
    if (this.bearingHeatGlow) {
      if (t.temp_c > 65) {
        const heatRatio = Math.min(1.0, (t.temp_c - 65) / 25);
        this.bearingHeatGlow.style.opacity = (heatRatio * 0.95).toFixed(2);
        this.bearingHeatGlow.setAttribute('fill', t.temp_c > 85 ? '#ff0055' : '#ff6b3d');
      } else {
        this.bearingHeatGlow.style.opacity = '0.08';
        this.bearingHeatGlow.setAttribute('fill', '#ff6b3d');
      }
    }

    // 5. Motor Overload Coil Glow (Rated 2.0A, Overload > 110%)
    if (this.motorCoilGlow) {
      if (t.current_pct > 100) {
        this.motorCoilGlow.style.opacity = Math.min(1.0, (t.current_pct - 100) / 25);
      } else {
        this.motorCoilGlow.style.opacity = '0.08';
      }
    }

    // 6. Shock Impact indicator (ev/min)
    if (this.shockIndicator) {
      if (t.shock_rate > 5) {
        this.shockIndicator.style.opacity = '1';
        this.shockIndicator.style.transform = 'scale(1.3)';
      } else {
        this.shockIndicator.style.opacity = '0';
        this.shockIndicator.style.transform = 'scale(1)';
      }
    }

    // 7. Fault Banner in Visualizer
    if (this.faultBanner) {
      if (t.state === 3) {
        this.faultBanner.hidden = false;
        this.faultBanner.style.background = 'rgba(255, 0, 85, 0.92)';
        this.faultBanner.textContent = `🚨 CRITICAL FAULT: ${t.top_channel.replace('_', ' ').toUpperCase()} (Score: ${t.score})`;
      } else if (t.state === 2) {
        this.faultBanner.hidden = false;
        this.faultBanner.style.background = 'rgba(255, 183, 3, 0.9)';
        this.faultBanner.textContent = `⚠️ WATCH ADVISORY: ${t.top_channel.replace('_', ' ').toUpperCase()} Shift (Score: ${t.score})`;
      } else {
        this.faultBanner.hidden = true;
      }
    }
  }
}

window.TurbomachineVisualizer = TurbomachineVisualizer;
