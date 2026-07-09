#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <M5Atom.h>

const char* ssid = "";
const char* password = "";

// Change this to the IP address of the PC running server/server.js.
// Do not use localhost here. From the ESP32, localhost means the ESP32 itself.
const char* serverUrl = "http://192.x.x.x:3000/display/current?width=5&height=5&device=esp32";

const int WIDTH = 5;
const int HEIGHT = 5;
const unsigned long POLL_INTERVAL_MS = 1000;

unsigned long lastPollMs = 0;
int lastDisplayId = -1;

uint32_t rgbToColor(uint8_t r, uint8_t g, uint8_t b) {
    if (r > 245 && g > 245 && b > 245) {
        return 0x000000;
    }
    return ((uint32_t)r << 16) | ((uint32_t)g << 8) | b;
}

void clearMatrix() {
    M5.dis.clear();
}

void connectWiFi() {
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, password);

    Serial.print("WiFi connecting");
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }

    Serial.println();
    Serial.print("WiFi connected. IP=");
    Serial.println(WiFi.localIP());
}

void drawPayload(JsonDocument& doc) {
    int width = doc["width"] | WIDTH;
    int height = doc["height"] | HEIGHT;
    JsonArray pixels = doc["pixels"].as<JsonArray>();

    if (width != WIDTH || height != HEIGHT || pixels.size() < WIDTH * HEIGHT) {
        Serial.println("Invalid LED payload size");
        return;
    }

    for (int i = 0; i < WIDTH * HEIGHT; i++) {
        JsonObject pixel = pixels[i];
        uint8_t r = pixel["r"] | 0;
        uint8_t g = pixel["g"] | 0;
        uint8_t b = pixel["b"] | 0;
        M5.dis.drawpix(i, rgbToColor(r, g, b));
    }

    int displayId = doc["id"] | -1;
    if (displayId != lastDisplayId) {
        lastDisplayId = displayId;
        Serial.print("Displayed submission ID=");
        Serial.println(displayId);
    }
}

void pollServer() {
    if (WiFi.status() != WL_CONNECTED) {
        connectWiFi();
        return;
    }

    HTTPClient http;
    http.begin(serverUrl);
    int statusCode = http.GET();

    if (statusCode == 200) {
        String body = http.getString();
        DynamicJsonDocument doc(8192);
        DeserializationError error = deserializeJson(doc, body);

        if (error) {
            Serial.print("JSON parse error: ");
            Serial.println(error.c_str());
        } else {
            drawPayload(doc);
        }
    } else if (statusCode == 404) {
        clearMatrix();
        Serial.println("No active display yet");
    } else {
        Serial.print("HTTP error: ");
        Serial.println(statusCode);
    }

    http.end();
}

void setup() {
    M5.begin(true, false, true);
    Serial.begin(115200);
    clearMatrix();
    connectWiFi();
}

void loop() {
    M5.update();

    unsigned long now = millis();
    if (now - lastPollMs >= POLL_INTERVAL_MS) {
        lastPollMs = now;
        pollServer();
    }
}
