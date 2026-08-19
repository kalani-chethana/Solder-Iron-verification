#include <Arduino.h>
#include <string.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <IRremote.hpp>
#include <Wire.h>
#include <U8g2lib.h>

// Overall workflow:
//   1. Scan a user QR code and validate it through the backend.
//   2. Scan a soldering-iron code and validate that as well.
//   3. Receive the thermometer's digit burst over IR.
//   4. Save the user, iron, temperature, and unit in MySQL.
// The user stays logged in after a successful save so multiple irons can be
// tested. Scanning the same user again (or LOGOUT) ends the session.

// =====================================================
// ESP32 pin configuration
// =====================================================

#define IR_RECEIVE_PIN 5
#define OLED_SDA_PIN 21
#define OLED_SCL_PIN 22

#define SCANNER_RX_PIN 16
#define SCANNER_TX_PIN 17
#define SCANNER_BAUD_RATE 9600

// =====================================================
// Wi-Fi and backend configuration
// =====================================================

const char *WIFI_SSID = "3S AP Uni";
const char *WIFI_PASSWORD = "3s290420097fab";

// Use your backend computer's LAN IPv4 address.
// Do not use localhost or 127.0.0.1 on the ESP32.
const char *BACKEND_BASE_URL = "http://192.168.0.62:5000/api";

const char *TEMPERATURE_UNIT = "F";

// =====================================================
// Devices
// =====================================================

HardwareSerial ScannerSerial(2);

U8G2_SH1106_128X64_NONAME_F_HW_I2C u8g2(
  U8G2_R0,
  U8X8_PIN_NONE
);

// =====================================================
// Workflow states
// =====================================================

enum SystemState {
  WAITING_FOR_USER,
  WAITING_FOR_IRON,
  WAITING_FOR_TEMPERATURE,
  SAVING_VALIDATION
};

SystemState currentState = WAITING_FOR_USER;

// Values returned by the database backend.
uint32_t currentUserId = 0;
String currentUserCode = "";
String currentUserName = "";

uint32_t currentIronId = 0;
String currentIronCode = "";
String currentIronName = "";

// Pending validation is retained when saving fails.
float pendingTemperature = 0.0f;
bool pendingSave = false;
uint32_t lastSaveRetryMs = 0;
static constexpr uint32_t SAVE_RETRY_INTERVAL_MS = 5000;

// =====================================================
// IR burst configuration
// =====================================================

static constexpr uint32_t BURST_GAP_MS = 250;
static constexpr size_t MAX_BURST_COMMANDS = 16;

static bool haveBurst = false;
static uint32_t lastFrameMs = 0;
static uint8_t burstCommands[MAX_BURST_COMMANDS];
static size_t burstCount = 0;

// =====================================================
// OLED Wi-Fi icon configuration
// =====================================================

static bool lastDisplayedWiFiConnected = false;
static bool lastDisplayedWiFiConnecting = false;
static bool wifiDisplayInitialized = false;

static uint32_t lastWifiIconUpdateMs = 0;

static constexpr uint32_t WIFI_ICON_UPDATE_MS = 500;

// =====================================================
// OLED Wi-Fi icon
// =====================================================
//
// The icon is drawn manually because the SH1106 cannot directly
// display a PNG/JPG image.
//
// Location:
//     top-right corner
//
// Connected:
//     normal Wi-Fi symbol
//
// Connecting:
//     Wi-Fi symbol with small blinking dot
//
// Disconnected:
//     small X
//
// =====================================================

