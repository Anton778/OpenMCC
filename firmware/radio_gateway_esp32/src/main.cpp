#include <Arduino.h>
#include <Preferences.h>
#include <RadioLib.h>
#include <SPI.h>

/*
 * ЦУП Альтаир — Radio Gateway
 * Firmware version: 0.2.0
 * Target: ESP32-WROOM-32 / generic esp32dev
 *
 * Technoprom 2026 default CC1101 profile is intentionally compatible with
 * the uploaded transmitter sketch that calls:
 *
 *     radio.begin(434.00f);
 *     radio.setOutputPower(5);
 *
 * RadioLib 7.7.1 defaults for CC1101 begin(freq) are:
 * 434 MHz, 4.8 kbps, 5 kHz deviation, 58 kHz RX bandwidth, 2-FSK profile.
 *
 * USB protocol, 115200 baud:
 *   $CMD,RADIO,TYPE=CC1101,FREQ=434.000,POWER=5,RATE=4.8,MOD=2FSK,BW=58,CRC=1,CCA=1
 *   $CMD,RADIO,TYPE=E32,FREQ=433,POWER=30,AIR=2.4,UART=9600,MODE=TRANSPARENT,FEC=1
 *   $CMD,RADIO_STATUS
 *   $CMD,GATEWAY_INFO
 *   $CMD,GATEWAY_PING
 *   $CMD,RADIO_OFF
 *
 * Any other $CMD,... line is forwarded to the spacecraft.
 *
 * Accepted spacecraft telemetry:
 *   $TM,<ID>,<PACKET>,<UPTIME>,<VOLT>,<PANEL_POWER>,<TEMP>
 *   $TEL,ID=...,VOLT=...,PANEL_POWER=...,PACKET=...,UPTIME=...,TEMP=...
 *
 * For CC1101 the gateway appends RSSI, LQI and an estimated SNR. CC1101 does
 * not provide a direct SNR register; SNR is estimated from packet RSSI minus
 * a slowly tracked idle-channel RSSI floor. Treat it as a diagnostic estimate.
 */

