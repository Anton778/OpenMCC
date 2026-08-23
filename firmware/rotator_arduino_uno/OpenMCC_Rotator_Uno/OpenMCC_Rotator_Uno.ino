#include <Arduino.h>

/*
 * OpenMCC Rotator Controller
 * Firmware version: 0.1.0
 * Target: Arduino Uno + CNC Shield V3 + 2 x stepper drivers + 2 x NEMA17
 * Intended mechanics: SatNOGS Rotator v3 / compatible two-axis AZ-EL rotator
 *
 * OpenMCC protocol, 115200 baud:
 *   $ROT,SET,AZ=123.45,EL=45.00
 *   $ROT,STOP
 *   $ROT,HOME
 *   $ROT,PARK
 *   $ROT,STATUS
 *
 * Responses:
 *   $ROT,ACK,...
 *   $ROT,POS,AZ=...,EL=...
 *   $ROT,STATE=IDLE|MOVING|HOMING|STOPPED|ERROR
 *   $ROT,HOME=OK|NO
 *   $ROT,ERR,...
 *
 * IMPORTANT BEFORE FIRST REAL MOVEMENT:
 * 1) verify motor directions;
 * 2) verify limit-switch polarity;
 * 3) measure the real transmission ratio of the assembled rotator;
 * 4) set AZ_GEAR_RATIO and EL_GEAR_RATIO below;
 * 5) start with low driver current and low motion speed.
 */

