#include <Arduino.h>
#include <RadioLib.h>

/*
 * ЦУП Альтаир v6.1 — исправленный приём CC1101.
 *
 * Этот файл оборачивает проверенный код gateway v6 и заменяет только цикл
 * обслуживания приёмника. Причина: на стенде блокирующий приём RadioLib
 * успешно принял канонический пакет
 *   02,00001,00015,3.00,4.20,1,33
 * при 435.000 МГц / 4.8 kbps / 2-FSK / deviation 5 kHz / BW 58 kHz,
 * тогда как прежняя версия шлюза зависела от callback/interrupt GDO0.
 *
 * В исправленной версии GDO0 (GPIO4) опрашивается напрямую. Это повторяет
 * надёжный путь, которым RadioLib пользуется при обычном receive(), но не
 * блокирует USB-интерфейс ЦУПа.
 */

// main.cpp остаётся источником всей существующей логики gateway: USB-команды,
// E32, нормализация $TEL, XOR, RSSI/LQI/SNR и сохранение конфигурации.
// Переименовываем только старый loop(), чтобы определить исправленный ниже.
#define loop altairLegacyLoop
#include "main.cpp"
#undef loop

namespace AltairGateway {

constexpr char RX_PATCH_VERSION[] = "v6.1-gdo0-poll";

bool v6RxProfileApplied = false;
RadioType lastRxType = RadioType::None;
float lastRxFreq = 0.0f;
float lastRxRate = 0.0f;
float lastRxBw = 0.0f;
String lastRxMod;
bool lastRxCrc = false;

bool applyKnownGoodV6PacketProfile(bool verbose = true) {
  if (!radioReady || activeType != RadioType::CC1101) return false;

  // Не используем callback GDO0: приём проверен прямым чтением GPIO4.
  cc1101.clearPacketReceivedAction();
  ccPacketReceived = false;

  int16_t state = cc1101.standby();
  if (state != RADIOLIB_ERR_NONE) {
    if (verbose) err("CC1101_V6_STANDBY,CODE=" + String(state));
    return false;
  }

  // Явно задаём все параметры пакетного режима, которые были использованы
  // в успешно проверенном простом приёмнике.
  state = cc1101.setOOK(false);
  if (state == RADIOLIB_ERR_NONE) state = cc1101.setDataShaping(RADIOLIB_SHAPING_NONE);
  if (state == RADIOLIB_ERR_NONE) state = cc1101.setEncoding(RADIOLIB_ENCODING_NRZ);
  if (state == RADIOLIB_ERR_NONE) state = cc1101.setSyncWord(0x12, 0xAD, 0, false);
  if (state == RADIOLIB_ERR_NONE) state = cc1101.variablePacketLengthMode(RADIOLIB_CC1101_MAX_PACKET_LENGTH);
  if (state == RADIOLIB_ERR_NONE) state = cc1101.setCrcFiltering(true);

  if (state != RADIOLIB_ERR_NONE) {
    radioReady = false;
    if (verbose) err("CC1101_V6_PROFILE,CODE=" + String(state));
    return false;
  }

  state = cc1101.startReceive();
  if (state != RADIOLIB_ERR_NONE) {
    radioReady = false;
    if (verbose) err("CC1101_V6_RX_START,CODE=" + String(state));
    return false;
  }

  v6RxProfileApplied = true;
  lastRxType = activeType;
  lastRxFreq = cc.frequency;
  lastRxRate = cc.bitRate;
  lastRxBw = cc.bandwidth;
  lastRxMod = cc.modulation;
  lastRxCrc = cc.crc;

  if (verbose) {
    info("RADIO_RX_PATCH=" + String(RX_PATCH_VERSION) +
         ",TYPE=CC1101,GDO0=POLL,SYNC=12AD,ENC=NRZ,LEN=VARIABLE,CRC=1");
  }
  return true;
}

bool rxProfileNeedsRefresh() {
  if (!v6RxProfileApplied) return true;
  if (activeType != lastRxType) return true;
  if (!nearly(cc.frequency, lastRxFreq)) return true;
  if (!nearly(cc.bitRate, lastRxRate)) return true;
  if (!nearly(cc.bandwidth, lastRxBw)) return true;
  if (cc.modulation != lastRxMod) return true;
  if (cc.crc != lastRxCrc) return true;
  return false;
}

void pollCcFixed() {
  if (!radioReady || activeType != RadioType::CC1101) return;

  if (rxProfileNeedsRefresh()) {
    if (!applyKnownGoodV6PacketProfile(true)) return;
  }

  // В режиме startReceive() RadioLib отображает окончание принятого пакета
  // на GDO0. На нашей плате это GPIO4. Проверка этого же вывода дала
  // стабильный приём на стенде, поэтому здесь не нужен attachInterrupt().
  if (digitalRead(CC_GDO0) != HIGH) return;

  String payload;
  const int16_t result = cc1101.readData(payload);
  const float rssi = cc1101.getRSSI();
  const uint8_t lqi = cc1101.getLQI();

  // CC1101 не выдаёт отдельный SNR. Для интерфейса сохраняем диагностическую
  // оценку относительно опорного шумового уровня -105 dBm.
  const float snr = constrain(rssi - (-105.0f), -10.0f, 60.0f);

  if (result == RADIOLIB_ERR_NONE) {
    forwardCcPayload(payload, rssi, lqi, snr);
  } else if (result == RADIOLIB_ERR_CRC_MISMATCH) {
    err("RADIO_RX_CRC");
  } else {
    err("RADIO_RX,TYPE=CC1101,CODE=" + String(result));
  }

  const int16_t restart = cc1101.startReceive();
  if (restart != RADIOLIB_ERR_NONE) {
    radioReady = false;
    v6RxProfileApplied = false;
    err("CC1101_RX_RESTART,CODE=" + String(restart));
  }
}

} // namespace AltairGateway

void loop() {
  using namespace AltairGateway;

  pollUsb();

  if (activeType == RadioType::CC1101) {
    pollCcFixed();
  } else {
    v6RxProfileApplied = false;
    pollE32();
  }

  delay(1);
}
