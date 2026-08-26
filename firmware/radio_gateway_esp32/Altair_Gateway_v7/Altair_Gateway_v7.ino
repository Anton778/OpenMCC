#include <Arduino.h>
#include <SPI.h>
#include <RadioLib.h>

/*
 * ЦУП Альтаир v7 — простой проверенный шлюз ESP32 + CC1101.
 * Технопром 2026 · Миссия на Луну
 *
 * Этот вариант предназначен для загрузки через Arduino IDE.
 * Он повторяет схему, которая реально приняла пакет STM32 на стенде.
 * Ключевое исправление v7: RX bandwidth = 203 кГц.
 */

#define CC_SCK   18
#define CC_MISO  19
#define CC_MOSI  23
#define CC_CS    21
#define CC_GDO0  4
#define CC_GDO2  27

CC1101 radio = new Module(CC_CS, CC_GDO0, RADIOLIB_NC, CC_GDO2);

uint8_t calculateXOR(const String &s) {
  uint8_t value = 0;
  for (size_t i = 0; i < s.length(); i++) value ^= static_cast<uint8_t>(s[i]);
  return value;
}

String hex2(uint8_t value) {
  const char hex[] = "0123456789ABCDEF";
  String result;
  result += hex[(value >> 4) & 0x0F];
  result += hex[value & 0x0F];
  return result;
}

bool decodePacket(const String &packet, String fields[7]) {
  if (packet.length() != 29) return false;
  int field = 0;
  int start = 0;
  for (int i = 0; i <= packet.length(); i++) {
    if (i == packet.length() || packet[i] == ',') {
      if (field >= 7) return false;
      fields[field++] = packet.substring(start, i);
      start = i + 1;
    }
  }
  return field == 7 &&
         fields[0].length() == 2 &&
         fields[1].length() == 5 &&
         fields[2].length() == 5 &&
         fields[3].length() == 4 &&
         fields[4].length() == 4 &&
         fields[5].length() == 1 &&
         fields[6].length() == 2;
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("$INFO,GATEWAY=ALTAIR_SIMPLE_V7,BOOT=1,FREQ=435.000,BW=203");

  SPI.begin(CC_SCK, CC_MISO, CC_MOSI, CC_CS);

  int state = radio.begin(
    435.000,
    4.8,
    5.0,
    203.0,
    5,
    16
  );

  if (state != RADIOLIB_ERR_NONE) {
    Serial.print("$ERR,CC1101_INIT,CODE=");
    Serial.println(state);
    while (true) delay(1000);
  }

  radio.setOOK(false);
  radio.setDataShaping(RADIOLIB_SHAPING_NONE);
  radio.setEncoding(RADIOLIB_ENCODING_NRZ);
  radio.setSyncWord(0x12, 0xAD, 0, false);
  radio.variablePacketLengthMode(RADIOLIB_CC1101_MAX_PACKET_LENGTH);
  radio.setCrcFiltering(true);

  Serial.println("$INFO,RADIO_READY,TYPE=CC1101,FREQ=435.000,RATE=4.8,DEV=5,BW=203,SYNC=12AD,CRC=1");
}

void loop() {
  String packet;
  const int state = radio.receive(packet);

  if (state == RADIOLIB_ERR_NONE) {
    packet.trim();

    String f[7];
    if (!decodePacket(packet, f)) {
      Serial.print("$ERR,PACKET_FORMAT,RAW=");
      Serial.println(packet);
      return;
    }

    String xorSource = f[0] + "," + f[1] + "," + f[2] + "," + f[3] + "," + f[4] + "," + f[5] + ",";
    String calculated = hex2(calculateXOR(xorSource));
    String received = f[6];
    received.toUpperCase();

    if (received != calculated) {
      Serial.print("$ERR,TELEMETRY_XOR,RECV=");
      Serial.print(received);
      Serial.print(",CALC=");
      Serial.println(calculated);
      return;
    }

    const float rssi = radio.getRSSI();
    const uint8_t lqi = radio.getLQI();
    float snr = rssi - (-105.0f);
    if (snr > 60.0f) snr = 60.0f;
    if (snr < -10.0f) snr = -10.0f;

    Serial.print("$TEL,ID="); Serial.print(f[0]);
    Serial.print(",PACKET="); Serial.print(f[1]);
    Serial.print(",UPTIME="); Serial.print(f[2]);
    Serial.print(",PANEL_POWER="); Serial.print(f[3]);
    Serial.print(",VOLT="); Serial.print(f[4]);
    Serial.print(",MODE="); Serial.print(f[5]);
    Serial.print(",CHECKSUM="); Serial.print(received);
    Serial.print(",CHECKSUM_OK=1");
    Serial.print(",RSSI="); Serial.print(rssi, 1);
    Serial.print(",SNR="); Serial.print(snr, 1);
    Serial.print(",LQI="); Serial.println(lqi);
  }
  else if (state == RADIOLIB_ERR_CRC_MISMATCH) {
    Serial.println("$ERR,RADIO_RX_CRC");
  }
}
