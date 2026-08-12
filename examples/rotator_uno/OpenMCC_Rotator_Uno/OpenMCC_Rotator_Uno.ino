/*
 * ============================================================
 * OpenMCC Rotator Controller
 *
 * Плата:
 *   Arduino Uno
 *   CNC Shield V3
 *
 * Приводы:
 *   X-axis -> угол места EL
 *   Y-axis -> азимут AZ
 *
 * Драйверы:
 *   A4988 или DRV8825
 *
 * Протокол:
 *   $ROT,SET,AZ=145.00,EL=37.50
 *   $ROT,STOP
 *   $ROT,HOME
 *   $ROT,PARK
 *   $ROT,STATUS
 *
 * Скорость:
 *   115200 бод
 * ============================================================
 */

#include <Arduino.h>
#include <AccelStepper.h>
#include <stdlib.h>
#include <string.h>


/* ============================================================
 * Распиновка CNC Shield V3
 * ============================================================
 */

// Ось X CNC Shield — угол места.
constexpr uint8_t EL_STEP_PIN = 2;
constexpr uint8_t EL_DIR_PIN  = 5;

// Ось Y CNC Shield — азимут.
constexpr uint8_t AZ_STEP_PIN = 3;
constexpr uint8_t AZ_DIR_PIN  = 6;

// Общий вывод разрешения драйверов.
// Для A4988 и DRV8825 активный уровень — LOW.
constexpr uint8_t MOTOR_ENABLE_PIN = 8;

// Концевые выключатели.
// Типовая распиновка CNC Shield V3:
// X limit -> D9;
// Y limit -> D10.
constexpr uint8_t EL_LIMIT_PIN = 9;
constexpr uint8_t AZ_LIMIT_PIN = 10;


/* ============================================================
 * Логические уровни и направления
 * ============================================================
 */

// Концевики подключаются между входом и GND.
// Используется INPUT_PULLUP.
constexpr uint8_t LIMIT_TRIGGERED_LEVEL = LOW;

// При необходимости направления меняются на -1.
constexpr int8_t AZ_DIRECTION_SIGN = 1;
constexpr int8_t EL_DIRECTION_SIGN = 1;

// Направление движения к концевому выключателю.
constexpr int8_t AZ_HOME_DIRECTION = -1;
constexpr int8_t EL_HOME_DIRECTION = -1;


/* ============================================================
 * Механические параметры
 * ============================================================
 */

/*
 * Эти коэффициенты необходимо откалибровать под вашу механику.
 *
 * steps/degree =
 *
 * motor_steps_per_revolution
 * × microstep
 * × gear_ratio
 * / 360
 *
 * Значения 100 шагов/градус являются временными безопасными
 * коэффициентами для первичной проверки логики.
 */

constexpr float AZ_STEPS_PER_DEGREE = 100.0F;
constexpr float EL_STEPS_PER_DEGREE = 100.0F;


/* ============================================================
 * Ограничения углов
 * ============================================================
 */

constexpr float AZ_MIN_DEGREES = 0.0F;
constexpr float AZ_MAX_DEGREES = 360.0F;

constexpr float EL_MIN_DEGREES = 0.0F;
constexpr float EL_MAX_DEGREES = 90.0F;

// Положение парковки.
constexpr float PARK_AZ_DEGREES = 0.0F;
constexpr float PARK_EL_DEGREES = 0.0F;


/* ============================================================
 * Параметры движения
 * ============================================================
 */

// Основное движение.
constexpr float AZ_MAX_SPEED_STEPS_PER_SECOND = 1200.0F;
constexpr float EL_MAX_SPEED_STEPS_PER_SECOND = 1200.0F;

constexpr float AZ_ACCELERATION_STEPS_PER_SECOND_SQUARED =
    500.0F;

constexpr float EL_ACCELERATION_STEPS_PER_SECOND_SQUARED =
    500.0F;