void drawWifiIcon() {

  bool connected = (WiFi.status() == WL_CONNECTED);

  bool connecting =
    !connected &&
    (WiFi.status() == WL_NO_SSID_AVAIL ||
     WiFi.status() == WL_IDLE_STATUS ||
     WiFi.status() == WL_DISCONNECTED);

  // Icon position
  const int cx = 113;
  const int topY = 6;

  if (connected) {

    // -------------------------------------------------
    // Connected Wi-Fi symbol
    // -------------------------------------------------

    // Top arc
    u8g2.drawLine(cx - 12, topY + 4, cx - 9, topY + 2);
    u8g2.drawLine(cx - 9, topY + 2, cx - 5, topY + 1);
    u8g2.drawLine(cx - 5, topY + 1, cx, topY);
    u8g2.drawLine(cx, topY, cx + 5, topY + 1);
    u8g2.drawLine(cx + 5, topY + 1, cx + 9, topY + 2);
    u8g2.drawLine(cx + 9, topY + 2, cx + 12, topY + 4);

    // Middle arc
    u8g2.drawLine(cx - 8, topY + 8, cx - 5, topY + 6);
    u8g2.drawLine(cx - 5, topY + 6, cx - 2, topY + 5);
    u8g2.drawLine(cx - 2, topY + 5, cx + 2, topY + 5);
    u8g2.drawLine(cx + 2, topY + 5, cx + 5, topY + 6);
    u8g2.drawLine(cx + 5, topY + 6, cx + 8, topY + 8);

    // Bottom arc
    u8g2.drawLine(cx - 4, topY + 12, cx - 2, topY + 10);
    u8g2.drawLine(cx - 2, topY + 10, cx + 2, topY + 10);
    u8g2.drawLine(cx + 2, topY + 10, cx + 4, topY + 12);

    // Center dot
    u8g2.drawDisc(cx, topY + 15, 2);

  } else if (connecting) {

    // -------------------------------------------------
    // Connecting symbol
    // -------------------------------------------------

    u8g2.drawLine(cx - 10, topY + 5, cx - 7, topY + 3);
    u8g2.drawLine(cx - 7, topY + 3, cx - 3, topY + 2);
    u8g2.drawLine(cx - 3, topY + 2, cx, topY + 1);
    u8g2.drawLine(cx, topY + 1, cx + 4, topY + 2);
    u8g2.drawLine(cx + 4, topY + 2, cx + 8, topY + 4);
    u8g2.drawLine(cx + 8, topY + 4, cx + 10, topY + 5);

    u8g2.drawLine(cx - 6, topY + 9, cx - 3, topY + 7);
    u8g2.drawLine(cx - 3, topY + 7, cx, topY + 6);
    u8g2.drawLine(cx, topY + 6, cx + 3, topY + 7);
    u8g2.drawLine(cx + 3, topY + 7, cx + 6, topY + 9);

    // Blinking dot
    if ((millis() / 500) % 2 == 0) {
      u8g2.drawDisc(cx, topY + 14, 2);
    } else {
      u8g2.drawCircle(cx, topY + 14, 2);
    }

  } else {

    // -------------------------------------------------
    // Disconnected X
    // -------------------------------------------------

    u8g2.drawLine(cx - 6, topY + 5, cx + 6, topY + 15);
    u8g2.drawLine(cx + 6, topY + 5, cx - 6, topY + 15);

  }
}

// =====================================================
// OLED functions
// =====================================================

void showTwoLines(const String &line1, const String &line2) {

  String firstLine = line1;
  String secondLine = line2;

  if (firstLine.length() > 20) {
    firstLine = firstLine.substring(0, 20);
  }

  if (secondLine.length() > 20) {
    secondLine = secondLine.substring(0, 20);
  }

  u8g2.clearBuffer();

  // Header
  u8g2.setFont(u8g2_font_5x8_tf);

  u8g2.drawStr(3, 8, "ESP32");

  // Wi-Fi icon in top-right corner
  drawWifiIcon();

  // Main text
  u8g2.setFont(u8g2_font_6x12_tf);

  int x1 =
    (128 - u8g2.getStrWidth(firstLine.c_str())) / 2;

  int x2 =
    (128 - u8g2.getStrWidth(secondLine.c_str())) / 2;

  if (x1 < 0) x1 = 0;
  if (x2 < 0) x2 = 0;

  u8g2.drawStr(x1, 29, firstLine.c_str());
  u8g2.drawStr(x2, 51, secondLine.c_str());

  u8g2.sendBuffer();
}

// =====================================================
// Temperature OLED
// =====================================================

void showTemperatureOnOLED(float temperature) {

  char temperatureText[20];

  snprintf(
    temperatureText,
    sizeof(temperatureText),
    "%.0f %s",
    temperature,
    TEMPERATURE_UNIT
  );

  u8g2.clearBuffer();

  // Header
  u8g2.setFont(u8g2_font_5x8_tf);

  u8g2.drawStr(3, 8, "TEMP");

  // Wi-Fi icon
  drawWifiIcon();

  // Temperature
  u8g2.setFont(u8g2_font_logisoso28_tf);

  int xPosition =
    (128 - u8g2.getStrWidth(temperatureText)) / 2;

  if (xPosition < 0) xPosition = 0;

  u8g2.drawStr(
    xPosition,
    50,
    temperatureText
  );

  u8g2.sendBuffer();
}