namespace AltairGateway {

constexpr char FW_VERSION[] = "0.2.0";
constexpr uint32_t USB_BAUD = 115200;
constexpr size_t MAX_LINE_LENGTH = 220;
constexpr uint32_t E32_AUX_TIMEOUT_MS = 2500;

// CC1101 wiring: ESP32-WROOM-32.
constexpr uint8_t CC_SCK = 18;
constexpr uint8_t CC_MISO = 19;
constexpr uint8_t CC_MOSI = 23;
constexpr uint8_t CC_CS = 21;
constexpr uint8_t CC_GDO0 = 4;
constexpr uint8_t CC_GDO2 = 27;

// E32-433T30D wiring.
constexpr uint8_t E32_RX = 16;   // ESP32 RX2 <- E32 TXD
constexpr uint8_t E32_TX = 17;   // ESP32 TX2 -> E32 RXD
constexpr uint8_t E32_M0 = 25;
constexpr uint8_t E32_M1 = 26;
constexpr uint8_t E32_AUX = 27;

enum class RadioType : uint8_t {
  None = 0,
  CC1101 = 1,
  E32 = 2,
};

struct CC1101Config {
  float frequency = 434.000f;
  int8_t power = 5;
  float bitRate = 4.8f;
  String modulation = "2FSK";
  bool bandwidthAuto = false;
  float bandwidth = 58.0f;
  bool crc = true;
  bool cca = true;
};

struct E32Config {
  uint16_t frequency = 433;
  uint8_t power = 30;
  float airRate = 2.4f;
  uint32_t uartBaud = 9600;
  String mode = "TRANSPARENT";
  bool fec = true;
};

Preferences preferences;
HardwareSerial e32Serial(2);
CC1101 cc1101 = new Module(CC_CS, CC_GDO0, RADIOLIB_NC, CC_GDO2);

RadioType activeType = RadioType::None;
bool radioReady = false;
CC1101Config ccConfig;
E32Config e32Config;
String usbLineBuffer;
String e32LineBuffer;
volatile bool ccPacketReceived = false;

float ccNoiseFloorDbm = -105.0f;
bool ccNoiseFloorValid = false;
uint32_t lastNoiseSampleMs = 0;

void IRAM_ATTR onCcPacketReceived() {
  ccPacketReceived = true;
}

void sendAck(const String &payload) {
  Serial.print("$ACK,");
  Serial.println(payload);
}

void sendError(const String &payload) {
  Serial.print("$ERR,");
  Serial.println(payload);
}

void sendInfo(const String &payload) {
  Serial.print("$INFO,");
  Serial.println(payload);
}

String radioTypeName(RadioType type) {
  switch (type) {
    case RadioType::CC1101: return "CC1101";
    case RadioType::E32: return "E32";
    default: return "NONE";
  }
}

bool parseParameter(const String &line, const char *key, String &value) {
  const String marker = String(key) + "=";
  int start = line.indexOf(marker);
  if (start < 0) return false;
  start += marker.length();
  int end = line.indexOf(',', start);
  if (end < 0) end = line.length();
  value = line.substring(start, end);
  value.trim();
  return value.length() > 0;
}

bool parseBoolValue(const String &text, bool &value) {
  String normalized = text;
  normalized.trim();
  normalized.toUpperCase();
  if (normalized == "1" || normalized == "TRUE" || normalized == "ON") {
    value = true;
    return true;
  }
  if (normalized == "0" || normalized == "FALSE" || normalized == "OFF") {
    value = false;
    return true;
  }
  return false;
}

bool nearlyEqual(float a, float b) {
  return fabsf(a - b) < 0.01f;
}

bool validCcPower(int value) {
  static const int8_t allowed[] = {-30, -20, -15, -10, 0, 5, 7, 10};
  for (int8_t item : allowed) if (value == item) return true;
  return false;
}

bool validCcBandwidth(float value) {
  static const float allowed[] = {58, 68, 81, 102, 116, 135, 162, 203, 232, 270, 325, 406, 464, 541, 650, 812};
  for (float item : allowed) if (nearlyEqual(value, item)) return true;
  return false;
}

bool validE32Power(int value) {
  return value == 21 || value == 24 || value == 27 || value == 30;
}

bool validE32AirRate(float value) {
  return nearlyEqual(value, 2.4f) || nearlyEqual(value, 4.8f) ||
         nearlyEqual(value, 9.6f) || nearlyEqual(value, 19.2f);
}

bool validE32Uart(uint32_t baud) {
  switch (baud) {
    case 1200:
    case 2400:
    case 4800:
    case 9600:
    case 19200:
    case 38400:
    case 57600:
    case 115200:
      return true;
    default:
      return false;
  }
}

void persistRadioType() {
  preferences.putUChar("type", static_cast<uint8_t>(activeType));
}

void saveCcConfig() {
  preferences.putFloat("ccFreq", ccConfig.frequency);
  preferences.putChar("ccPower", ccConfig.power);
  preferences.putFloat("ccRate", ccConfig.bitRate);
  preferences.putString("ccMod", ccConfig.modulation);
  preferences.putBool("ccBwAuto", ccConfig.bandwidthAuto);
  preferences.putFloat("ccBw", ccConfig.bandwidth);
  preferences.putBool("ccCrc", ccConfig.crc);
  preferences.putBool("ccCca", ccConfig.cca);
}

void saveE32Config() {
  preferences.putUShort("e32Freq", e32Config.frequency);
  preferences.putUChar("e32Power", e32Config.power);
  preferences.putFloat("e32Air", e32Config.airRate);
  preferences.putULong("e32Uart", e32Config.uartBaud);
  preferences.putString("e32Mode", e32Config.mode);
  preferences.putBool("e32Fec", e32Config.fec);
}

void loadStoredConfig() {
  activeType = static_cast<RadioType>(preferences.getUChar("type", 0));
  if (activeType != RadioType::CC1101 && activeType != RadioType::E32) activeType = RadioType::None;

  ccConfig.frequency = preferences.getFloat("ccFreq", 434.000f);
  ccConfig.power = preferences.getChar("ccPower", 5);
  ccConfig.bitRate = preferences.getFloat("ccRate", 4.8f);
  ccConfig.modulation = preferences.getString("ccMod", "2FSK");
  ccConfig.bandwidthAuto = preferences.getBool("ccBwAuto", false);
  ccConfig.bandwidth = preferences.getFloat("ccBw", 58.0f);
  ccConfig.crc = preferences.getBool("ccCrc", true);
  ccConfig.cca = preferences.getBool("ccCca", true);

  e32Config.frequency = preferences.getUShort("e32Freq", 433);
  e32Config.power = preferences.getUChar("e32Power", 30);
  e32Config.airRate = preferences.getFloat("e32Air", 2.4f);
  e32Config.uartBaud = preferences.getULong("e32Uart", 9600);
  e32Config.mode = preferences.getString("e32Mode", "TRANSPARENT");
  e32Config.fec = preferences.getBool("e32Fec", true);
}

void stopCurrentRadio() {
  radioReady = false;

  if (activeType == RadioType::CC1101) {
    cc1101.clearPacketReceivedAction();
    cc1101.standby();
  }

  if (activeType == RadioType::E32) {
    e32Serial.end();
    pinMode(E32_M0, OUTPUT);
    pinMode(E32_M1, OUTPUT);
    digitalWrite(E32_M0, LOW);
    digitalWrite(E32_M1, LOW);
  }
}

bool initializeCc1101(bool verbose = true) {
  stopCurrentRadio();
  activeType = RadioType::CC1101;

  if (ccConfig.frequency < 387.0f || ccConfig.frequency > 464.0f) {
    if (verbose) sendError("RADIO_CONFIG,CC1101_FREQ_RANGE=387..464");
    return false;
  }
  if (!validCcPower(ccConfig.power)) {
    if (verbose) sendError("RADIO_CONFIG,CC1101_POWER=-30|-20|-15|-10|0|5|7|10");
    return false;
  }
  if (ccConfig.bitRate < 0.025f || ccConfig.bitRate > 600.0f) {
    if (verbose) sendError("RADIO_CONFIG,CC1101_RATE_RANGE=0.025..600");
    return false;
  }
  if (!ccConfig.bandwidthAuto && !validCcBandwidth(ccConfig.bandwidth)) {
    if (verbose) sendError("RADIO_CONFIG,CC1101_BW_UNSUPPORTED");
    return false;
  }

  ccConfig.modulation.toUpperCase();
  ccConfig.modulation.replace("-", "");
  if (ccConfig.modulation != "2FSK" && ccConfig.modulation != "GFSK" &&
      ccConfig.modulation != "4FSK" && ccConfig.modulation != "OOK") {
    if (verbose) sendError("RADIO_CONFIG,CC1101_MOD=2FSK|GFSK|4FSK|OOK");
    return false;
  }

  SPI.begin(CC_SCK, CC_MISO, CC_MOSI, CC_CS);

  const float frequencyDeviation = constrain(ccConfig.bitRate * 0.5f, 5.0f, 380.0f);
  const float initialBandwidth = ccConfig.bandwidthAuto ? 812.0f : ccConfig.bandwidth;
  int16_t state;

  if (ccConfig.modulation == "4FSK") {
    state = cc1101.beginFSK4(ccConfig.frequency, ccConfig.bitRate, frequencyDeviation,
                             initialBandwidth, ccConfig.power, 16);
  } else {
    state = cc1101.begin(ccConfig.frequency, ccConfig.bitRate, frequencyDeviation,
                         initialBandwidth, ccConfig.power, 16);
  }

  if (state != RADIOLIB_ERR_NONE) {
    if (verbose) sendError("CC1101_INIT,CODE=" + String(state));
    return false;
  }

  if (ccConfig.modulation == "OOK") {
    state = cc1101.setOOK(true);
  } else {
    state = cc1101.setOOK(false);
    if (state == RADIOLIB_ERR_NONE) {
      state = cc1101.setDataShaping(
        ccConfig.modulation == "GFSK" ? RADIOLIB_SHAPING_0_5 : RADIOLIB_SHAPING_NONE
      );
    }
  }
  if (state != RADIOLIB_ERR_NONE) {
    if (verbose) sendError("CC1101_MODULATION,CODE=" + String(state));
    return false;
  }

  if (ccConfig.bandwidthAuto) {
    state = cc1101.autoSetRxBandwidth();
    if (state != RADIOLIB_ERR_NONE) {
      if (verbose) sendError("CC1101_AUTO_BW,CODE=" + String(state));
      return false;
    }
  }

  state = cc1101.setCrcFiltering(ccConfig.crc);
  if (state != RADIOLIB_ERR_NONE) {
    if (verbose) sendError("CC1101_CRC,CODE=" + String(state));
    return false;
  }

  ccPacketReceived = false;
  ccNoiseFloorDbm = -105.0f;
  ccNoiseFloorValid = false;
  lastNoiseSampleMs = millis();

  cc1101.setPacketReceivedAction(onCcPacketReceived);
  state = cc1101.startReceive();
  if (state != RADIOLIB_ERR_NONE) {
    if (verbose) sendError("CC1101_RX_START,CODE=" + String(state));
    return false;
  }

  radioReady = true;
  if (verbose) {
    sendInfo("RADIO_READY,TYPE=CC1101,FREQ=" + String(ccConfig.frequency, 3) +
             ",RATE=" + String(ccConfig.bitRate, 1) +
             ",MOD=" + ccConfig.modulation +
             ",BW=" + (ccConfig.bandwidthAuto ? String("AUTO") : String(ccConfig.bandwidth, 0)));
  }
  return true;
}

bool waitE32Aux(uint32_t timeoutMs = E32_AUX_TIMEOUT_MS) {
  const uint32_t started = millis();
  while (digitalRead(E32_AUX) != HIGH) {
    if (millis() - started >= timeoutMs) return false;
    delay(2);
  }
  delay(3);
  return true;
}

void setE32Mode(bool programming) {
  digitalWrite(E32_M0, programming ? HIGH : LOW);
  digitalWrite(E32_M1, programming ? HIGH : LOW);
  delay(45);
}

uint8_t e32UartCode(uint32_t baud) {
  switch (baud) {
    case 1200: return 0;
    case 2400: return 1;
    case 4800: return 2;
    case 9600: return 3;
    case 19200: return 4;
    case 38400: return 5;
    case 57600: return 6;
    case 115200: return 7;
    default: return 3;
  }
}

uint8_t e32AirCode(float airRate) {
  if (nearlyEqual(airRate, 2.4f)) return 2;
  if (nearlyEqual(airRate, 4.8f)) return 3;
  if (nearlyEqual(airRate, 9.6f)) return 4;
  return 5;
}

uint8_t e32PowerCode(uint8_t power) {
  switch (power) {
    case 30: return 0;
    case 27: return 1;
    case 24: return 2;
    default: return 3;
  }
}

bool configureE32Hardware(uint32_t oldBaud, bool verbose = true) {
  if (e32Config.frequency < 410 || e32Config.frequency > 441) {
    if (verbose) sendError("RADIO_CONFIG,E32_FREQ_RANGE=410..441");
    return false;
  }
  if (!validE32Power(e32Config.power)) {
    if (verbose) sendError("RADIO_CONFIG,E32_POWER=21|24|27|30");
    return false;
  }
  if (!validE32AirRate(e32Config.airRate)) {
    if (verbose) sendError("RADIO_CONFIG,E32_AIR=2.4|4.8|9.6|19.2");
    return false;
  }
  if (!validE32Uart(e32Config.uartBaud)) {
    if (verbose) sendError("RADIO_CONFIG,E32_UART_UNSUPPORTED");
    return false;
  }

  e32Config.mode.toUpperCase();
  if (e32Config.mode != "TRANSPARENT" && e32Config.mode != "FIXED") {
    if (verbose) sendError("RADIO_CONFIG,E32_MODE=TRANSPARENT|FIXED");
    return false;
  }

  pinMode(E32_M0, OUTPUT);
  pinMode(E32_M1, OUTPUT);
  pinMode(E32_AUX, INPUT);
  digitalWrite(E32_M0, LOW);
  digitalWrite(E32_M1, LOW);

  e32Serial.end();
  e32Serial.begin(oldBaud, SERIAL_8N1, E32_RX, E32_TX);
  delay(80);

  if (!waitE32Aux()) {
    if (verbose) sendError("E32_AUX_TIMEOUT,PHASE=BEFORE_CONFIG");
    return false;
  }

  setE32Mode(true);
  if (!waitE32Aux()) {
    if (verbose) sendError("E32_AUX_TIMEOUT,PHASE=PROGRAM_MODE");
    setE32Mode(false);
    return false;
  }

  while (e32Serial.available()) e32Serial.read();

  const uint8_t sped = static_cast<uint8_t>((e32UartCode(e32Config.uartBaud) << 3) |
                                             e32AirCode(e32Config.airRate));
  const uint8_t channel = static_cast<uint8_t>(e32Config.frequency - 410);
  uint8_t option = 0x40;
  if (e32Config.mode == "FIXED") option |= 0x80;
  if (e32Config.fec) option |= 0x04;
  option |= e32PowerCode(e32Config.power);

  const uint8_t frame[6] = {0xC0, 0x00, 0x00, sped, channel, option};
  e32Serial.write(frame, sizeof(frame));
  e32Serial.flush();

  if (!waitE32Aux()) {
    if (verbose) sendError("E32_AUX_TIMEOUT,PHASE=WRITE_CONFIG");
    setE32Mode(false);
    return false;
  }

  uint8_t response[6] = {0};
  size_t responseLength = 0;
  const uint32_t responseStart = millis();
  while (responseLength < sizeof(response) && millis() - responseStart < 500) {
    while (e32Serial.available() && responseLength < sizeof(response)) {
      response[responseLength++] = static_cast<uint8_t>(e32Serial.read());
    }
    delay(2);
  }

  setE32Mode(false);
  e32Serial.end();
  e32Serial.begin(e32Config.uartBaud, SERIAL_8N1, E32_RX, E32_TX);
  delay(80);

  if (!waitE32Aux()) {
    if (verbose) sendError("E32_AUX_TIMEOUT,PHASE=NORMAL_MODE");
    return false;
  }

  if (responseLength != 6 || (response[0] != 0xC0 && response[0] != 0xC1)) {
    if (verbose) sendError("E32_CONFIG_NO_VALID_RESPONSE");
    return false;
  }

  return true;
}

bool initializeE32(bool writeConfiguration, uint32_t oldBaud, bool verbose = true) {
  stopCurrentRadio();
  activeType = RadioType::E32;

  pinMode(E32_M0, OUTPUT);
  pinMode(E32_M1, OUTPUT);
  pinMode(E32_AUX, INPUT);
  digitalWrite(E32_M0, LOW);
  digitalWrite(E32_M1, LOW);

  if (writeConfiguration) {
    if (!configureE32Hardware(oldBaud, verbose)) return false;
  } else {
    e32Serial.begin(e32Config.uartBaud, SERIAL_8N1, E32_RX, E32_TX);
    delay(80);
    if (!waitE32Aux(800)) {
      if (verbose) sendError("E32_AUX_NOT_READY");
      return false;
    }
  }

  radioReady = true;
  if (verbose) sendInfo("RADIO_READY,TYPE=E32");
  return true;
}

void sendRadioStatus() {
  String prefix = "RADIO,TYPE=" + radioTypeName(activeType) + ",READY=" + String(radioReady ? 1 : 0);

  if (activeType == RadioType::CC1101) {
    sendInfo(prefix +
      ",FREQ=" + String(ccConfig.frequency, 3) +
      ",POWER=" + String(ccConfig.power) +
      ",RATE=" + String(ccConfig.bitRate, 1) +
      ",MOD=" + ccConfig.modulation +
      ",BW=" + (ccConfig.bandwidthAuto ? String("AUTO") : String(ccConfig.bandwidth, 0)) +
      ",CRC=" + String(ccConfig.crc ? 1 : 0) +
      ",CCA=" + String(ccConfig.cca ? 1 : 0));
    return;
  }

  if (activeType == RadioType::E32) {
    sendInfo(prefix +
      ",FREQ=" + String(e32Config.frequency) +
      ",POWER=" + String(e32Config.power) +
      ",AIR=" + String(e32Config.airRate, 1) +
      ",UART=" + String(e32Config.uartBaud) +
      ",MODE=" + e32Config.mode +
      ",FEC=" + String(e32Config.fec ? 1 : 0));
    return;
  }

  sendInfo(prefix);
}

bool applyCcCommand(const String &line) {
  String value;
  CC1101Config candidate = ccConfig;

  if (parseParameter(line, "FREQ", value)) candidate.frequency = value.toFloat();
  if (parseParameter(line, "POWER", value)) candidate.power = static_cast<int8_t>(value.toInt());
  if (parseParameter(line, "RATE", value)) candidate.bitRate = value.toFloat();
  if (parseParameter(line, "MOD", value)) {
    value.toUpperCase();
    value.replace("-", "");
    candidate.modulation = value;
  }
  if (parseParameter(line, "BW", value)) {
    value.toUpperCase();
    candidate.bandwidthAuto = value == "AUTO";
    if (!candidate.bandwidthAuto) candidate.bandwidth = value.toFloat();
  }
  if (parseParameter(line, "CRC", value) && !parseBoolValue(value, candidate.crc)) {
    sendError("RADIO_CONFIG,CRC=0|1");
    return false;
  }
  if (parseParameter(line, "CCA", value) && !parseBoolValue(value, candidate.cca)) {
    sendError("RADIO_CONFIG,CCA=0|1");
    return false;
  }

  ccConfig = candidate;
  if (!initializeCc1101(true)) return false;
  saveCcConfig();
  persistRadioType();
  sendAck("RADIO_CONFIG_APPLIED,TYPE=CC1101");
  sendRadioStatus();
  return true;
}

bool applyE32Command(const String &line) {
  String value;
  E32Config candidate = e32Config;
  const uint32_t previousUartBaud = e32Config.uartBaud;

  if (parseParameter(line, "FREQ", value)) candidate.frequency = static_cast<uint16_t>(value.toInt());
  if (parseParameter(line, "POWER", value)) candidate.power = static_cast<uint8_t>(value.toInt());
  if (parseParameter(line, "AIR", value)) candidate.airRate = value.toFloat();
  if (parseParameter(line, "UART", value)) candidate.uartBaud = static_cast<uint32_t>(value.toInt());
  if (parseParameter(line, "MODE", value)) {
    value.toUpperCase();
    candidate.mode = value;
  }
  if (parseParameter(line, "FEC", value) && !parseBoolValue(value, candidate.fec)) {
    sendError("RADIO_CONFIG,FEC=0|1");
    return false;
  }

  e32Config = candidate;
  if (!initializeE32(true, previousUartBaud, true)) return false;
  saveE32Config();
  persistRadioType();
  sendAck("RADIO_CONFIG_APPLIED,TYPE=E32");
  sendRadioStatus();
  return true;
}

void processRadioConfigCommand(const String &line) {
  String type;
  if (!parseParameter(line, "TYPE", type)) {
    sendError("RADIO_CONFIG,TYPE_REQUIRED");
    return;
  }
  type.toUpperCase();

  if (type == "CC1101") {
    applyCcCommand(line);
    return;
  }
  if (type == "E32" || type == "E32-433T30D") {
    applyE32Command(line);
    return;
  }
  sendError("RADIO_CONFIG,TYPE=CC1101|E32");
}

bool transmitCc1101(const String &payload) {
  if (!radioReady) return false;
  cc1101.standby();

  if (ccConfig.cca) {
    const int16_t scan = cc1101.scanChannel();
    if (scan != RADIOLIB_CHANNEL_FREE) {
      cc1101.startReceive();
      sendError("RADIO_BUSY");
      return false;
    }
  }

  const int16_t state = cc1101.transmit(payload.c_str());
  cc1101.startReceive();
  if (state != RADIOLIB_ERR_NONE) {
    sendError("RADIO_TX,TYPE=CC1101,CODE=" + String(state));
    return false;
  }
  return true;
}

bool transmitE32(const String &payload) {
  if (!radioReady) return false;
  if (e32Config.mode == "FIXED") {
    sendError("E32_FIXED_DESTINATION_NOT_CONFIGURED");
    return false;
  }
  if (!waitE32Aux()) {
    sendError("E32_AUX_TIMEOUT,PHASE=BEFORE_TX");
    return false;
  }
  e32Serial.print(payload);
  e32Serial.print('\n');
  e32Serial.flush();
  if (!waitE32Aux()) {
    sendError("E32_AUX_TIMEOUT,PHASE=AFTER_TX");
    return false;
  }
  return true;
}

void forwardToRadio(const String &line) {
  if (!radioReady || activeType == RadioType::None) {
    sendError("RADIO_NOT_READY");
    return;
  }
  if (line.length() > MAX_LINE_LENGTH) {
    sendError("RADIO_PAYLOAD_TOO_LONG");
    return;
  }

  bool ok = false;
  if (activeType == RadioType::CC1101) ok = transmitCc1101(line);
  if (activeType == RadioType::E32) ok = transmitE32(line);
  if (ok) sendAck("RADIO_TX,TYPE=" + radioTypeName(activeType) + ",BYTES=" + String(line.length()));
}

void processUsbLine(String line) {
  line.trim();
  if (line.isEmpty()) return;
  String upper = line;
  upper.toUpperCase();

  if (upper == "$CMD,GATEWAY_PING") {
    sendAck("GATEWAY_PONG");
    return;
  }
  if (upper == "$CMD,GATEWAY_INFO") {
    sendInfo("GATEWAY=ALTAIR,DEVICE=ESP32-WROOM-32,FW=" + String(FW_VERSION) + ",MISSION=TECHNOPROM_2026_MOON");
    return;
  }
  if (upper == "$CMD,RADIO_STATUS") {
    sendRadioStatus();
    return;
  }
  if (upper == "$CMD,RADIO_OFF") {
    stopCurrentRadio();
    activeType = RadioType::None;
    persistRadioType();
    sendAck("RADIO_OFF");
    return;
  }
  if (upper.startsWith("$CMD,RADIO,")) {
    processRadioConfigCommand(upper);
    return;
  }
  if (upper.startsWith("$CMD,")) {
    forwardToRadio(line);
    return;
  }
  sendError("UNKNOWN_USB_LINE");
}

void pollUsb() {
  while (Serial.available()) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\r') continue;
    if (c == '\n') {
      processUsbLine(usbLineBuffer);
      usbLineBuffer = "";
      continue;
    }
    if (usbLineBuffer.length() < MAX_LINE_LENGTH) {
      usbLineBuffer += c;
    } else {
      usbLineBuffer = "";
      sendError("USB_LINE_TOO_LONG");
    }
  }
}

