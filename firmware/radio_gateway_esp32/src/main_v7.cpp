#include <Arduino.h>
#include <RadioLib.h>

/*
 * ЦУП Альтаир v7 — рабочий ESP32 radio gateway.
 *
 * Основа v7 — реально проверенная стендовая конфигурация:
 * STM32 + CC1101 IntroSat -> ESP32-WROOM-32 + обычный CC1101.
 * Канонический пакет 02,00001,00015,3.00,4.20,1,33 был устойчиво принят
 * только после расширения RX bandwidth до 203 кГц. Поэтому BW=203 кГц
 * зафиксирована как штатная настройка релиза v7.
 */

#define setup altairLegacySetup
#define loop altairLegacyLoop
#include "main.cpp"
#undef setup
#undef loop

namespace AltairV7 {

constexpr char FW_VERSION_V7[] = "0.4.0";
constexpr char RX_PROFILE[] = "v7-bw203-gdo0-poll";
constexpr float V7_FREQ = 435.000f;
constexpr float V7_RATE = 4.8f;
constexpr float V7_BW = 203.0f;
constexpr int8_t V7_POWER = 5;

bool profileApplied = false;

void forceConfig() {
  cc.frequency = V7_FREQ;
  cc.power = V7_POWER;
  cc.bitRate = V7_RATE;
  cc.modulation = "2FSK";
  cc.bandwidthAuto = false;
  cc.bandwidth = V7_BW;
  cc.crc = true;
  cc.cca = true;
}

bool applyPacketProfile(bool verbose = true) {
  if (!radioReady || activeType != RadioType::CC1101) return false;

  forceConfig();
  cc1101.clearPacketReceivedAction();
  ccPacketReceived = false;

  int16_t state = cc1101.standby();
  if (state == RADIOLIB_ERR_NONE) state = cc1101.setFrequency(V7_FREQ);
  if (state == RADIOLIB_ERR_NONE) state = cc1101.setBitRate(V7_RATE);
  if (state == RADIOLIB_ERR_NONE) state = cc1101.setFrequencyDeviation(5.0f);
  if (state == RADIOLIB_ERR_NONE) state = cc1101.setRxBandwidth(V7_BW);
  if (state == RADIOLIB_ERR_NONE) state = cc1101.setOutputPower(V7_POWER);
  if (state == RADIOLIB_ERR_NONE) state = cc1101.setOOK(false);
  if (state == RADIOLIB_ERR_NONE) state = cc1101.setDataShaping(RADIOLIB_SHAPING_NONE);
  if (state == RADIOLIB_ERR_NONE) state = cc1101.setEncoding(RADIOLIB_ENCODING_NRZ);
  if (state == RADIOLIB_ERR_NONE) state = cc1101.setSyncWord(0x12, 0xAD, 0, false);
  if (state == RADIOLIB_ERR_NONE) state = cc1101.variablePacketLengthMode(RADIOLIB_CC1101_MAX_PACKET_LENGTH);
  if (state == RADIOLIB_ERR_NONE) state = cc1101.setCrcFiltering(true);

  if (state != RADIOLIB_ERR_NONE) {
    radioReady = false;
    if (verbose) err("CC1101_V7_PROFILE,CODE=" + String(state));
    return false;
  }

  state = cc1101.startReceive();
  if (state != RADIOLIB_ERR_NONE) {
    radioReady = false;
    if (verbose) err("CC1101_V7_RX_START,CODE=" + String(state));
    return false;
  }

  profileApplied = true;
  saveCc();
  if (verbose) {
    info("RADIO_RX_PROFILE=" + String(RX_PROFILE) +
         ",TYPE=CC1101,FREQ=435.000,RATE=4.8,MOD=2FSK,DEV=5,BW=203,SYNC=12AD,ENC=NRZ,LEN=VARIABLE,CRC=1");
  }
  return true;
}

void processUsbV7(String line) {
  line.trim();
  if (line.isEmpty()) return;
  String upper = line;
  upper.toUpperCase();

  if (upper == "$CMD,GATEWAY_PING") { ack("GATEWAY_PONG"); return; }
  if (upper == "$CMD,GATEWAY_INFO") {
    info("GATEWAY=ALTAIR,DEVICE=ESP32-WROOM-32,FW=" + String(FW_VERSION_V7) +
         ",PROTOCOL=V7,FIXED_LEN=29,FREQ=435.000,BW=203,RX=" + String(RX_PROFILE));
    return;
  }
  if (upper == "$CMD,RADIO_STATUS") {
    info("RADIO,TYPE=CC1101,READY=" + String(radioReady ? 1 : 0) +
         ",FREQ=435.000,POWER=5,RATE=4.8,MOD=2FSK,BW=203,CRC=1,CCA=1");
    return;
  }
  if (upper.startsWith("$CMD,RADIO,")) {
    forceConfig();
    if (!startCc(true)) return;
    profileApplied = false;
    if (!applyPacketProfile(true)) return;
    ack("RADIO_CONFIG_APPLIED,TYPE=CC1101,PROFILE=V7,BW=203");
    return;
  }
  if (upper.startsWith("$CMD,")) {
    forwardCommand(line);
    profileApplied = false;
    return;
  }
  err("UNKNOWN_USB_LINE");
}

void pollUsbV7() {
  while (Serial.available()) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\r') continue;
    if (c == '\n') {
      processUsbV7(usbLine);
      usbLine = "";
      continue;
    }
    if (usbLine.length() < MAX_LINE_LENGTH) usbLine += c;
    else { usbLine = ""; err("USB_LINE_TOO_LONG"); }
  }
}