// =====================================================
// OLED state refresh
// =====================================================

void refreshCurrentOLED() {

  switch (currentState) {

    case WAITING_FOR_USER:
      showTwoLines(
        "Scan User QR",
        "Waiting..."
      );
      break;

    case WAITING_FOR_IRON:
      showTwoLines(
        currentUserName,
        "Scan Iron"
      );
      break;

    case WAITING_FOR_TEMPERATURE:
      showTwoLines(
        currentIronCode,
        "Send Temperature"
      );
      break;

    case SAVING_VALIDATION:
      showTwoLines(
        "Saving...",
        currentIronCode
      );
      break;
  }
}

// =====================================================
// Update Wi-Fi icon automatically
// =====================================================

void updateWiFiDisplay() {

  const uint32_t now = millis();

  if (now - lastWifiIconUpdateMs <
      WIFI_ICON_UPDATE_MS) {
    return;
  }

  lastWifiIconUpdateMs = now;

  bool connected =
    (WiFi.status() == WL_CONNECTED);

  bool connecting =
    !connected &&
    (WiFi.status() == WL_NO_SSID_AVAIL ||
     WiFi.status() == WL_IDLE_STATUS ||
     WiFi.status() == WL_DISCONNECTED);

  bool changed =
    !wifiDisplayInitialized ||
    connected != lastDisplayedWiFiConnected ||
    connecting != lastDisplayedWiFiConnecting;

  // During connecting, redraw periodically so the dot blinks.
  bool blinkUpdate =
    connecting;

  if (changed || blinkUpdate) {

    lastDisplayedWiFiConnected = connected;
    lastDisplayedWiFiConnecting = connecting;
    wifiDisplayInitialized = true;

    // Don't change workflow state.
    // Just redraw the current OLED screen.
    if (currentState != WAITING_FOR_USER ||
        !haveBurst) {

      refreshCurrentOLED();
    }
  }
}

// =====================================================
// OLED user screen
// =====================================================

void showScanUserScreen() {

  showTwoLines(
    "Scan User QR",
    "Waiting..."
  );
}

// =====================================================
// OLED iron screen
// =====================================================

void showScanIronScreen() {

  showTwoLines(
    currentUserName,
    "Scan Iron"
  );
}

// =====================================================
// OLED temperature waiting screen
// =====================================================

void showWaitingTemperatureScreen() {

  showTwoLines(
    currentIronCode,
    "Send Temperature"
  );
}

// =====================================================
// Wi-Fi
// =====================================================

bool ensureWiFiConnected(uint32_t timeoutMs = 10000) {

  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  delay(200);

  WiFi.begin(
    WIFI_SSID,
    WIFI_PASSWORD
  );

  Serial.print(
    F("Connecting to Wi-Fi")
  );

  const uint32_t startedAt = millis();

  while (
    WiFi.status() != WL_CONNECTED
  ) {

    if (
      millis() - startedAt >= timeoutMs
    ) {

      Serial.println(
        F("\nWi-Fi connection timeout")
      );

      return false;
    }

    delay(250);

    Serial.print('.');
  }

  Serial.println();

  Serial.print(
    F("Wi-Fi connected. ESP32 IP: ")
  );

  Serial.println(
    WiFi.localIP()
  );

  return true;
}

// =====================================================
// HTTP JSON helper
// =====================================================