// Медленный поиск нулевой точки.
constexpr float AZ_HOME_SPEED_STEPS_PER_SECOND = 250.0F;
constexpr float EL_HOME_SPEED_STEPS_PER_SECOND = 250.0F;

// Максимальное число шагов при поиске концевика.
// Защищает механизм при неисправном выключателе.
constexpr long HOME_MAXIMUM_TRAVEL_STEPS = 100000L;


/* ============================================================
 * Последовательный интерфейс
 * ============================================================
 */

constexpr unsigned long SERIAL_BAUD_RATE = 115200UL;

constexpr size_t COMMAND_BUFFER_SIZE = 128;

constexpr unsigned long POSITION_REPORT_PERIOD_MS = 250UL;


/* ============================================================
 * Объекты двигателей
 * ============================================================
 */

AccelStepper azimuthStepper(
    AccelStepper::DRIVER,
    AZ_STEP_PIN,
    AZ_DIR_PIN
);

AccelStepper elevationStepper(
    AccelStepper::DRIVER,
    EL_STEP_PIN,
    EL_DIR_PIN
);


/* ============================================================
 * Состояния контроллера
 * ============================================================
 */

enum class RotatorState : uint8_t {
    IDLE,
    MOVING,
    HOMING_EL,
    HOMING_AZ,
    STOPPED,
    ERROR_STATE
};

RotatorState rotatorState = RotatorState::IDLE;

bool homed = false;
bool motorsEnabled = false;

char commandBuffer[COMMAND_BUFFER_SIZE];
size_t commandLength = 0;

unsigned long previousPositionReportMs = 0;


/* ============================================================
 * Управление драйверами
 * ============================================================
 */

void enableMotors() {
    digitalWrite(MOTOR_ENABLE_PIN, LOW);

    azimuthStepper.enableOutputs();
    elevationStepper.enableOutputs();

    motorsEnabled = true;
}


void disableMotors() {
    azimuthStepper.disableOutputs();
    elevationStepper.disableOutputs();

    digitalWrite(MOTOR_ENABLE_PIN, HIGH);

    motorsEnabled = false;
}


/* ============================================================
 * Преобразование координат
 * ============================================================
 */

long azimuthDegreesToSteps(const float degrees) {
    return lround(
        degrees *
        AZ_STEPS_PER_DEGREE *
        AZ_DIRECTION_SIGN
    );
}


long elevationDegreesToSteps(const float degrees) {
    return lround(
        degrees *
        EL_STEPS_PER_DEGREE *
        EL_DIRECTION_SIGN
    );
}


float azimuthStepsToDegrees(const long steps) {
    return (
        static_cast<float>(steps) /
        AZ_STEPS_PER_DEGREE /
        AZ_DIRECTION_SIGN
    );
}


float elevationStepsToDegrees(const long steps) {
    return (
        static_cast<float>(steps) /
        EL_STEPS_PER_DEGREE /
        EL_DIRECTION_SIGN
    );
}


float getCurrentAzimuthDegrees() {
    return azimuthStepsToDegrees(
        azimuthStepper.currentPosition()
    );
}


float getCurrentElevationDegrees() {
    return elevationStepsToDegrees(
        elevationStepper.currentPosition()
    );
}


/* ============================================================
 * Состояние концевиков
 * ============================================================
 */

bool isAzimuthLimitTriggered() {
    return (
        digitalRead(AZ_LIMIT_PIN) ==
        LIMIT_TRIGGERED_LEVEL
    );
}


bool isElevationLimitTriggered() {
    return (
        digitalRead(EL_LIMIT_PIN) ==
        LIMIT_TRIGGERED_LEVEL
    );
}


/* ============================================================
 * Передача ответов
 * ============================================================
 */

const __FlashStringHelper *getStateName() {
    switch (rotatorState) {
        case RotatorState::IDLE:
            return F("IDLE");

        case RotatorState::MOVING:
            return F("MOVING");

        case RotatorState::HOMING_EL:
        case RotatorState::HOMING_AZ:
            return F("HOMING");

        case RotatorState::STOPPED:
            return F("STOPPED");

        case RotatorState::ERROR_STATE:
            return F("ERROR");
    }

    return F("UNKNOWN");
}