String stripApplicationChecksum(const String &payload, String &checksum) {
  const int star = payload.lastIndexOf('*');
  if (star < 0) {
    checksum = "";
    return payload;
  }
  checksum = payload.substring(star + 1);
  checksum.trim();
  return payload.substring(0, star);
}

void appendGroundMetrics(String &line, float rssi, float snr, uint8_t lqi) {
  line += ",RSSI=" + String(rssi, 1);
  line += ",SNR=" + String(snr, 1);
  line += ",LQI=" + String(lqi);
}

String normalizeTmPayload(const String &payload, float rssi, float snr, uint8_t lqi) {
  String checksum;
  const String body = stripApplicationChecksum(payload, checksum);
  String content = body;
  content.remove(0, 3); // remove "$TM"
  if (content.startsWith(",")) content.remove(0, 1);

  if (content.indexOf('=') >= 0) {
    String line = "$TEL," + content;
    appendGroundMetrics(line, rssi, snr, lqi);
    if (checksum.length()) line += ",CHECKSUM=" + checksum;
    return line;
  }

  String fields[10];
  size_t count = 0;
  int start = 0;
  while (count < 10 && start <= content.length()) {
    int comma = content.indexOf(',', start);
    if (comma < 0) comma = content.length();
    fields[count++] = content.substring(start, comma);
    fields[count - 1].trim();
    start = comma + 1;
    if (comma >= content.length()) break;
  }

  String line;
  if (count >= 8) {
    // Legacy IntroSat: ID,PACKET,UPTIME,LIGHT,VOLT,TEMP,MODE,ERRORS
    line = "$TEL,ID=" + fields[0] +
           ",PACKET=" + fields[1] +
           ",UPTIME=" + fields[2] +
           ",LIGHT=" + fields[3] +
           ",VOLT=" + fields[4] +
           ",TEMP=" + fields[5] +
           ",MODE=" + fields[6] +
           ",ERRORS=" + fields[7];
  } else if (count >= 6) {
    // Technoprom v5: ID,PACKET,UPTIME,VOLT,PANEL_POWER,TEMP
    line = "$TEL,ID=" + fields[0] +
           ",PACKET=" + fields[1] +
           ",UPTIME=" + fields[2] +
           ",VOLT=" + fields[3] +
           ",PANEL_POWER=" + fields[4] +
           ",TEMP=" + fields[5];
  } else {
    return "";
  }

  appendGroundMetrics(line, rssi, snr, lqi);
  if (checksum.length()) line += ",CHECKSUM=" + checksum;
  return line;
}