bool postJson(
  const String &endpoint,
  const JsonDocument &requestDocument,
  JsonDocument &responseDocument,
  int &httpStatus
) {

  httpStatus = -1;

  if (!ensureWiFiConnected()) {

    Serial.println(
      F("API request cancelled: no Wi-Fi")
    );

    return false;
  }

  WiFiClient client;
  HTTPClient http;

  const String url =
    String(BACKEND_BASE_URL) +
    endpoint;

  if (!http.begin(client, url)) {

    Serial.println(
      F("HTTP begin failed")
    );

    return false;
  }

  http.addHeader(
    "Content-Type",
    "application/json"
  );

  http.setTimeout(8000);

  String requestBody;

  serializeJson(
    requestDocument,
    requestBody
  );

  Serial.print(F("POST "));
  Serial.println(url);

  Serial.print(F("Request: "));
  Serial.println(requestBody);

  httpStatus =
    http.POST(requestBody);

  const String responseBody =
    http.getString();

  Serial.print(F("HTTP status: "));
  Serial.println(httpStatus);

  Serial.print(F("Response: "));
  Serial.println(responseBody);

  bool responseParsed = false;

  if (responseBody.length() > 0) {

    const DeserializationError error =
      deserializeJson(
        responseDocument,
        responseBody
      );

    if (error) {

      Serial.print(
        F("JSON parse error: ")
      );

      Serial.println(
        error.c_str()
      );

    } else {

      responseParsed = true;
    }
  }

  http.end();

  return
    httpStatus > 0 &&
    responseParsed;
}

// =====================================================
// Backend/database API calls
// =====================================================

bool checkUserFromDatabase(
  const String &scannedUserCode
) {

  JsonDocument requestDocument;
  JsonDocument responseDocument;

  requestDocument["user_code"] =
    scannedUserCode;

  int httpStatus = -1;

  if (
    !postJson(
      "/check-user",
      requestDocument,
      responseDocument,
      httpStatus
    )
  ) {
    return false;
  }

  const bool valid =
    responseDocument["valid"] | false;

  if (
    httpStatus != 200 ||
    !valid
  ) {
    return false;
  }

  currentUserId =
    responseDocument["user_id"] | 0;

  currentUserCode =
    String(
      (const char *)
      (responseDocument["user_code"] | "")
    );

  currentUserName =
    String(
      (const char *)
      (responseDocument["user_name"] | "")
    );

  return
    currentUserId > 0 &&
    currentUserCode.length() > 0;
}

bool checkIronFromDatabase(
  const String &scannedIronCode
) {

  JsonDocument requestDocument;
  JsonDocument responseDocument;

  requestDocument["iron_code"] =
    scannedIronCode;

  int httpStatus = -1;

  if (
    !postJson(
      "/check-iron",
      requestDocument,
      responseDocument,
      httpStatus
    )
  ) {
    return false;
  }

  const bool valid =
    responseDocument["valid"] | false;

  if (
    httpStatus != 200 ||
    !valid
  ) {
    return false;
  }

  currentIronId =
    responseDocument["iron_id"] | 0;

  currentIronCode =
    String(
      (const char *)
      (responseDocument["iron_code"] | "")
    );

  currentIronName =
    String(
      (const char *)
      (responseDocument["iron_name"] | "")
    );

  return
    currentIronId > 0 &&
    currentIronCode.length() > 0;
}

bool saveValidationToDatabase(
  float temperature
) {

  if (
    currentUserId == 0 ||
    currentIronId == 0
  ) {

    Serial.println(
      F("Cannot save: database IDs are missing")
    );

    return false;
  }

  JsonDocument requestDocument;
  JsonDocument responseDocument;

  requestDocument["user_id"] =
    currentUserId;

  requestDocument["iron_id"] =
    currentIronId;

  requestDocument["temperature"] =
    temperature;

  requestDocument["unit"] =
    TEMPERATURE_UNIT;

  int httpStatus = -1;

  if (
    !postJson(
      "/save-validation",
      requestDocument,
      responseDocument,
      httpStatus
    )
  ) {
    return false;
  }

  return
    httpStatus == 201 &&
    (responseDocument["success"] | false);
}

// =====================================================
// QR/barcode handling
// =====================================================

String extractQrValue(
  String scannedData
) {

  scannedData.trim();

  const int queryPosition =
    scannedData.indexOf('?');

  if (queryPosition >= 0) {

    scannedData =
      scannedData.substring(
        0,
        queryPosition
      );
  }

  while (
    scannedData.endsWith("/")
  ) {

    scannedData.remove(
      scannedData.length() - 1
    );
  }

  if (
    scannedData.startsWith("http://") ||
    scannedData.startsWith("https://")
  ) {

    const int lastSlashPosition =
      scannedData.lastIndexOf('/');

    if (
      lastSlashPosition >= 0 &&
      lastSlashPosition <
        scannedData.length() - 1
    ) {

      scannedData =
        scannedData.substring(
          lastSlashPosition + 1
        );
    }
  }

  scannedData.trim();
  scannedData.toUpperCase();

  return scannedData;
}