void sendPosition() {
    Serial.print(F("$ROT,POS,AZ="));
    Serial.print(
        getCurrentAzimuthDegrees(),
        2
    );

    Serial.print(F(",EL="));
    Serial.println(
        getCurrentElevationDegrees(),
        2
    );
}


void sendState() {
    Serial.print(F("$ROT,STATE="));
    Serial.println(getStateName());
}


void sendHomeState() {
    Serial.print(F("$ROT,HOME="));
    Serial.println(
        homed
            ? F("OK")
            : F("NOT_HOMED")
    );
}


void sendAcknowledgement(
    const __FlashStringHelper *message
) {
    Serial.print(F("$ROT,ACK,"));
    Serial.println(message);
}


void sendError(
    const __FlashStringHelper *message
) {
    Serial.print(F("$ROT,ERR,"));
    Serial.println(message);
}


void sendFullStatus() {
    sendPosition();
    sendState();
    sendHomeState();

    Serial.print(F("$ROT,LIMITS,AZ="));
    Serial.print(
        isAzimuthLimitTriggered()
            ? 1
            : 0
    );

    Serial.print(F(",EL="));
    Serial.println(
        isElevationLimitTriggered()
            ? 1
            : 0
    );
}


/* ============================================================
 * Проверка углов
 * ============================================================
 */

bool anglesAreValid(
    const float azimuth,
    const float elevation
) {
    if (
        azimuth < AZ_MIN_DEGREES ||
        azimuth > AZ_MAX_DEGREES
    ) {
        sendError(F("AZ_LIMIT"));

        return false;
    }

    if (
        elevation < EL_MIN_DEGREES ||
        elevation > EL_MAX_DEGREES
    ) {
        sendError(F("EL_LIMIT"));

        return false;
    }

    return true;
}


/* ============================================================
 * Движение к заданным углам
 * ============================================================
 */

void moveToAngles(
    const float azimuth,
    const float elevation
) {
    if (!anglesAreValid(
        azimuth,
        elevation
    )) {
        return;
    }

    /*
     * До выполнения HOME абсолютные углы недостоверны.
     * На первом этапе оставим движение разрешённым для стендовой
     * проверки, но контроллер явно сообщает NOT_HOMED.
     */

    enableMotors();

    azimuthStepper.setMaxSpeed(
        AZ_MAX_SPEED_STEPS_PER_SECOND
    );

    azimuthStepper.setAcceleration(
        AZ_ACCELERATION_STEPS_PER_SECOND_SQUARED
    );

    elevationStepper.setMaxSpeed(
        EL_MAX_SPEED_STEPS_PER_SECOND
    );

    elevationStepper.setAcceleration(
        EL_ACCELERATION_STEPS_PER_SECOND_SQUARED
    );

    azimuthStepper.moveTo(
        azimuthDegreesToSteps(azimuth)
    );

    elevationStepper.moveTo(
        elevationDegreesToSteps(elevation)
    );

    rotatorState = RotatorState::MOVING;

    sendAcknowledgement(F("SET"));
    sendState();
}


/* ============================================================
 * Аварийная остановка
 * ============================================================
 */

void stopMotion() {
    /*
     * stop() выполняет торможение с заданным ускорением.
     * Для немедленного снятия питания предусмотрена отдельная
     * аппаратная кнопка аварийного отключения.
     */

    azimuthStepper.stop();
    elevationStepper.stop();

    rotatorState = RotatorState::STOPPED;

    sendAcknowledgement(F("STOP"));
    sendState();
}


/* ============================================================
 * Поиск нулевого положения
 * ============================================================
 */

