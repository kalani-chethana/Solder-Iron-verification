# Soldering Iron Validation System

This project records soldering-iron temperature checks. An ESP32 accepts a user QR code, an iron barcode, and an infrared temperature reading. It asks a Node.js API to validate the scanned codes and saves the completed reading in MySQL.

## Project parts

- `arduino/SolderingIronValidation.ino` — ESP32 firmware, scanner input, OLED messages, IR decoding, and API calls.
- `backend/src/server.ts` — Express API entry point.
- `backend/src/controllers` — validates request data and builds API responses.
- `backend/src/repositories` — contains all MySQL queries.
- `database/schema.sql` — creates the database, tables, relationships, and starter records.

## Workflow

1. The OLED asks for a user QR code.
2. The ESP32 sends the code to `POST /api/check-user`.
3. After a valid user is found, the OLED asks for an iron barcode.
4. The ESP32 sends that code to `POST /api/check-iron`.
5. The IR receiver collects the thermometer burst and extracts its digits.
6. The ESP32 sends the measurement to `POST /api/save-validation`.
7. The backend checks both database IDs and inserts a validation record.
8. The same user remains logged in and may scan the next iron. Scan the same user code again, or scan `LOGOUT`, to log out.

If saving fails because Wi-Fi, the API, or MySQL is unavailable, the ESP32 retains the measurement and retries every five seconds.

## Hardware configuration

The firmware currently uses these ESP32 pins:

| Device | ESP32 pin |
|---|---:|
| IR receiver signal | GPIO 5 |
| OLED SDA | GPIO 21 |
| OLED SCL | GPIO 22 |
| Scanner TX → ESP32 RX | GPIO 16 |
| Scanner RX ← ESP32 TX | GPIO 17 |

The scanner uses UART at 9600 baud. The OLED is an SH1106 128×64 display connected over I²C.

Before uploading, update `WIFI_SSID`, `WIFI_PASSWORD`, and `BACKEND_BASE_URL` near the top of the Arduino file. The backend URL must contain the LAN address of the computer running the server, not `localhost`, because the ESP32 is a separate device.

> Security note: the current firmware contains Wi-Fi credentials directly in source code. Do not publish the file with real credentials. For a shared or production project, move secrets into a local header excluded from version control.

## Database setup

Run `database/schema.sql` in MySQL. It creates:

- `validation_records` — saved measurements linked to employees and soldering irons.

Both users and equipment are read directly from the **`tsfs`** database:
- **Operators / Users**: `tsfs.tblemployee` (active where `IsDelete = 0`). The scanned user code matches the employee number **`EmpNo`** (e.g. `0004`, `0006`, `0022`), displaying `InitialWithName` on the station OLED.
- **Soldering Irons**: `tsfs.tblsheduledserviceitems` (active where `CategotyID = '55'` and `InstrumentStatus = 1`). The scanned iron barcode matches **`ItemNumber`** (e.g. `WIR-SI-001-CC` or `CAL-SI-001-CC`).

## Backend setup

From the `backend` directory, install packages:

```powershell
npm install
```

Create `backend/.env` if your MySQL settings differ from the defaults:

```dotenv
PORT=5000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=soldering_iron_validation
DB_CONNECTION_LIMIT=10
```

Start the development server:

```powershell
npm run dev
```

The server listens on all network interfaces at port 5000 and verifies the MySQL connection before accepting requests. Allow inbound TCP port 5000 through the computer firewall if the ESP32 cannot connect.

For a compiled run:

```powershell
npm run build
npm start
```

## API examples

Check a user:

```http
POST /api/check-user
Content-Type: application/json

{"user_code":"USER001"}
```

Check an iron:

```http
POST /api/check-iron
Content-Type: application/json

{"iron_code":"IRON001"}
```

Save a measurement:

```http
POST /api/save-validation
Content-Type: application/json

{"user_id":1,"iron_id":1,"temperature":650,"unit":"F"}
```

Read the complete history:

```http
GET /api/validations
```

## QR code formats

The ESP32 accepts either a plain value such as `USER001` or a URL such as `https://example.test/users/USER001`. For URLs, it removes the query string and uses the final path segment. It trims whitespace and converts the result to uppercase before sending it to the API.

## Arduino libraries

Install these libraries in the Arduino IDE Library Manager before compiling:

- ArduinoJson
- IRremote
- U8g2

The WiFi, HTTPClient, Wire, and HardwareSerial support comes from the ESP32 Arduino core.