void clearCurrentIron() {

  currentIronId = 0;
  currentIronCode = "";
  currentIronName = "";
}

void logoutCurrentUser() {

  currentUserId = 0;
  currentUserCode = "";
  currentUserName = "";

  clearCurrentIron();

  pendingSave = false;
  pendingTemperature = 0.0f;

  currentState =
    WAITING_FOR_USER;

  Serial.println(
    F("User logged out")
  );

  showTwoLines(
    "Logged Out",
    "Scan User"
  );

  delay(1200);

  showScanUserScreen();
}

void processScannedCode(
  String scannedCode
) {

  scannedCode =
    extractQrValue(
      scannedCode
    );

  if (
    scannedCode.length() == 0
  ) {
    return;
  }

  Serial.println();

  Serial.print(
    F("Scanned code: ")
  );

  Serial.println(
    scannedCode
  );

  // Optional special logout barcode
  if (
    scannedCode == "LOGOUT"
  ) {

    logoutCurrentUser();

    return;
  }

  // =====================================================
  // Same logged-in user scanned again -> logout
  // =====================================================

  if (
    currentUserId > 0 &&
    scannedCode == currentUserCode
  ) {

    Serial.println(
      F("Same user QR scanned again")
    );

    Serial.println(
      F("Logging out current user")
    );

    logoutCurrentUser();

    return;
  }

  // =====================================================
  // Check whether scanned value is another valid user
  // =====================================================

  if (currentUserId > 0) {

    const uint32_t previousUserId =
      currentUserId;

    const String previousUserCode =
      currentUserCode;

    const String previousUserName =
      currentUserName;

    showTwoLines(
      "Checking User",
      scannedCode
    );

    if (
      checkUserFromDatabase(
        scannedCode
      )
    ) {

      Serial.println(
        F("Another valid user QR scanned")
      );

      clearCurrentIron();

      pendingSave = false;
      pendingTemperature = 0.0f;

      Serial.print(
        F("Previous user: ")
      );

      Serial.println(
        previousUserCode
      );

      Serial.print(
        F("New user: ")
      );

      Serial.println(
        currentUserCode
      );

      showTwoLines(
        "User Changed",
        currentUserName
      );

      delay(1500);

      currentState =
        WAITING_FOR_IRON;

      showScanIronScreen();

      return;
    }

    currentUserId =
      previousUserId;

    currentUserCode =
      previousUserCode;

    currentUserName =
      previousUserName;
  }

  // =====================================================
  // No user logged in
  // =====================================================

  if (
    currentState ==
    WAITING_FOR_USER
  ) {

    showTwoLines(
      "Checking User",
      scannedCode
    );

    if (
      !checkUserFromDatabase(
        scannedCode
      )
    ) {

      Serial.println(
        F("User not found in database or API failed")
      );

      showTwoLines(
        "Invalid User",
        "Scan Again"
      );

      delay(1500);

      showScanUserScreen();

      return;
    }

    Serial.print(
      F("Database user ID: ")
    );

    Serial.println(
      currentUserId
    );

    Serial.print(
      F("User code: ")
    );

    Serial.println(
      currentUserCode
    );

    Serial.print(
      F("User name: ")
    );

    Serial.println(
      currentUserName
    );

    showTwoLines(
      "Welcome",
      currentUserName
    );

    delay(1500);

    currentState =
      WAITING_FOR_IRON;

    showScanIronScreen();

    return;
  }

  // =====================================================
  // Waiting for iron barcode
  // =====================================================

  if (
    currentState ==
    WAITING_FOR_IRON
  ) {

    showTwoLines(
      "Checking Iron",
      scannedCode
    );

    if (
      !checkIronFromDatabase(
        scannedCode
      )
    ) {

      Serial.println(
        F("Iron not found in database or API failed")
      );

      showTwoLines(
        "Invalid Iron",
        "Scan Again"
      );

      delay(1500);

      showScanIronScreen();

      return;
    }

    Serial.print(
      F("Database iron ID: ")
    );

    Serial.println(
      currentIronId
    );

    Serial.print(
      F("Iron code: ")
    );

    Serial.println(
      currentIronCode
    );

    Serial.print(
      F("Iron name: ")
    );

    Serial.println(
      currentIronName
    );

    currentState =
      WAITING_FOR_TEMPERATURE;

    showWaitingTemperatureScreen();

    return;
  }

  // =====================================================
  // Saving validation
  // =====================================================

  if (
    currentState ==
    SAVING_VALIDATION
  ) {

    Serial.println(
      F("Scanner ignored while saving validation")
    );

    showTwoLines(
      "Saving...",
      "Please Wait"
    );

    return;
  }

  Serial.println(
    F("Scanner ignored while waiting for temperature")
  );

  showWaitingTemperatureScreen();
}