void beginHoming() {
    enableMotors();

    homed = false;

    /*
     * Поиск начинается с оси EL.
     * Это уменьшает риск столкновения длинной антенны с опорой.
     */

    elevationStepper.setMaxSpeed(
        EL_HOME_SPEED_STEPS_PER_SECOND
    );

    elevationStepper.setAcceleration(
        EL_ACCELERATION_STEPS_PER_SECOND_SQUARED
    );

    elevationStepper.moveTo(
        elevationStepper.currentPosition() +
        (
            HOME_MAXIMUM_TRAVEL_STEPS *
            EL_HOME_DIRECTION
        )
    );

    rotatorState = RotatorState::HOMING_EL;

    sendAcknowledgement(F("HOME_STARTED"));
    sendState();
}


void processHoming() {
    if (
        rotatorState ==
        RotatorState::HOMING_EL
    ) {
        if (isElevationLimitTriggered()) {
            elevationStepper.setCurrentPosition(0);

            elevationStepper.moveTo(0);

            azimuthStepper.setMaxSpeed(
                AZ_HOME_SPEED_STEPS_PER_SECOND
            );

            azimuthStepper.setAcceleration(
                AZ_ACCELERATION_STEPS_PER_SECOND_SQUARED
            );

            azimuthStepper.moveTo(
                azimuthStepper.currentPosition() +
                (
                    HOME_MAXIMUM_TRAVEL_STEPS *
                    AZ_HOME_DIRECTION
                )
            );

            rotatorState =
                RotatorState::HOMING_AZ;

            sendAcknowledgement(
                F("EL_HOME_FOUND")
            );

            return;
        }

        if (
            elevationStepper.distanceToGo() ==
            0
        ) {
            rotatorState =
                RotatorState::ERROR_STATE;

            sendError(
                F("EL_HOME_NOT_FOUND")
            );

            sendState();
        }

        return;
    }


    if (
        rotatorState ==
        RotatorState::HOMING_AZ
    ) {
        if (isAzimuthLimitTriggered()) {
            azimuthStepper.setCurrentPosition(0);

            azimuthStepper.moveTo(0);

            homed = true;
            rotatorState = RotatorState::IDLE;

            sendAcknowledgement(
                F("AZ_HOME_FOUND")
            );

            sendHomeState();
            sendPosition();
            sendState();

            return;
        }

        if (
            azimuthStepper.distanceToGo() ==
            0
        ) {
            rotatorState =
                RotatorState::ERROR_STATE;

            sendError(
                F("AZ_HOME_NOT_FOUND")
            );

            sendState();
        }
    }
}


/* ============================================================
 * Парковка
 * ============================================================
 */

void parkRotator() {
    moveToAngles(
        PARK_AZ_DEGREES,
        PARK_EL_DEGREES
    );

    sendAcknowledgement(F("PARK"));
}


/* ============================================================
 * Разбор параметров команды
 * ============================================================
 */

bool extractFloatParameter(
    const char *line,
    const char *parameterName,
    float &result
) {
    const char *position =
        strstr(
            line,
            parameterName
        );

    if (position == nullptr) {
        return false;
    }

    position += strlen(parameterName);

    char *endPointer = nullptr;

    result =
        strtod(
            position,
            &endPointer
        );

    return (
        endPointer != position
    );
}


/* ============================================================
 * Обработка команд OpenMCC
 * ============================================================
 */

void processCommand(char *command) {
    while (
        *command == ' ' ||
        *command == '\t'
    ) {
        command++;
    }


    if (
        strncmp(
            command,
            "$ROT,SET,",
            9
        ) == 0
    ) {
        float azimuth = 0.0F;
        float elevation = 0.0F;

        const bool azimuthFound =
            extractFloatParameter(
                command,
                "AZ=",
                azimuth
            );

        const bool elevationFound =
            extractFloatParameter(
                command,
                "EL=",
                elevation
            );

        if (
            !azimuthFound ||
            !elevationFound
        ) {
            sendError(F("SET_FORMAT"));

            return;
        }

        moveToAngles(
            azimuth,
            elevation
        );

        return;
    }


    if (
        strcmp(
            command,
            "$ROT,STOP"
        ) == 0
    ) {
        stopMotion();

        return;
    }


    if (
        strcmp(
            command,
            "$ROT,HOME"
        ) == 0
    ) {
        beginHoming();

        return;
    }


    if (
        strcmp(
            command,
            "$ROT,PARK"
        ) == 0
    ) {
        parkRotator();

        return;
    }


    if (
        strcmp(
            command,
            "$ROT,STATUS"
        ) == 0
    ) {
        sendFullStatus();

        return;
    }


    sendError(F("UNKNOWN_COMMAND"));
}