void forwardCcPayloadToUsb(String payload, float rssi, uint8_t lqi, float snr) {
  payload.trim();
  if (payload.isEmpty()) return;

  if (payload.startsWith("$TM")) {
    const String normalized = normalizeTmPayload(payload, rssi, snr, lqi);
    if (normalized.length()) {
      Serial.println(normalized);
      return;
    }
  }

  if (payload.startsWith("$TEL")) {
    String checksum;
    String body = stripApplicationChecksum(payload, checksum);
    appendGroundMetrics(body, rssi, snr, lqi);
    if (checksum.length()) body += ",CHECKSUM=" + checksum;
    Serial.println(body);
    return;
  }

  if (payload.indexOf('=') >= 0) {
    String line = "$TEL," + payload;
    appendGroundMetrics(line, rssi, snr, lqi);
    Serial.println(line);
    return;
  }

  // The uploaded Transmit.ino currently sends a free-form test string.
  // Preserve it as an INFO event so the operator can confirm RF reception.
  payload.replace("\r", " ");
  payload.replace("\n", " ");
  if (payload.length() > 120) payload = payload.substring(0, 120);
  sendInfo("RF_RAW,TYPE=CC1101,RSSI=" + String(rssi, 1) +
           ",SNR=" + String(snr, 1) +
           ",LQI=" + String(lqi) +
           ",TEXT=" + payload);
}