void readBarcodeScanner() {

  if (
    ScannerSerial.available() <= 0
  ) {
    return;
  }

  String scannedData =
    ScannerSerial.readStringUntil('\n');

  scannedData.trim();

  if (
    scannedData.length() == 0
  ) {
    return;
  }

  Serial.print(
    F("Raw scanner data: ")
  );

  Serial.println(
    scannedData
  );

  processScannedCode(
    scannedData
  );
}

// =====================================================
// IR temperature decoder
// =====================================================

static bool decodeBurstTemperature(
  const uint8_t *commands,
  size_t count,
  float &outTemperature
) {

  if (
    commands == nullptr ||
    count < 4 ||
    count > MAX_BURST_COMMANDS
  ) {

    return false;
  }

  size_t f0Index = count;

  for (
    size_t i = 0;
    i + 1 < count;
    i++
  ) {

    if (
      commands[i] == 0x46 &&
      commands[i + 1] == 0x30
    ) {

      f0Index = i;

      break;
    }
  }

  if (
    f0Index == count ||
    f0Index == 0 ||
    f0Index >= 6
  ) {

    return false;
  }

  char numberString[6] = {0};

  for (
    size_t i = 0;
    i < f0Index;
    i++
  ) {

    if (
      commands[i] < '0' ||
      commands[i] > '9'
    ) {

      return false;
    }

    numberString[i] =
      static_cast<char>(
        commands[i]
      );
  }

  char *endPointer = nullptr;

  const long parsedValue =
    strtol(
      numberString,
      &endPointer,
      10
    );

  if (
    endPointer == numberString ||
    *endPointer != '\0'
  ) {

    return false;
  }

  if (
    parsedValue < 0 ||
    parsedValue > 9999
  ) {

    return false;
  }

  outTemperature =
    static_cast<float>(
      parsedValue
    );

  return true;
}

static void resetBurst() {

  haveBurst = false;

  burstCount = 0;

  memset(
    burstCommands,
    0,
    sizeof(burstCommands)
  );
}

void completeSuccessfulSave() {

  Serial.println(
    F("Validation saved successfully")
  );

  Serial.print(
    F("User ID: ")
  );

  Serial.println(
    currentUserId
  );

  Serial.print(
    F("Iron ID: ")
  );

  Serial.println(
    currentIronId
  );

  Serial.print(
    F("Temperature: ")
  );

  Serial.print(
    pendingTemperature,
    0
  );

  Serial.print(' ');

  Serial.println(
    TEMPERATURE_UNIT
  );

  showTemperatureOnOLED(
    pendingTemperature
  );

  delay(1500);

  showTwoLines(
    "SUCCESS",
    "Saved to DB"
  );

  delay(1500);

  pendingSave = false;
  pendingTemperature = 0.0f;

  clearCurrentIron();

  currentState =
    WAITING_FOR_IRON;

  showScanIronScreen();
}