/* ============================================================
 * Приём последовательных данных
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

            sendError(F("COMMAND_TOO_LONG"));
        }
    }
}


/* ============================================================
 * Обновление движения
 * ============================================================
 */

void updateMotion() {
    /*
     * Эти функции должны вызываться как можно чаще.
     * Внутри loop() не должно быть delay().
     */

    azimuthStepper.run();
    elevationStepper.run();

    processHoming();


    if (
        rotatorState ==
        RotatorState::MOVING
    ) {
        const bool azimuthReached =
            azimuthStepper.distanceToGo() ==
            0;

        const bool elevationReached =
            elevationStepper.distanceToGo() ==
            0;

        if (
            azimuthReached &&
            elevationReached
        ) {
            rotatorState =
                RotatorState::IDLE;

            sendPosition();
            sendState();
            sendAcknowledgement(
                F("TARGET_REACHED")
            );
        }
    }


    if (
        rotatorState ==
        RotatorState::STOPPED
    ) {
        if (
            azimuthStepper.distanceToGo() ==
                0 &&
            elevationStepper.distanceToGo() ==
                0
        ) {
            rotatorState =
                RotatorState::IDLE;

            sendPosition();
            sendState();
        }
    }
}


/* ============================================================
 * Периодическая передача положения
 * ============================================================
 */

void sendPeriodicPosition() {
    const unsigned long currentTimeMs =
        millis();

    if (
        currentTimeMs -
        previousPositionReportMs <
        POSITION_REPORT_PERIOD_MS
    ) {
        return;
    }

    previousPositionReportMs =
        currentTimeMs;

    sendPosition();
}


/* ============================================================
 * Инициализация
 * ============================================================
 */

void setup() {
    pinMode(
        MOTOR_ENABLE_PIN,
        OUTPUT
    );

    pinMode(
        AZ_LIMIT_PIN,
        INPUT_PULLUP
    );

    pinMode(
        EL_LIMIT_PIN,
        INPUT_PULLUP
    );

    digitalWrite(
        MOTOR_ENABLE_PIN,
        HIGH
    );


    azimuthStepper.setEnablePin(
        MOTOR_ENABLE_PIN
    );

    elevationStepper.setEnablePin(
        MOTOR_ENABLE_PIN
    );


    azimuthStepper.setPinsInverted(
        false,
        false,
        true
    );

    elevationStepper.setPinsInverted(
        false,
        false,
        true
    );


    azimuthStepper.setMinPulseWidth(3);
    elevationStepper.setMinPulseWidth(3);


    azimuthStepper.setMaxSpeed(
        AZ_MAX_SPEED_STEPS_PER_SECOND
    );

    azimuthStepper.setAcceleration(
        AZ_ACCELERATION_STEPS_PER_SECOND_SQUARED
    );


    elevationStepper.setMaxSpeed(
        EL_MAX_SPEED_STEPS_PER_SECOND
    );

    elevationStepper.setAcceleration(
        EL_ACCELERATION_STEPS_PER_SECOND_SQUARED
    );


    disableMotors();


    Serial.begin(
        SERIAL_BAUD_RATE
    );

    delay(400);

    Serial.println(
        F("$ROT,ACK,OPENMCC_ROTATOR_READY")
    );

    sendFullStatus();
}


/* ============================================================
 * Основной цикл
 * ============================================================
 */

void loop() {
    readSerialCommands();

    updateMotion();

    sendPeriodicPosition();
}