/**
 * IPPAD ChartsManager - Real-Time Dark SCADA Waveform Charts
 * Configured with exact Certified Industrial Specifications:
 * - Bearing Temp: 30-65 °C (Critical Limit Line: 85 °C)
 * - Vibration RMS Velocity: 0.28 mm/s (Critical Limit Line: 7.1 mm/s)
 * - Vibration Peak Accel: 0-1 g (Critical Limit Line: 2.0 g)
 * - Shock Rate: 0-5 ev/min (Critical Limit Line: 15 ev/min)
 * - Load Current: 0-100% rated [2.0A] (Critical Limit Line: 110% [2.2A])
 * - DC Bus Voltage: 95-100% nominal [5.0V] (Critical Sag Line: 90% [4.5V])
 * - Ambient Humidity: 20-70 %RH (Upper Critical Line: 70 %RH)
 */

class ChartsManager {
  constructor(dataService) {
    this.dataService = dataService;
    this.charts = {};
    this.isPaused = false;

    this.initCharts();
    this.attachDataListener();
  }

  getBaseChartOptions(unit, color, min = null, max = null) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 250,
        easing: 'easeOutQuart'
      },
      interaction: {
        intersect: false,
        mode: 'index'
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: {
            boxWidth: 10,
            boxHeight: 2,
            color: '#94a3b8',
            font: { family: "'JetBrains Mono', monospace", size: 9 }
          }
        },
        tooltip: {
          backgroundColor: 'rgba(8, 15, 26, 0.95)',
          titleColor: '#ffffff',
          bodyColor: color,
          borderColor: 'rgba(56, 189, 248, 0.3)',
          borderWidth: 1,
          padding: 8,
          displayColors: true,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(2)} ${unit}`
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.04)',
            drawBorder: false
          },
          ticks: {
            color: '#64748b',
            font: { family: "'JetBrains Mono', monospace", size: 9 },
            maxTicksLimit: 6
          }
        },
        y: {
          min: min,
          max: max,
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
            drawBorder: false
          },
          ticks: {
            color: '#94a3b8',
            font: { family: "'JetBrains Mono', monospace", size: 9 },
            callback: (val) => `${val}`
          }
        }
      }
    };
  }

  createLineDataset(label, data, strokeColor, fillColor, isDashed = false, borderWidth = 2) {
    return {
      label: label,
      data: [...data],
      borderColor: strokeColor,
      borderWidth: borderWidth,
      borderDash: isDashed ? [5, 4] : [],
      backgroundColor: fillColor || 'transparent',
      fill: !!fillColor,
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHoverBackgroundColor: strokeColor,
      pointHoverBorderColor: '#ffffff'
    };
  }

  initCharts() {
    if (typeof Chart === 'undefined') {
      setTimeout(() => this.initCharts(), 300);
      return;
    }

    const h = this.dataService.history;

    // 1. Temperature Chart (Orange-red #ff6b3d with 85°C critical limit line)
    const ctxTemp = document.getElementById('chartTemp')?.getContext('2d');
    if (ctxTemp) {
      this.charts.temp = new Chart(ctxTemp, {
        type: 'line',
        data: {
          labels: [...h.labels],
          datasets: [
            this.createLineDataset('Bearing Temp', h.temp, '#ff6b3d', 'rgba(255, 107, 61, 0.12)', false, 2),
            {
              label: 'Critical Limit (85°C)',
              data: Array(60).fill(85),
              borderColor: '#ff0055',
              borderWidth: 1.5,
              borderDash: [6, 4],
              pointRadius: 0,
              fill: false
            }
          ]
        },
        options: this.getBaseChartOptions('°C', '#ff6b3d', 20, 100)
      });
    }

    // 2. Vibration Velocity & Peak Accel (Cyan #00f0ff, Crit: 7.1 mm/s & 2.0g)
    const ctxVib = document.getElementById('chartVib')?.getContext('2d');
    if (ctxVib) {
      this.charts.vib = new Chart(ctxVib, {
        type: 'line',
        data: {
          labels: [...h.labels],
          datasets: [
            this.createLineDataset('RMS Velocity (mm/s)', h.vib_velocity, '#00f0ff', 'rgba(0, 240, 255, 0.12)', false, 2),
            this.createLineDataset('Peak Accel (g)', h.vib_peak, 'rgba(125, 211, 252, 0.9)', null, true, 1.5),
            this.createLineDataset('Shock (ev/min)', h.shock, '#b794f6', null, false, 1.8),
            {
              label: 'Crit RMS (7.1 mm/s)',
              data: Array(60).fill(7.1),
              borderColor: '#ff0055',
              borderWidth: 1.5,
              borderDash: [6, 4],
              pointRadius: 0,
              fill: false
            }
          ]
        },
        options: this.getBaseChartOptions('mm/s / g', '#00f0ff', 0, 12.0)
      });
    }

    // 3. Current Load (INA219 Yellow #ffd60a, ACS712 Orange #ff9100, Crit: 2.2A / 110%)
    const ctxCurr = document.getElementById('chartCurrent')?.getContext('2d');
    if (ctxCurr) {
      this.charts.current = new Chart(ctxCurr, {
        type: 'line',
        data: {
          labels: [...h.labels],
          datasets: [
            this.createLineDataset('INA219 Current', h.cur_ina, '#ffd60a', 'rgba(255, 214, 10, 0.12)', false, 2),
            this.createLineDataset('ACS712 Redundant', h.cur_acs, '#ff9100', null, true, 2),
            {
              label: '110% Rated (2.2A)',
              data: Array(60).fill(2.2),
              borderColor: '#ff0055',
              borderWidth: 1.5,
              borderDash: [5, 4],
              pointRadius: 0,
              fill: false
            }
          ]
        },
        options: this.getBaseChartOptions('A', '#ffd60a', 0, 3.5)
      });
    }

    // 4. Voltage & Power Chart (Bus V #7dd3fc with Sag line 4.5V [90%])
    const ctxVolt = document.getElementById('chartVoltage')?.getContext('2d');
    if (ctxVolt) {
      this.charts.voltage = new Chart(ctxVolt, {
        type: 'line',
        data: {
          labels: [...h.labels],
          datasets: [
            this.createLineDataset('Bus Voltage (V)', h.bus_v, '#7dd3fc', 'rgba(125, 211, 252, 0.1)', false, 2),
            this.createLineDataset('Power (W)', h.power, '#60a5fa', null, false, 2),
            {
              label: '90% Sag Limit (4.5V)',
              data: Array(60).fill(4.5),
              borderColor: '#ff0055',
              borderWidth: 1.5,
              borderDash: [5, 4],
              pointRadius: 0,
              fill: false
            }
          ]
        },
        options: this.getBaseChartOptions('V / W', '#7dd3fc', 3.0, 7.0)
      });
    }

    // 5. Humidity Chart (Green #00ff9d with 20-70% normal zone and 70% threshold)
    const ctxHum = document.getElementById('chartHumidity')?.getContext('2d');
    if (ctxHum) {
      this.charts.humidity = new Chart(ctxHum, {
        type: 'line',
        data: {
          labels: [...h.labels],
          datasets: [
            this.createLineDataset('Ambient Humidity', h.hum, '#00ff9d', 'rgba(0, 255, 157, 0.1)', false, 2),
            {
              label: 'Max Normal (70%)',
              data: Array(60).fill(70),
              borderColor: '#ffb703',
              borderWidth: 1.5,
              borderDash: [5, 4],
              pointRadius: 0,
              fill: false
            },
            {
              label: 'Min Normal (20%)',
              data: Array(60).fill(20),
              borderColor: '#38bdf8',
              borderWidth: 1,
              borderDash: [5, 4],
              pointRadius: 0,
              fill: false
            }
          ]
        },
        options: this.getBaseChartOptions('%RH', '#00ff9d', 0, 100)
      });
    }


  }

  attachDataListener() {
    this.dataService.on('telemetry', () => {
      if (this.isPaused) return;
      this.updateAllCharts();
    });
  }

  updateAllCharts() {
    const h = this.dataService.history;
    const labels = [...h.labels];

    // Temp
    if (this.charts.temp) {
      this.charts.temp.data.labels = labels;
      this.charts.temp.data.datasets[0].data = [...h.temp];
      this.charts.temp.data.datasets[1].data = Array(labels.length).fill(85);
      this.charts.temp.update('none');
    }

    // Vib
    if (this.charts.vib) {
      this.charts.vib.data.labels = labels;
      this.charts.vib.data.datasets[0].data = [...h.vib_velocity];
      this.charts.vib.data.datasets[1].data = [...h.vib_peak];
      this.charts.vib.data.datasets[2].data = [...h.shock];
      this.charts.vib.data.datasets[3].data = Array(labels.length).fill(7.1);
      this.charts.vib.update('none');
    }

    // Current
    if (this.charts.current) {
      this.charts.current.data.labels = labels;
      this.charts.current.data.datasets[0].data = [...h.cur_ina];
      this.charts.current.data.datasets[1].data = [...h.cur_acs];
      this.charts.current.data.datasets[2].data = Array(labels.length).fill(2.2);
      this.charts.current.update('none');
    }

    // Voltage
    if (this.charts.voltage) {
      this.charts.voltage.data.labels = labels;
      this.charts.voltage.data.datasets[0].data = [...h.bus_v];
      this.charts.voltage.data.datasets[1].data = [...h.power];
      this.charts.voltage.data.datasets[2].data = Array(labels.length).fill(4.5);
      this.charts.voltage.update('none');
    }

    // Humidity
    if (this.charts.humidity) {
      this.charts.humidity.data.labels = labels;
      this.charts.humidity.data.datasets[0].data = [...h.hum];
      this.charts.humidity.data.datasets[1].data = Array(labels.length).fill(70);
      this.charts.humidity.data.datasets[2].data = Array(labels.length).fill(20);
      this.charts.humidity.update('none');
    }


  }

  togglePause() {
    this.isPaused = !this.isPaused;
    return this.isPaused;
  }
}

window.ChartsManager = ChartsManager;
