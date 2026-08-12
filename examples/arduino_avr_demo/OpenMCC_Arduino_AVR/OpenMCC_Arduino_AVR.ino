/*
 * ============================================================
 * OpenMCC
 * Open Mission Control Center
 *
 * Демонстратор телеметрии для:
 * - Arduino Uno;
 * - Arduino Nano на ATmega328P.
 *
 * Скорость последовательного порта: 115200 бод.
 *
 * Формат телеметрии:
 * $TEL,TEMP=23.50,VOLT=5.01,CURR=182,RSSI=-79,SNR=9.4
 *
 * Поддерживаемые команды:
 * $CMD,PING
 * $CMD,START
 * $CMD,STOP
 * $CMD,LED,VALUE=1
 * $CMD,LED,VALUE=0
 * $CMD,RATE,VALUE=500
 * ============================================================
 */

#include <Arduino.h>
#include <limits.h>

/* ============================================================
 * Конфигурация
 * ============================================================
 */

constexpr unsigned long SERIAL_BAUD_RATE = 115200UL;

constexpr unsigned long DEFAULT_TELEMETRY_PERIOD_MS = 1000UL;
constexpr unsigned long MINIMUM_TELEMETRY_PERIOD_MS = 100UL;
constexpr unsigned long MAXIMUM_TELEMETRY_PERIOD_MS = 60000UL;

constexpr size_t COMMAND_BUFFER_SIZE = 96;

constexpr uint8_t STATUS_LED_PIN = LED_BUILTIN;


/* ============================================================
 * Состояние программы
 * ============================================================
 */

bool telemetryEnabled = true;

unsigned long telemetryPeriodMs =
    DEFAULT_TELEMETRY_PERIOD_MS;

unsigned long previousTelemetryTimeMs = 0;

unsigned long packetCounter = 0;

char commandBuffer[COMMAND_BUFFER_SIZE];

size_t commandLength = 0;


/* ============================================================
 * Вспомогательные функции
 * ============================================================
 */

/**
 * Формирует плавно изменяющуюся величину.
 */
float createWave(
    const float center,
    const float amplitude,
    const float periodSeconds,
    const float phase = 0.0F
) {
    const float timeSeconds =
        static_cast<float>(millis()) / 1000.0F;

    return center +
        amplitude *
        sin(
            2.0F * PI *
            timeSeconds /
            periodSeconds +
            phase
        );
}


/**
 * Возвращает небольшую псевдослучайную добавку.
 */
float createNoise(const float amplitude) {
    const long randomValue =
        random(-1000L, 1001L);

    return amplitude *
        static_cast<float>(randomValue) /
        1000.0F;
}


/* ============================================================
 * Формирование телеметрии
 * ============================================================
 */

void sendTelemetry() {
    const float temperature =
        createWave(
            23.5F,
            1.3F,
            24.0F
        ) +
        createNoise(0.08F);

    const float voltage =
        createWave(
            5.02F,
            0.035F,
            18.0F,
            0.7F
        ) +
        createNoise(0.004F);

    const float current =
        createWave(
            182.0F,
            15.0F,
            14.0F,
            1.1F
        ) +
        createNoise(2.0F);

    const float rssi =
        createWave(
            -80.0F,
            4.0F,
            20.0F,
            2.0F
        ) +
        createNoise(0.7F);

    const float snr =
        createWave(
            9.4F,
            1.2F,
            16.0F,
            0.4F
        ) +
        createNoise(0.15F);

    packetCounter++;

    Serial.print(F("$TEL"));

    Serial.print(F(",TEMP="));
    Serial.print(temperature, 2);

    Serial.print(F(",VOLT="));
    Serial.print(voltage, 3);

    Serial.print(F(",CURR="));
    Serial.print(current, 1);

    Serial.print(F(",RSSI="));
    Serial.print(rssi, 1);

    Serial.print(F(",SNR="));
    Serial.print(snr, 2);

    Serial.print(F(",PACKET="));
    Serial.print(packetCounter);

    Serial.print(F(",UPTIME="));
    Serial.print(millis());

    Serial.println();
}


/* ============================================================
 * Ответы устройства
 * ============================================================
 */

void sendAcknowledgement(
    const __FlashStringHelper *message
) {
    Serial.print(F("$ACK,"));
    Serial.println(message);
}


void sendError(
    const __FlashStringHelper *message
) {
    Serial.print(F("$ERR,"));
    Serial.println(message);
}