void pollCcV7() {
  if (!radioReady || activeType != RadioType::CC1101) return;
  if (!profileApplied && !applyPacketProfile(true)) return;

  if (digitalRead(CC_GDO0) != HIGH) return;

  String payload;
  const int16_t result = cc1101.readData(payload);
  const float rssi = cc1101.getRSSI();
  const uint8_t lqi = cc1101.getLQI();
  const float snr = constrain(rssi - (-105.0f), -10.0f, 60.0f);

  if (result == RADIOLIB_ERR_NONE) forwardCcPayload(payload, rssi, lqi, snr);
  else if (result == RADIOLIB_ERR_CRC_MISMATCH) err("RADIO_RX_CRC");
  else err("RADIO_RX,TYPE=CC1101,CODE=" + String(result));

  const int16_t restart = cc1101.startReceive();
  if (restart != RADIOLIB_ERR_NONE) {
    radioReady = false;
    profileApplied = false;
    err("CC1101_RX_RESTART,CODE=" + String(restart));
  }
}

} // namespace AltairV7

void setup() {
  using namespace AltairGateway;
  using namespace AltairV7;

  Serial.begin(USB_BAUD);
  delay(350);
  usbLine.reserve(MAX_LINE_LENGTH + 8);
  e32Line.reserve(MAX_LINE_LENGTH + 8);
  prefs.begin("altair-rf", false);
  loadConfig();

  activeType = RadioType::CC1101;
  forceConfig();
  saveCc();
  prefs.putUChar("type", static_cast<uint8_t>(RadioType::CC1101));

  info("GATEWAY=ALTAIR,DEVICE=ESP32-WROOM-32,FW=" + String(FW_VERSION_V7) +
       ",BOOT=1,PROTOCOL=V7,FIXED_LEN=29,FREQ=435.000,BW=203");

  if (!startCc(false)) {
    err("CC1101_START_FAILED");
    return;
  }
  profileApplied = false;
  applyPacketProfile(true);
}

void loop() {
  using namespace AltairGateway;
  using namespace AltairV7;

  pollUsbV7();
  pollCcV7();
  delay(1);
}
