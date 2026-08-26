#include <Arduino.h>
#include <Preferences.h>
#include <RadioLib.h>
#include <SPI.h>

/*
 * ЦУП Альтаир — Radio Gateway v0.3.0
 * Release v6 / Технопром 2026 / Миссия на Луну
 *
 * Основной пакет v6, ровно 29 ASCII-символов:
 *   02,00001,00015,3.00,4.20,1,33
 *
 * Поля:
 *   ID(2), PACKET(5), UPTIME(5), PANEL_POWER(4), VOLT(4), MODE(1), XOR(2 HEX)
 *
 * XOR считается по всем символам до двух HEX-символов контрольной суммы,
 * включая последнюю запятую после MODE.
 *
 * Профиль CC1101 v6:
 *   435.000 MHz, 4.8 kbps, 2-FSK, deviation 5 kHz,
 *   RX BW 58 kHz, TX power 5 dBm, preamble 16 bits.
 */

namespace AltairGateway {

constexpr char FW_VERSION[] = "0.3.0";
constexpr uint8_t CONFIG_SCHEMA = 6;
constexpr uint32_t USB_BAUD = 115200;
constexpr size_t MAX_LINE_LENGTH = 220;
constexpr uint32_t E32_AUX_TIMEOUT_MS = 2500;

constexpr uint8_t CC_SCK = 18;
constexpr uint8_t CC_MISO = 19;
constexpr uint8_t CC_MOSI = 23;
constexpr uint8_t CC_CS = 21;
constexpr uint8_t CC_GDO0 = 4;
constexpr uint8_t CC_GDO2 = 27;

constexpr uint8_t E32_RX = 16;
constexpr uint8_t E32_TX = 17;
constexpr uint8_t E32_M0 = 25;
constexpr uint8_t E32_M1 = 26;
constexpr uint8_t E32_AUX = 27;

enum class RadioType : uint8_t { None = 0, CC1101 = 1, E32 = 2 };

struct CCConfig {
  float frequency = 435.000f;
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

Preferences prefs;
HardwareSerial e32Serial(2);
CC1101 cc1101 = new Module(CC_CS, CC_GDO0, RADIOLIB_NC, CC_GDO2);

RadioType activeType = RadioType::None;
CCConfig cc;
E32Config e32;
bool radioReady = false;
volatile bool ccPacketReceived = false;
String usbLine;
String e32Line;
float noiseFloorDbm = -105.0f;
bool noiseValid = false;
uint32_t lastNoiseSampleMs = 0;

void IRAM_ATTR onCcPacket() { ccPacketReceived = true; }
void ack(const String &s) { Serial.print("$ACK,"); Serial.println(s); }
void err(const String &s) { Serial.print("$ERR,"); Serial.println(s); }
void info(const String &s) { Serial.print("$INFO,"); Serial.println(s); }

String typeName(RadioType t) {
  if (t == RadioType::CC1101) return "CC1101";
  if (t == RadioType::E32) return "E32";
  return "NONE";
}

bool nearly(float a, float b) { return fabsf(a - b) < 0.01f; }

bool parameter(const String &line, const char *key, String &value) {
  String marker = String(key) + "=";
  int start = line.indexOf(marker);
  if (start < 0) return false;
  start += marker.length();
  int end = line.indexOf(',', start);
  if (end < 0) end = line.length();
  value = line.substring(start, end);
  value.trim();
  return value.length() > 0;
}

bool boolValue(String text, bool &value) {
  text.trim(); text.toUpperCase();
  if (text == "1" || text == "TRUE" || text == "ON") { value = true; return true; }
  if (text == "0" || text == "FALSE" || text == "OFF") { value = false; return true; }
  return false;
}

bool ccPowerValid(int value) {
  const int allowed[] = {-30,-20,-15,-10,0,5,7,10};
  for (int item : allowed) if (item == value) return true;
  return false;
}

bool ccBwValid(float value) {
  const float allowed[] = {58,68,81,102,116,135,162,203,232,270,325,406,464,541,650,812};
  for (float item : allowed) if (nearly(item, value)) return true;
  return false;
}

bool e32PowerValid(int value) { return value == 21 || value == 24 || value == 27 || value == 30; }
bool e32RateValid(float value) { return nearly(value,2.4f) || nearly(value,4.8f) || nearly(value,9.6f) || nearly(value,19.2f); }

uint8_t xorAscii(const String &text, size_t count) {
  uint8_t x = 0;
  const size_t n = min(count, static_cast<size_t>(text.length()));
  for (size_t i = 0; i < n; ++i) x ^= static_cast<uint8_t>(text[i]);
  return x;
}

String hex2(uint8_t value) {
  const char hex[] = "0123456789ABCDEF";
  String s;
  s += hex[(value >> 4) & 0x0F];
  s += hex[value & 0x0F];
  return s;
}

bool isHex(char c) {
  return (c >= '0' && c <= '9') || (c >= 'A' && c <= 'F') || (c >= 'a' && c <= 'f');
}

bool digitsOnly(const String &s) {
  for (size_t i = 0; i < s.length(); ++i) if (s[i] < '0' || s[i] > '9') return false;
  return s.length() > 0;
}

bool fixedFloat4(const String &s) {
  return s.length() == 4 && s[0] >= '0' && s[0] <= '9' && s[1] == '.' &&
         s[2] >= '0' && s[2] <= '9' && s[3] >= '0' && s[3] <= '9';
}

bool splitV6(const String &payload, String fields[7]) {
  if (payload.length() != 29) return false;
  size_t field = 0;
  int start = 0;
  for (int i = 0; i <= payload.length() && field < 7; ++i) {
    if (i == payload.length() || payload[i] == ',') {
      fields[field++] = payload.substring(start, i);
      start = i + 1;
    }
  }
  if (field != 7) return false;
  if (fields[0].length() != 2) return false;
  if (fields[1].length() != 5 || !digitsOnly(fields[1])) return false;
  if (fields[2].length() != 5 || !digitsOnly(fields[2])) return false;
  if (!fixedFloat4(fields[3]) || !fixedFloat4(fields[4])) return false;
  if (fields[5].length() != 1 || (fields[5] != "0" && fields[5] != "1")) return false;
  if (fields[6].length() != 2 || !isHex(fields[6][0]) || !isHex(fields[6][1])) return false;
  return true;
}

bool normalizeV6(const String &payload, float rssi, float snr, uint8_t lqi, String &normalized) {
  String f[7];
  if (!splitV6(payload, f)) return false;

  String received = f[6]; received.toUpperCase();
  const String calculated = hex2(xorAscii(payload, 27)); // 27 chars include the final comma.
  if (received != calculated) {
    err("TELEMETRY_XOR,RECV=" + received + ",CALC=" + calculated + ",RAW=" + payload);
    return true;
  }

  normalized = "$TEL,ID=" + f[0] +
               ",PACKET=" + f[1] +
               ",UPTIME=" + f[2] +
               ",PANEL_POWER=" + f[3] +
               ",VOLT=" + f[4] +
               ",MODE=" + f[5] +
               ",CHECKSUM=" + received +
               ",CHECKSUM_OK=1" +
               ",RSSI=" + String(rssi, 1) +
               ",SNR=" + String(snr, 1) +
               ",LQI=" + String(lqi);
  return true;
}

void saveCc() {
  prefs.putFloat("ccFreq", cc.frequency); prefs.putChar("ccPower", cc.power);
  prefs.putFloat("ccRate", cc.bitRate); prefs.putString("ccMod", cc.modulation);
  prefs.putBool("ccBwAuto", cc.bandwidthAuto); prefs.putFloat("ccBw", cc.bandwidth);
  prefs.putBool("ccCrc", cc.crc); prefs.putBool("ccCca", cc.cca);
}

void saveE32() {
  prefs.putUShort("e32Freq", e32.frequency); prefs.putUChar("e32Power", e32.power);
  prefs.putFloat("e32Air", e32.airRate); prefs.putULong("e32Uart", e32.uartBaud);
  prefs.putString("e32Mode", e32.mode); prefs.putBool("e32Fec", e32.fec);
}

void loadConfig() {
  activeType = static_cast<RadioType>(prefs.getUChar("type", static_cast<uint8_t>(RadioType::CC1101)));
  if (activeType != RadioType::CC1101 && activeType != RadioType::E32) activeType = RadioType::CC1101;

  const uint8_t schema = prefs.getUChar("schema", 0);
  if (schema != CONFIG_SCHEMA) {
    cc = CCConfig();
    e32 = E32Config();
    saveCc(); saveE32();
    prefs.putUChar("schema", CONFIG_SCHEMA);
    prefs.putUChar("type", static_cast<uint8_t>(activeType));
    return;
  }

  cc.frequency = prefs.getFloat("ccFreq", 435.000f);
  cc.power = prefs.getChar("ccPower", 5);
  cc.bitRate = prefs.getFloat("ccRate", 4.8f);
  cc.modulation = prefs.getString("ccMod", "2FSK");
  cc.bandwidthAuto = prefs.getBool("ccBwAuto", false);
  cc.bandwidth = prefs.getFloat("ccBw", 58.0f);
  cc.crc = prefs.getBool("ccCrc", true);
  cc.cca = prefs.getBool("ccCca", true);

  e32.frequency = prefs.getUShort("e32Freq", 433);
  e32.power = prefs.getUChar("e32Power", 30);
  e32.airRate = prefs.getFloat("e32Air", 2.4f);
  e32.uartBaud = prefs.getULong("e32Uart", 9600);
  e32.mode = prefs.getString("e32Mode", "TRANSPARENT");
  e32.fec = prefs.getBool("e32Fec", true);
}

void stopRadio() {
  radioReady = false;
  if (activeType == RadioType::CC1101) { cc1101.clearPacketReceivedAction(); cc1101.standby(); }
  if (activeType == RadioType::E32) e32Serial.end();
}

bool startCc(bool verbose = true) {
  stopRadio(); activeType = RadioType::CC1101;
  if (cc.frequency < 387.0f || cc.frequency > 464.0f || !ccPowerValid(cc.power) ||
      cc.bitRate < 0.025f || cc.bitRate > 600.0f || (!cc.bandwidthAuto && !ccBwValid(cc.bandwidth))) {
    if (verbose) err("RADIO_CONFIG,CC1101_INVALID");
    return false;
  }

  cc.modulation.toUpperCase(); cc.modulation.replace("-", "");
  SPI.begin(CC_SCK, CC_MISO, CC_MOSI, CC_CS);
  const float bw = cc.bandwidthAuto ? 812.0f : cc.bandwidth;
  const float deviation = nearly(cc.bitRate, 4.8f) ? 5.0f : constrain(cc.bitRate * 0.5f, 5.0f, 380.0f);
  int16_t result = cc.modulation == "4FSK"
      ? cc1101.beginFSK4(cc.frequency, cc.bitRate, deviation, bw, cc.power, 16)
      : cc1101.begin(cc.frequency, cc.bitRate, deviation, bw, cc.power, 16);
  if (result != RADIOLIB_ERR_NONE) { if (verbose) err("CC1101_INIT,CODE=" + String(result)); return false; }

  if (cc.modulation == "OOK") result = cc1101.setOOK(true);
  else {
    result = cc1101.setOOK(false);
    if (result == RADIOLIB_ERR_NONE) result = cc1101.setDataShaping(cc.modulation == "GFSK" ? RADIOLIB_SHAPING_0_5 : RADIOLIB_SHAPING_NONE);
  }
  if (result != RADIOLIB_ERR_NONE) { if (verbose) err("CC1101_MOD,CODE=" + String(result)); return false; }
  if (cc.bandwidthAuto) { result = cc1101.autoSetRxBandwidth(); if (result != RADIOLIB_ERR_NONE) return false; }
  result = cc1101.setCrcFiltering(cc.crc); if (result != RADIOLIB_ERR_NONE) return false;

  ccPacketReceived = false; noiseFloorDbm = -105.0f; noiseValid = false; lastNoiseSampleMs = millis();
  cc1101.setPacketReceivedAction(onCcPacket);
  result = cc1101.startReceive();
  if (result != RADIOLIB_ERR_NONE) { if (verbose) err("CC1101_RX_START,CODE=" + String(result)); return false; }
  radioReady = true;
  prefs.putUChar("type", static_cast<uint8_t>(activeType));
  if (verbose) info("RADIO_READY,TYPE=CC1101,FREQ=" + String(cc.frequency,3) + ",RATE=" + String(cc.bitRate,1) + ",MOD=" + cc.modulation + ",BW=" + String(cc.bandwidth,0));
  return true;
}

bool waitAux(uint32_t timeout = E32_AUX_TIMEOUT_MS) {
  const uint32_t started = millis();
  while (digitalRead(E32_AUX) != HIGH) { if (millis() - started >= timeout) return false; delay(2); }
  delay(3); return true;
}

uint8_t uartCode(uint32_t b) {
  switch (b) { case 1200:return 0; case 2400:return 1; case 4800:return 2; case 9600:return 3; case 19200:return 4; case 38400:return 5; case 57600:return 6; case 115200:return 7; default:return 3; }
}
uint8_t airCode(float r) { if (nearly(r,2.4f)) return 2; if (nearly(r,4.8f)) return 3; if (nearly(r,9.6f)) return 4; return 5; }
uint8_t powerCode(uint8_t p) { if (p==30) return 0; if (p==27) return 1; if (p==24) return 2; return 3; }

bool startE32(bool program = false, uint32_t oldBaud = 9600, bool verbose = true) {
  stopRadio(); activeType = RadioType::E32;
  if (e32.frequency < 410 || e32.frequency > 441 || !e32PowerValid(e32.power) || !e32RateValid(e32.airRate)) {
    if (verbose) err("RADIO_CONFIG,E32_INVALID"); return false;
  }
  pinMode(E32_M0, OUTPUT); pinMode(E32_M1, OUTPUT); pinMode(E32_AUX, INPUT);
  digitalWrite(E32_M0, LOW); digitalWrite(E32_M1, LOW);
  e32Serial.begin(program ? oldBaud : e32.uartBaud, SERIAL_8N1, E32_RX, E32_TX);
  delay(80);
  if (!waitAux(800)) { if (verbose) err("E32_AUX_NOT_READY"); return false; }

  if (program) {
    digitalWrite(E32_M0, HIGH); digitalWrite(E32_M1, HIGH); delay(45); if (!waitAux()) return false;
    const uint8_t sped = static_cast<uint8_t>((uartCode(e32.uartBaud) << 3) | airCode(e32.airRate));
    const uint8_t channel = static_cast<uint8_t>(e32.frequency - 410);
    uint8_t option = 0x40 | powerCode(e32.power); if (e32.mode == "FIXED") option |= 0x80; if (e32.fec) option |= 0x04;
    const uint8_t frame[6] = {0xC0,0x00,0x00,sped,channel,option};
    e32Serial.write(frame,sizeof(frame)); e32Serial.flush(); if (!waitAux()) return false;
    delay(30);
    digitalWrite(E32_M0, LOW); digitalWrite(E32_M1, LOW); delay(45);
    e32Serial.end(); e32Serial.begin(e32.uartBaud, SERIAL_8N1, E32_RX, E32_TX); delay(80);
  }

  radioReady = true; prefs.putUChar("type", static_cast<uint8_t>(activeType));
  if (verbose) info("RADIO_READY,TYPE=E32");
  return true;
}

void radioStatus() {
  String s = "RADIO,TYPE=" + typeName(activeType) + ",READY=" + String(radioReady ? 1 : 0);
  if (activeType == RadioType::CC1101) s += ",FREQ=" + String(cc.frequency,3) + ",POWER=" + String(cc.power) + ",RATE=" + String(cc.bitRate,1) + ",MOD=" + cc.modulation + ",BW=" + String(cc.bandwidth,0) + ",CRC=" + String(cc.crc?1:0) + ",CCA=" + String(cc.cca?1:0);
  if (activeType == RadioType::E32) s += ",FREQ=" + String(e32.frequency) + ",POWER=" + String(e32.power) + ",AIR=" + String(e32.airRate,1) + ",UART=" + String(e32.uartBaud) + ",MODE=" + e32.mode + ",FEC=" + String(e32.fec?1:0);
  info(s);
}

void applyRadioCommand(const String &line) {
  String type; if (!parameter(line,"TYPE",type)) { err("RADIO_CONFIG,TYPE_REQUIRED"); return; }
  type.toUpperCase();
  String v;
  if (type == "CC1101") {
    CCConfig candidate = cc;
    if (parameter(line,"FREQ",v)) candidate.frequency=v.toFloat();
    if (parameter(line,"POWER",v)) candidate.power=static_cast<int8_t>(v.toInt());
    if (parameter(line,"RATE",v)) candidate.bitRate=v.toFloat();
    if (parameter(line,"MOD",v)) { v.toUpperCase(); v.replace("-",""); candidate.modulation=v; }
    if (parameter(line,"BW",v)) { v.toUpperCase(); candidate.bandwidthAuto=(v=="AUTO"); if (!candidate.bandwidthAuto) candidate.bandwidth=v.toFloat(); }
    if (parameter(line,"CRC",v) && !boolValue(v,candidate.crc)) { err("RADIO_CONFIG,CRC=0|1"); return; }
    if (parameter(line,"CCA",v) && !boolValue(v,candidate.cca)) { err("RADIO_CONFIG,CCA=0|1"); return; }
    cc=candidate; if (!startCc(true)) return; saveCc(); ack("RADIO_CONFIG_APPLIED,TYPE=CC1101"); radioStatus(); return;
  }
  if (type == "E32" || type == "E32-433T30D") {
    E32Config candidate=e32; const uint32_t old=e32.uartBaud;
    if (parameter(line,"FREQ",v)) candidate.frequency=v.toInt();
    if (parameter(line,"POWER",v)) candidate.power=v.toInt();
    if (parameter(line,"AIR",v)) candidate.airRate=v.toFloat();
    if (parameter(line,"UART",v)) candidate.uartBaud=v.toInt();
    if (parameter(line,"MODE",v)) { v.toUpperCase(); candidate.mode=v; }
    if (parameter(line,"FEC",v) && !boolValue(v,candidate.fec)) { err("RADIO_CONFIG,FEC=0|1"); return; }
    e32=candidate; if (!startE32(true,old,true)) return; saveE32(); ack("RADIO_CONFIG_APPLIED,TYPE=E32"); radioStatus(); return;
  }
  err("RADIO_CONFIG,TYPE=CC1101|E32");
}

bool txCc(const String &payload) {
  cc1101.standby();
  if (cc.cca && cc1101.scanChannel() != RADIOLIB_CHANNEL_FREE) { cc1101.startReceive(); err("RADIO_BUSY"); return false; }
  const int16_t result=cc1101.transmit(payload.c_str()); cc1101.startReceive();
  if (result != RADIOLIB_ERR_NONE) { err("RADIO_TX,TYPE=CC1101,CODE=" + String(result)); return false; }
  return true;
}

bool txE32(const String &payload) {
  if (!waitAux()) return false; e32Serial.println(payload); e32Serial.flush(); return waitAux();
}

void forwardCommand(const String &line) {
  if (!radioReady) { err("RADIO_NOT_READY"); return; }
  bool ok = activeType == RadioType::CC1101 ? txCc(line) : activeType == RadioType::E32 ? txE32(line) : false;
  if (ok) ack("RADIO_TX,TYPE=" + typeName(activeType) + ",BYTES=" + String(line.length()));
}

void processUsb(String line) {
  line.trim(); if (line.isEmpty()) return;
  String upper=line; upper.toUpperCase();
  if (upper == "$CMD,GATEWAY_PING") { ack("GATEWAY_PONG"); return; }
  if (upper == "$CMD,GATEWAY_INFO") { info("GATEWAY=ALTAIR,DEVICE=ESP32-WROOM-32,FW=" + String(FW_VERSION) + ",PROTOCOL=V6,FIXED_LEN=29,FREQ=435.000"); return; }
  if (upper == "$CMD,RADIO_STATUS") { radioStatus(); return; }
  if (upper.startsWith("$CMD,RADIO,")) { applyRadioCommand(upper); return; }
  if (upper.startsWith("$CMD,")) { forwardCommand(line); return; }
  err("UNKNOWN_USB_LINE");
}

void pollUsb() {
  while (Serial.available()) {
    char c=static_cast<char>(Serial.read()); if (c=='\r') continue;
    if (c=='\n') { processUsb(usbLine); usbLine=""; continue; }
    if (usbLine.length() < MAX_LINE_LENGTH) usbLine += c; else { usbLine=""; err("USB_LINE_TOO_LONG"); }
  }
}

void appendMetrics(String &line, float rssi, float snr, uint8_t lqi) {
  line += ",RSSI=" + String(rssi,1) + ",SNR=" + String(snr,1) + ",LQI=" + String(lqi);
}

void forwardCcPayload(String payload, float rssi, uint8_t lqi, float snr) {
  payload.trim(); if (payload.isEmpty()) return;
  String normalized;
  if (normalizeV6(payload,rssi,snr,lqi,normalized)) { if (normalized.length()) Serial.println(normalized); return; }
  if (payload.startsWith("$TEL")) { appendMetrics(payload,rssi,snr,lqi); Serial.println(payload); return; }
  if (payload.startsWith("$TM,") && payload.indexOf('=') >= 0) { payload.remove(0,4); String line="$TEL,"+payload; appendMetrics(line,rssi,snr,lqi); Serial.println(line); return; }
  payload.replace("\r"," "); payload.replace("\n"," "); if (payload.length()>120) payload=payload.substring(0,120);
  info("RF_RAW,TYPE=CC1101,RSSI=" + String(rssi,1) + ",SNR=" + String(snr,1) + ",LQI=" + String(lqi) + ",TEXT=" + payload);
}

void pollNoise() {
  if (!radioReady || activeType != RadioType::CC1101 || ccPacketReceived) return;
  const uint32_t now=millis(); if (now-lastNoiseSampleMs<50) return; lastNoiseSampleMs=now;
  const float sample=cc1101.getRSSI();
  if (sample>-130.0f && sample<-75.0f) { if (!noiseValid) { noiseFloorDbm=sample; noiseValid=true; } else noiseFloorDbm=0.92f*noiseFloorDbm+0.08f*sample; }
}

void pollCc() {
  if (!radioReady || activeType != RadioType::CC1101 || !ccPacketReceived) return;
  ccPacketReceived=false; String payload; const int16_t result=cc1101.readData(payload);
  const float rssi=cc1101.getRSSI(); const uint8_t lqi=cc1101.getLQI(); const float noise=noiseValid?noiseFloorDbm:-105.0f; const float snr=constrain(rssi-noise,-10.0f,60.0f);
  if (result==RADIOLIB_ERR_NONE) forwardCcPayload(payload,rssi,lqi,snr);
  else if (result==RADIOLIB_ERR_CRC_MISMATCH) err("RADIO_RX_CRC");
  else err("RADIO_RX,TYPE=CC1101,CODE=" + String(result));
  cc1101.startReceive();
}

void pollE32() {
  if (!radioReady || activeType != RadioType::E32) return;
  while (e32Serial.available()) {
    char c=static_cast<char>(e32Serial.read()); if (c=='\r') continue;
    if (c=='\n') { e32Line.trim(); if (!e32Line.isEmpty()) Serial.println(e32Line); e32Line=""; continue; }
    if (e32Line.length()<MAX_LINE_LENGTH) e32Line+=c; else { e32Line=""; err("E32_RX_LINE_TOO_LONG"); }
  }
}

} // namespace AltairGateway

void setup() {
  using namespace AltairGateway;
  Serial.begin(USB_BAUD); delay(350); usbLine.reserve(MAX_LINE_LENGTH+8); e32Line.reserve(MAX_LINE_LENGTH+8);
  prefs.begin("altair-rf",false); loadConfig();
  info("GATEWAY=ALTAIR,DEVICE=ESP32-WROOM-32,FW=" + String(FW_VERSION) + ",BOOT=1,PROTOCOL=V6,FIXED_LEN=29");
  if (activeType==RadioType::E32) startE32(false,e32.uartBaud,false); else startCc(false);
  radioStatus();
}

void loop() {
  using namespace AltairGateway;
  pollUsb(); pollNoise(); pollCc(); pollE32(); delay(1);
}
