#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_INA219.h>
#include <Adafruit_Sensor.h>
#include <DHT.h>
#include <math.h>

const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* MQTT_HOST = "YOUR_EMQX_HOSTNAME";
const uint16_t MQTT_PORT = 8883;
const char* MQTT_USERNAME = "YOUR_MQTT_USERNAME";
const char* MQTT_PASSWORD = "YOUR_MQTT_PASSWORD";
const char* MQTT_TOPIC = "ippad/telemetry/esp32_gateway_01";
const char* DEVICE_ID = "IPPAD_TEST_01";

#define SDA_PIN 21
#define SCL_PIN 22
#define DHT_PIN 4
#define VIB_PIN 27
#define ACS_PIN 34
#define RELAY1_PIN 26
#define RELAY2_PIN 25

DHT dht(DHT_PIN, DHT11);
Adafruit_MPU6050 mpu;
Adafruit_INA219 ina;
WiFiClientSecure tlsClient;
PubSubClient mqtt(tlsClient);

const float ACS_MV_PER_A = 185.0f;
const float CURRENT_RATED_A = 2.0f;
const float VOLTAGE_REFERENCE_V = 5.0f;
const unsigned long PUBLISH_MS = 2000;

bool mpuOk = false;
bool inaOk = false;
float dhtTempC = NAN, dhtHumidity = NAN, acsOffsetmV = 0;
float vibRmsG = 0, vibPeakG = 0, vibVelocityMmS = 0;
float vibFrequencyHz = 0, shockRate = 0;
float inaCurrentA = 0, acsCurrentA = 0, busVoltageV = 0, powerW = 0;

volatile uint32_t vibCount = 0;
unsigned long lastDht = 0, lastPublish = 0, lastVibWindow = 0;

void IRAM_ATTR onVibration() {
  vibCount++;
}

void relayOff(int pin) {
  pinMode(pin, INPUT);
}

float readAcsMillivolts() {
  uint32_t total = 0;
  for (int i = 0; i < 100; i++) {
    total += analogReadMilliVolts(ACS_PIN);
    delayMicroseconds(200);
  }
  return total / 100.0f;
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.println(WiFi.localIP());
}

void connectMQTT() {
  while (!mqtt.connected()) {
    String clientId = "IPPAD_ESP32_" +
      String((uint32_t)ESP.getEfuseMac(), HEX);
    Serial.print("Connecting EMQX...");
    if (mqtt.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD)) {
      Serial.println("connected");
    } else {
      Serial.printf("failed, state=%d\n", mqtt.state());
      delay(3000);
    }
  }
}

void readDht() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  if (!isnan(h) && !isnan(t)) {
    dhtHumidity = h;
    dhtTempC = t;
  }
}

void sampleMpu() {
  if (!mpuOk) return;

  const int n = 100;
  float x[100], y[100], z[100];
  float mx = 0, my = 0, mz = 0;

  for (int i = 0; i < n; i++) {
    sensors_event_t a, g, temp;
    mpu.getEvent(&a, &g, &temp);
    x[i] = a.acceleration.x;
    y[i] = a.acceleration.y;
    z[i] = a.acceleration.z;
    mx += x[i];
    my += y[i];
    mz += z[i];
    delay(5);
  }

  mx /= n;
  my /= n;
  mz /= n;

  float sumSq = 0, peak = 0;
  float mag[100];

  for (int i = 0; i < n; i++) {
    float dx = x[i] - mx;
    float dy = y[i] - my;
    float dz = z[i] - mz;
    mag[i] = sqrtf(dx * dx + dy * dy + dz * dz);
    sumSq += mag[i] * mag[i];
    if (mag[i] > peak) peak = mag[i];
  }

  float rmsMs2 = sqrtf(sumSq / n);
  vibRmsG = rmsMs2 / 9.80665f;
  vibPeakG = peak / 9.80665f;

  int crossings = 0;
  for (int i = 1; i < n; i++) {
    if (mag[i - 1] <= rmsMs2 && mag[i] > rmsMs2) crossings++;
  }

  vibFrequencyHz = crossings * 100.0f / (2.0f * n);
  if (vibFrequencyHz > 0.5f) {
    vibVelocityMmS = rmsMs2 * 1000.0f /
      (2.0f * PI * vibFrequencyHz);
  } else {
    vibVelocityMmS = 0;
  }
}

void updateShockRate() {
  unsigned long now = millis();
  if (now - lastVibWindow < 1000) return;

  noInterrupts();
  uint32_t count = vibCount;
  vibCount = 0;
  interrupts();

  shockRate = count * 60.0f;
  lastVibWindow = now;
}