void pollCcNoiseFloor() {
  if (!radioReady || activeType != RadioType::CC1101 || ccPacketReceived) return;
  const uint32_t now = millis();
  if (now - lastNoiseSampleMs < 50) return;
  lastNoiseSampleMs = now;

  const float sample = cc1101.getRSSI();
  // Ignore obvious active-signal samples; track only plausible idle noise.
  if (sample > -130.0f && sample < -75.0f) {
    if (!ccNoiseFloorValid) {
      ccNoiseFloorDbm = sample;
      ccNoiseFloorValid = true;
    } else {
      ccNoiseFloorDbm = 0.92f * ccNoiseFloorDbm + 0.08f * sample;
    }
  }
}

void pollCc1101() {
  if (!radioReady || activeType != RadioType::CC1101 || !ccPacketReceived) return;
  ccPacketReceived = false;

  String payload;
  const int16_t state = cc1101.readData(payload);
  const float rssi = cc1101.getRSSI();
  const uint8_t lqi = cc1101.getLQI();
  const float noise = ccNoiseFloorValid ? ccNoiseFloorDbm : -105.0f;
  const float snrEstimate = constrain(rssi - noise, -10.0f, 60.0f);

  if (state == RADIOLIB_ERR_NONE) {
    forwardCcPayloadToUsb(payload, rssi, lqi, snrEstimate);
  } else if (state == RADIOLIB_ERR_CRC_MISMATCH) {
    sendError("RADIO_RX_CRC");
  } else {
    sendError("RADIO_RX,TYPE=CC1101,CODE=" + String(state));
  }

  cc1101.startReceive();
}