namespace OpenMCCRotator {

constexpr char FW_VERSION[] = "0.1.0";
constexpr unsigned long SERIAL_BAUD = 115200UL;

// CNC Shield V3: X axis is AZ, Y axis is EL.
constexpr uint8_t AZ_STEP_PIN = 2;   // X.STEP
constexpr uint8_t EL_STEP_PIN = 3;   // Y.STEP
constexpr uint8_t AZ_DIR_PIN  = 5;   // X.DIR
constexpr uint8_t EL_DIR_PIN  = 6;   // Y.DIR
constexpr uint8_t ENABLE_PIN  = 8;   // ENABLE, active LOW

// End-stop inputs. Connect switches between input and GND.
constexpr uint8_t AZ_HOME_PIN = 9;   // X- limit
constexpr uint8_t EL_HOME_PIN = 10;  // Y- limit

constexpr bool HOME_SWITCH_ACTIVE_LOW = true;
constexpr bool AZ_DIRECTION_INVERTED = false;
constexpr bool EL_DIRECTION_INVERTED = false;
constexpr bool HOLD_MOTORS_WHEN_IDLE = true;

// Typical NEMA17 motor: 200 full steps/revolution.
constexpr float MOTOR_FULL_STEPS_PER_REV = 200.0f;

// Must match the jumpers installed on CNC Shield: 1, 2, 4, 8, 16, ...
constexpr float MICROSTEPS = 16.0f;

// Set these after measuring the assembled SatNOGS v3 transmission.
// 1.0 is deliberately conservative: the firmware will compile and can be
// bench-tested, but the angular scale is not considered calibrated until
// these values are replaced with the real mechanical ratios.
constexpr float AZ_GEAR_RATIO = 1.0f;
constexpr float EL_GEAR_RATIO = 1.0f;

constexpr float AZ_STEPS_PER_DEGREE =
    MOTOR_FULL_STEPS_PER_REV * MICROSTEPS * AZ_GEAR_RATIO / 360.0f;
constexpr float EL_STEPS_PER_DEGREE =
    MOTOR_FULL_STEPS_PER_REV * MICROSTEPS * EL_GEAR_RATIO / 360.0f;

constexpr float AZ_MIN_DEG = 0.0f;
constexpr float AZ_MAX_DEG = 360.0f;
constexpr float EL_MIN_DEG = 0.0f;
constexpr float EL_MAX_DEG = 90.0f;

// Step-rate limits. Reduce these during first mechanical tests if necessary.
constexpr unsigned long NORMAL_STEP_INTERVAL_US = 1600UL; // ~625 step/s
constexpr unsigned long HOME_STEP_INTERVAL_US   = 2600UL; // ~385 step/s
constexpr unsigned int STEP_PULSE_US = 4;
constexpr unsigned long POSITION_REPORT_MS = 500UL;
constexpr unsigned long HOMING_TIMEOUT_MS = 120000UL;

constexpr size_t RX_BUFFER_SIZE = 96;

char rxBuffer[RX_BUFFER_SIZE];
size_t rxLength = 0;

long currentAzSteps = 0;
long currentElSteps = 0;
long targetAzSteps = 0;
long targetElSteps = 0;

bool homed = false;
bool moving = false;
bool homing = false;
bool azHomeReached = false;
bool elHomeReached = false;

unsigned long lastAzStepUs = 0;
unsigned long lastElStepUs = 0;
unsigned long homingStartedMs = 0;
unsigned long lastPositionReportMs = 0;

const char* motionState = "IDLE";

bool switchActive(uint8_t pin) {
    const int value = digitalRead(pin);
    return HOME_SWITCH_ACTIVE_LOW ? (value == LOW) : (value == HIGH);
}

void setDriversEnabled(bool enabled) {
    digitalWrite(ENABLE_PIN, enabled ? LOW : HIGH);
}

void setDirection(uint8_t pin, bool positive, bool inverted) {
    const bool level = inverted ? !positive : positive;
    digitalWrite(pin, level ? HIGH : LOW);
}

void pulse(uint8_t pin) {
    digitalWrite(pin, HIGH);
    delayMicroseconds(STEP_PULSE_US);
    digitalWrite(pin, LOW);
}

long degreesToSteps(float degrees, float stepsPerDegree) {
    const float steps = degrees * stepsPerDegree;
    return (long)(steps >= 0.0f ? steps + 0.5f : steps - 0.5f);
}

float stepsToDegrees(long steps, float stepsPerDegree) {
    if (stepsPerDegree <= 0.0f) return 0.0f;
    return (float)steps / stepsPerDegree;
}

float currentAzDegrees() {
    return stepsToDegrees(currentAzSteps, AZ_STEPS_PER_DEGREE);
}

float currentElDegrees() {
    return stepsToDegrees(currentElSteps, EL_STEPS_PER_DEGREE);
}

void sendState() {
    Serial.print(F("$ROT,STATE="));
    Serial.println(motionState);
}

void sendHomeState() {
    Serial.print(F("$ROT,HOME="));
    Serial.println(homed ? F("OK") : F("NO"));
}

void sendPosition() {
    Serial.print(F("$ROT,POS,AZ="));
    Serial.print(currentAzDegrees(), 2);
    Serial.print(F(",EL="));
    Serial.println(currentElDegrees(), 2);
}

void sendStatus() {
    sendPosition();
    sendState();
    sendHomeState();
}

void sendAck(const __FlashStringHelper* command) {
    Serial.print(F("$ROT,ACK,"));
    Serial.println(command);
}

void sendError(const __FlashStringHelper* code) {
    motionState = "ERROR";
    Serial.print(F("$ROT,ERR,"));
    Serial.println(code);
}

void stopMotion(const char* stateAfterStop = "STOPPED") {
    moving = false;
    homing = false;
    targetAzSteps = currentAzSteps;
    targetElSteps = currentElSteps;
    motionState = stateAfterStop;

    if (!HOLD_MOTORS_WHEN_IDLE) {
        setDriversEnabled(false);
    }
}

bool inRange(float azimuth, float elevation) {
    return azimuth >= AZ_MIN_DEG && azimuth <= AZ_MAX_DEG &&
           elevation >= EL_MIN_DEG && elevation <= EL_MAX_DEG;
}

bool parseValue(const char* line, const char* key, float& value) {
    const char* location = strstr(line, key);
    if (!location) return false;

    location += strlen(key);
    char* endPtr = nullptr;
    const double parsed = strtod(location, &endPtr);
    if (endPtr == location) return false;

    value = (float)parsed;
    return true;
}

void beginMove(float azimuth, float elevation) {
    if (!homed) {
        sendError(F("NOT_HOMED"));
        Serial.println(F("$ROT,HOME=NO"));
        return;
    }

    if (!inRange(azimuth, elevation)) {
        sendError(F("ANGLE_OUT_OF_RANGE"));
        return;
    }

    targetAzSteps = degreesToSteps(azimuth, AZ_STEPS_PER_DEGREE);
    targetElSteps = degreesToSteps(elevation, EL_STEPS_PER_DEGREE);

    setDriversEnabled(true);
    moving = true;
    homing = false;
    motionState = "MOVING";
    sendAck(F("SET"));
    sendState();
}

void beginHoming() {
    setDriversEnabled(true);

    moving = false;
    homing = true;
    homed = false;
    azHomeReached = switchActive(AZ_HOME_PIN);
    elHomeReached = switchActive(EL_HOME_PIN);
    homingStartedMs = millis();
    motionState = "HOMING";

    if (azHomeReached) currentAzSteps = 0;
    if (elHomeReached) currentElSteps = 0;

    sendAck(F("HOME"));
    sendState();
}

void finishHoming() {
    currentAzSteps = 0;
    currentElSteps = 0;
    targetAzSteps = 0;
    targetElSteps = 0;

    homing = false;
    moving = false;
    homed = true;
    motionState = "IDLE";

    if (!HOLD_MOTORS_WHEN_IDLE) {
        setDriversEnabled(false);
    }

    Serial.println(F("$ROT,HOME=OK"));
    sendPosition();
    sendState();
}

void serviceHoming() {
    if (!homing) return;

    if (millis() - homingStartedMs > HOMING_TIMEOUT_MS) {
        stopMotion("ERROR");
        homed = false;
        Serial.println(F("$ROT,ERR,HOMING_TIMEOUT"));
        Serial.println(F("$ROT,HOME=NO"));
        return;
    }

    const unsigned long nowUs = micros();

    if (!azHomeReached) {
        if (switchActive(AZ_HOME_PIN)) {
            azHomeReached = true;
            currentAzSteps = 0;
        } else if (nowUs - lastAzStepUs >= HOME_STEP_INTERVAL_US) {
            lastAzStepUs = nowUs;
            setDirection(AZ_DIR_PIN, false, AZ_DIRECTION_INVERTED);
            pulse(AZ_STEP_PIN);
            --currentAzSteps;
        }
    }

    if (!elHomeReached) {
        if (switchActive(EL_HOME_PIN)) {
            elHomeReached = true;
            currentElSteps = 0;
        } else if (nowUs - lastElStepUs >= HOME_STEP_INTERVAL_US) {
            lastElStepUs = nowUs;
            setDirection(EL_DIR_PIN, false, EL_DIRECTION_INVERTED);
            pulse(EL_STEP_PIN);
            --currentElSteps;
        }
    }

    if (azHomeReached && elHomeReached) {
        finishHoming();
    }
}

void serviceMotion() {
    if (!moving || homing) return;

    const unsigned long nowUs = micros();
    bool azDone = currentAzSteps == targetAzSteps;
    bool elDone = currentElSteps == targetElSteps;

    if (!azDone && nowUs - lastAzStepUs >= NORMAL_STEP_INTERVAL_US) {
        lastAzStepUs = nowUs;
        const bool positive = targetAzSteps > currentAzSteps;
        setDirection(AZ_DIR_PIN, positive, AZ_DIRECTION_INVERTED);
        pulse(AZ_STEP_PIN);
        currentAzSteps += positive ? 1 : -1;
        azDone = currentAzSteps == targetAzSteps;
    }

    if (!elDone && nowUs - lastElStepUs >= NORMAL_STEP_INTERVAL_US) {
        lastElStepUs = nowUs;
        const bool positive = targetElSteps > currentElSteps;
        setDirection(EL_DIR_PIN, positive, EL_DIRECTION_INVERTED);
        pulse(EL_STEP_PIN);
        currentElSteps += positive ? 1 : -1;
        elDone = currentElSteps == targetElSteps;
    }

    if (azDone && elDone) {
        moving = false;
        motionState = "IDLE";
        if (!HOLD_MOTORS_WHEN_IDLE) {
            setDriversEnabled(false);
        }
        sendPosition();
        sendState();
    }
}

void processCommand(const char* line) {
    if (strcmp(line, "$ROT,STATUS") == 0) {
        sendStatus();
        return;
    }

    if (strcmp(line, "$ROT,STOP") == 0) {
        stopMotion("STOPPED");
        sendAck(F("STOP"));
        sendPosition();
        sendState();
        return;
    }

    if (strcmp(line, "$ROT,HOME") == 0) {
        beginHoming();
        return;
    }

    if (strcmp(line, "$ROT,PARK") == 0) {
        if (!homed) {
            sendError(F("NOT_HOMED"));
            Serial.println(F("$ROT,HOME=NO"));
            return;
        }
        beginMove(0.0f, 0.0f);
        return;
    }

    if (strncmp(line, "$ROT,SET,", 9) == 0) {
        float azimuth = 0.0f;
        float elevation = 0.0f;

        if (!parseValue(line, "AZ=", azimuth) ||
            !parseValue(line, "EL=", elevation)) {
            sendError(F("BAD_SET_COMMAND"));
            return;
        }

        beginMove(azimuth, elevation);
        return;
    }

    if (strcmp(line, "$ROT,INFO") == 0) {
        Serial.print(F("$ROT,ACK,INFO,FW="));
        Serial.print(FW_VERSION);
        Serial.println(F(",BOARD=ARDUINO_UNO,CNC_SHIELD=V3"));
        return;
    }

    sendError(F("UNKNOWN_COMMAND"));
}

void serviceSerial() {
    while (Serial.available() > 0) {
        const char c = (char)Serial.read();

        if (c == '\r') continue;

        if (c == '\n') {
            if (rxLength > 0) {
                rxBuffer[rxLength] = '\0';
                processCommand(rxBuffer);
                rxLength = 0;
            }
            continue;
        }

        if (rxLength < RX_BUFFER_SIZE - 1) {
            rxBuffer[rxLength++] = c;
        } else {
            rxLength = 0;
            sendError(F("RX_OVERFLOW"));
        }
    }
}

void periodicReport() {
    if (!(moving || homing)) return;

    const unsigned long now = millis();
    if (now - lastPositionReportMs >= POSITION_REPORT_MS) {
        lastPositionReportMs = now;
        sendPosition();
    }
}

void setup() {
    pinMode(AZ_STEP_PIN, OUTPUT);
    pinMode(EL_STEP_PIN, OUTPUT);
    pinMode(AZ_DIR_PIN, OUTPUT);
    pinMode(EL_DIR_PIN, OUTPUT);
    pinMode(ENABLE_PIN, OUTPUT);

    pinMode(AZ_HOME_PIN, INPUT_PULLUP);
    pinMode(EL_HOME_PIN, INPUT_PULLUP);

    digitalWrite(AZ_STEP_PIN, LOW);
    digitalWrite(EL_STEP_PIN, LOW);
    setDriversEnabled(false);

    Serial.begin(SERIAL_BAUD);
    delay(300);

    Serial.print(F("$ROT,ACK,BOOT,FW="));
    Serial.print(FW_VERSION);
    Serial.println(F(",BOARD=ARDUINO_UNO"));
    sendHomeState();
    sendState();
}

void loop() {
    serviceSerial();
    serviceHoming();
    serviceMotion();
    periodicReport();
}

} // namespace OpenMCCRotator

void setup() {
    OpenMCCRotator::setup();
}

void loop() {
    OpenMCCRotator::loop();
}