void readElectrical() {
  if (inaOk) {
    busVoltageV = ina.getBusVoltage_V();
    inaCurrentA = ina.getCurrent_mA() / 1000.0f;
    powerW = ina.getPower_mW() / 1000.0f;
  }

  acsCurrentA = (readAcsMillivolts() - acsOffsetmV) / ACS_MV_PER_A;
  if (fabsf(acsCurrentA) < 0.03f) acsCurrentA = 0;
}

void publishTelemetry() {
  float currentA = inaOk ? inaCurrentA : acsCurrentA;
  float currentPct = currentA / CURRENT_RATED_A * 100.0f;
  float voltagePct = busVoltageV / VOLTAGE_REFERENCE_V * 100.0f;

  char payload[1300];
  char tempFields[100] = "";
  char humidityFields[50] = "";

  if (!isnan(dhtTempC)) {
    snprintf(tempFields, sizeof(tempFields),
      "\"temperature\":%.2f,\"temp_c\":%.2f,\"temp_src\":\"DHT11\",",
      dhtTempC, dhtTempC);
  }

  if (!isnan(dhtHumidity)) {
    snprintf(humidityFields, sizeof(humidityFields),
      "\"humidity_pct\":%.2f,", dhtHumidity);
  }

  snprintf(payload, sizeof(payload),
    "{"
    "\"device_id\":\"%s\","
    "%s%s"
    "\"vibration\":%.4f,"
    "\"vib_velocity_mms\":%.4f,"
    "\"vib_rms_g\":%.4f,"
    "\"vib_peak_g\":%.4f,"
    "\"vib_freq_hz\":%.2f,"
    "\"frequency\":%.2f,"
    "\"shock_rate\":%.2f,"
    "\"current_a\":%.4f,"
    "\"current_acs_a\":%.4f,"
    "\"current_pct\":%.2f,"
    "\"bus_v\":%.3f,"
    "\"voltage\":%.3f,"
    "\"voltage_pct\":%.2f,"
    "\"power_w\":%.3f,"
    "\"score\":0,"
    "\"anomaly_score\":0,"
    "\"state\":0,"
    "\"state_name\":\"NORMAL\","
    "\"classification\":\"NORMAL\","
    "\"learn_pct\":100,"
    "\"learn_seconds_remaining\":0,"
    "\"z_temp\":0,\"z_vib\":0,\"z_cur\":0,"
    "\"z_volt\":0,\"z_shock\":0,"
    "\"top_channel\":\"none\","
    "\"uptime_s\":%lu"
    "}",
    DEVICE_ID, tempFields, humidityFields,
    vibRmsG, vibVelocityMmS, vibRmsG, vibPeakG,
    vibFrequencyHz, vibFrequencyHz, shockRate,
    currentA, acsCurrentA, currentPct,
    busVoltageV, busVoltageV, voltagePct, powerW,
    millis() / 1000UL
  );

  bool ok = mqtt.publish(MQTT_TOPIC, payload);
  Serial.println("--------------------------------");
  Serial.printf("MQTT publish: %s\n", ok ? "SUCCESS" : "FAILED");
  Serial.println(payload);
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(400000);

  analogReadResolution(12);
  analogSetPinAttenuation(ACS_PIN, ADC_11db);

  dht.begin();
  mpuOk = mpu.begin();
  if (mpuOk) {
    mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
    mpu.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu.setFilterBandwidth(MPU6050_BAND_94_HZ);
  }

  inaOk = ina.begin();

  pinMode(VIB_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(VIB_PIN), onVibration, RISING);

  relayOff(RELAY1_PIN);
  relayOff(RELAY2_PIN);

  delay(1000);
  acsOffsetmV = readAcsMillivolts();
  readDht();
  readElectrical();

  tlsClient.setInsecure();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(1400);
  mqtt.setKeepAlive(60);

  connectWiFi();
  connectMQTT();

  Serial.println("IPPAD real sensor telemetry started");
  Serial.printf("MPU6050: %s\n", mpuOk ? "OK" : "NOT FOUND");
  Serial.printf("INA219: %s\n", inaOk ? "OK" : "NOT FOUND");
  Serial.printf("ACS712 zero offset: %.1f mV\n", acsOffsetmV);
}

void loop() {
  connectWiFi();
  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();

  unsigned long now = millis();

  if (now - lastDht >= 2000) {
    lastDht = now;
    readDht();
  }

  updateShockRate();

  if (now - lastPublish >= PUBLISH_MS) {
    lastPublish = now;
    sampleMpu();
    readElectrical();
    publishTelemetry();
  }
}