void sendDeviceInformation() {
    Serial.println(
        F("$INFO,DEVICE=ARDUINO_UNO_NANO,"
          "MCU=ATMEGA328P,"
          "PROTOCOL=OPENMCC,"
          "VERSION=0.1.0")
    );
}


/* ============================================================
 * Обработка команд
 * ============================================================
 */

long extractValueParameter(const char *command) {
    const char *valuePosition =
        strstr(command, "VALUE=");

    if (valuePosition == nullptr) {
        return LONG_MIN;
    }

    valuePosition += 6;

    return atol(valuePosition);
}


void processCommand(char *command) {
    while (
        *command == ' ' ||
        *command == '\t'
    ) {
        command++;
    }

    if (strncmp(command, "$CMD,", 5) != 0) {
        sendError(F("UNKNOWN_FORMAT"));
        return;
    }

    command += 5;

    if (strcmp(command, "PING") == 0) {
        Serial.println(F("$ACK,PONG"));
        return;
    }

    if (strcmp(command, "START") == 0) {
        telemetryEnabled = true;
        sendAcknowledgement(F("TELEMETRY_STARTED"));
        return;
    }

    if (strcmp(command, "STOP") == 0) {
        telemetryEnabled = false;
        sendAcknowledgement(F("TELEMETRY_STOPPED"));
        return;
    }

    if (strcmp(command, "INFO") == 0) {
        sendDeviceInformation();
        return;
    }

    if (strncmp(command, "LED", 3) == 0) {
        const long value =
            extractValueParameter(command);

        if (value == LONG_MIN) {
            sendError(F("LED_VALUE_MISSING"));
            return;
        }

        digitalWrite(
            STATUS_LED_PIN,
            value != 0
                ? HIGH
                : LOW
        );

        sendAcknowledgement(
            value != 0
                ? F("LED_ON")
                : F("LED_OFF")
        );

        return;
    }

    if (strncmp(command, "RATE", 4) == 0) {
        const long requestedPeriod =
            extractValueParameter(command);

        if (requestedPeriod == LONG_MIN) {
            sendError(F("RATE_VALUE_MISSING"));
            return;
        }

        if (
            requestedPeriod <
                static_cast<long>(
                    MINIMUM_TELEMETRY_PERIOD_MS
                ) ||
            requestedPeriod >
                static_cast<long>(
                    MAXIMUM_TELEMETRY_PERIOD_MS
                )
        ) {
            sendError(F("RATE_OUT_OF_RANGE"));
            return;
        }

        telemetryPeriodMs =
            static_cast<unsigned long>(
                requestedPeriod
            );

        Serial.print(F("$ACK,RATE="));
        Serial.println(telemetryPeriodMs);

        return;
    }

    sendError(F("UNKNOWN_COMMAND"));
}


/* ============================================================
 * Приём строк из последовательного порта
 * ============================================================
 */

void readSerialCommands() {
    while (Serial.available() > 0) {
        const char incomingCharacter =
            static_cast<char>(
                Serial.read()
            );

        if (
            incomingCharacter == '\n' ||
            incomingCharacter == '\r'
        ) {
            if (commandLength > 0) {
                commandBuffer[commandLength] =
                    '\0';

                processCommand(
                    commandBuffer
                );

                commandLength = 0;
            }

            continue;
        }

        if (
            commandLength <
            COMMAND_BUFFER_SIZE - 1
        ) {
            commandBuffer[commandLength] =
                incomingCharacter;

            commandLength++;
        }
        else {
            commandLength = 0;

            sendError(
                F("COMMAND_TOO_LONG")
            );
        }
    }
}


/* ============================================================
 * Инициализация
 * ============================================================
 */

void setup() {
    pinMode(
        STATUS_LED_PIN,
        OUTPUT
    );

    digitalWrite(
        STATUS_LED_PIN,
        LOW
    );

    Serial.begin(
        SERIAL_BAUD_RATE
    );

    randomSeed(
        analogRead(A0) ^
        micros()
    );

    delay(400);

    Serial.println(
        F("$INFO,OPENMCC_DEVICE_READY")
    );

    sendDeviceInformation();
}


/* ============================================================
 * Основной цикл
 * ============================================================
 */

void loop() {
    readSerialCommands();

    const unsigned long currentTimeMs =
        millis();

    if (
        telemetryEnabled &&
        currentTimeMs -
            previousTelemetryTimeMs >=
            telemetryPeriodMs
    ) {
        previousTelemetryTimeMs =
            currentTimeMs;

        sendTelemetry();
    }
}