void pollE32() {
  if (!radioReady || activeType != RadioType::E32) return;
  while (e32Serial.available()) {
    const char c = static_cast<char>(e32Serial.read());
    if (c == '\r') continue;
    if (c == '\n') {
      e32LineBuffer.trim();
      if (!e32LineBuffer.isEmpty()) Serial.println(e32LineBuffer);
      e32LineBuffer = "";
      continue;
    }
    if (e32LineBuffer.length() < MAX_LINE_LENGTH) {
      e32LineBuffer += c;
    } else {
      e32LineBuffer = "";
      sendError("E32_RX_LINE_TOO_LONG");
    }
  }
}

void restoreRadioAfterBoot() {
  if (activeType == RadioType::CC1101) {
    if (!initializeCc1101(false)) {
      radioReady = false;
      sendError("RADIO_RESTORE_FAILED,TYPE=CC1101");
    }
    return;
  }
  if (activeType == RadioType::E32) {
    if (!initializeE32(false, e32Config.uartBaud, false)) {
      radioReady = false;
      sendError("RADIO_RESTORE_FAILED,TYPE=E32");
    }
  }
}

} // namespace AltairGateway

void setup() {
  using namespace AltairGateway;

  Serial.begin(USB_BAUD);
  delay(350);
  usbLineBuffer.reserve(MAX_LINE_LENGTH + 8);
  e32LineBuffer.reserve(MAX_LINE_LENGTH + 8);

  preferences.begin("altair-rf", false);
  loadStoredConfig();

  sendInfo("GATEWAY=ALTAIR,DEVICE=ESP32-WROOM-32,FW=" + String(FW_VERSION) + ",BOOT=1,MISSION=TECHNOPROM_2026_MOON");
  restoreRadioAfterBoot();
  sendRadioStatus();
}

void loop() {
  using namespace AltairGateway;
  pollUsb();
  pollCcNoiseFloor();
  pollCc1101();
  pollE32();
  delay(1);
}