static void finalizeBurst() {

  if (
    !haveBurst ||
    burstCount == 0
  ) {

    resetBurst();

    return;
  }

  float decodedTemperature = 0.0f;

  if (
    !decodeBurstTemperature(
      burstCommands,
      burstCount,
      decodedTemperature
    )
  ) {

    Serial.println(
      F("Invalid temperature packet")
    );

    resetBurst();

    return;
  }

  Serial.print(
    F("Decoded temperature: ")
  );

  Serial.print(
    decodedTemperature,
    0
  );

  Serial.print(' ');

  Serial.println(
    TEMPERATURE_UNIT
  );

  if (
    currentState !=
    WAITING_FOR_TEMPERATURE
  ) {

    Serial.println(
      F("Temperature ignored: scan user and iron first")
    );

    resetBurst();

    return;
  }

  pendingTemperature =
    decodedTemperature;

  currentState =
    SAVING_VALIDATION;

  showTwoLines(
    "Saving...",
    currentIronCode
  );

  if (
    saveValidationToDatabase(
      pendingTemperature
    )
  ) {

    completeSuccessfulSave();

  } else {

    pendingSave = true;

    lastSaveRetryMs =
      millis();

    Serial.println(
      F("Save failed. Automatic retry enabled.")
    );

    showTwoLines(
      "Save Failed",
      "Retrying..."
    );
  }

  resetBurst();
}

void retryPendingSave() {

  if (
    !pendingSave ||
    currentState !=
      SAVING_VALIDATION
  ) {

    return;
  }

  if (
    millis() -
      lastSaveRetryMs <
      SAVE_RETRY_INTERVAL_MS
  ) {

    return;
  }

  lastSaveRetryMs =
    millis();

  Serial.println(
    F("Retrying validation save...")
  );

  showTwoLines(
    "Retry Save...",
    currentIronCode
  );

  if (
    saveValidationToDatabase(
      pendingTemperature
    )
  ) {

    completeSuccessfulSave();

  } else {

    showTwoLines(
      "Save Failed",
      "Retrying..."
    );
  }
}

// =====================================================
// Setup
// =====================================================

void setup() {

  Serial.begin(115200);

  delay(1000);

  Serial.println();

  Serial.println(
    F("ESP32 Soldering Iron Database Validation System")
  );

  // OLED
  Wire.begin(
    OLED_SDA_PIN,
    OLED_SCL_PIN
  );

  u8g2.begin();

  showScanUserScreen();

  // Scanner
  ScannerSerial.begin(
    SCANNER_BAUD_RATE,
    SERIAL_8N1,
    SCANNER_RX_PIN,
    SCANNER_TX_PIN
  );

  ScannerSerial.setTimeout(500);

  Serial.println(
    F("GM865 scanner ready")
  );

  Serial.println(
    F("Scanner baud: 9600")
  );

  // IR
  IrReceiver.begin(
    IR_RECEIVE_PIN,
    ENABLE_LED_FEEDBACK
  );

  Serial.println(
    F("Hakko IR receiver ready")
  );

  // Wi-Fi
  ensureWiFiConnected(20000);

  Serial.print(
    F("Backend URL: ")
  );

  Serial.println(
    BACKEND_BASE_URL
  );

  Serial.println(
    F("Ready: scan a user QR code")
  );

  // Update OLED Wi-Fi icon
  wifiDisplayInitialized = false;
  updateWiFiDisplay();
}

// =====================================================
// Main loop
// =====================================================

void loop() {

  // ---------------------------------------------------
  // Existing scanner logic
  // ---------------------------------------------------

  readBarcodeScanner();

  // ---------------------------------------------------
  // Existing retry logic
  // ---------------------------------------------------

  retryPendingSave();

  // ---------------------------------------------------
  // Wi-Fi icon update
  // ---------------------------------------------------

  updateWiFiDisplay();

  // ---------------------------------------------------
  // Existing IR logic
  // ---------------------------------------------------

  const uint32_t nowMs =
    millis();

  if (
    haveBurst &&
    nowMs - lastFrameMs >
      BURST_GAP_MS
  ) {

    finalizeBurst();
  }

  if (
    IrReceiver.decode()
  ) {

    const auto &data =
      IrReceiver.decodedIRData;

    if (
      data.protocol != UNKNOWN
    ) {

      if (!haveBurst) {

        haveBurst = true;

        burstCount = 0;

        memset(
          burstCommands,
          0,
          sizeof(burstCommands)
        );
      }

      // Keep duplicate commands so values such as
      // 77 and 88 work.
      if (
        burstCount <
        MAX_BURST_COMMANDS
      ) {

        burstCommands[
          burstCount++
        ] = data.command;

        lastFrameMs =
          nowMs;

      } else {

        Serial.println(
          F("IR burst buffer overflow")
        );

        resetBurst();
      }
    }

    IrReceiver.resume();
  }

  delay(1);
}