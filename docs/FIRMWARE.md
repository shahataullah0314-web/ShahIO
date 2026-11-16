# Serial protocol and example firmware

The repository includes an Arduino Blink example and an optional MCP23017 input observer. The desktop app also works with other PlatformIO projects; they need compatible telemetry to drive its pin grid.

## Environments

- `uno`: Blink using `src/main.cpp`.
- `uno_mcp`: input observation using `src/mcp_monitor.cpp`.

Source filters keep the two files' `setup()` and `loop()` definitions separate. The MCP example uses the Adafruit MCP23017 Arduino Library, configured with `lib_deps` in `platformio.ini`.

## MCP23017 example

The observer uses I²C address `0x20`, sets the MCP23017 GPIO pins as inputs, reads them periodically, and emits changes and a heartbeat. On an Uno, SDA/SCL are A4/A5. Connect power, ground, reset, and address pins according to the actual module's pin labels and electrical requirements. Inputs need valid logic levels; floating inputs may vary. Check the device and board documentation for voltage compatibility and pull-ups.

Select 9600 baud, connect the monitor, and send one printable ASCII command per line. ShahIO accepts up to 120 command characters and sends LF. The example also accepts CR/LF line endings.

| Command | Reply or behavior |
| --- | --- |
| `PING` | `PONG`, mode, and state |
| `STATUS` | Current mode/state and, while observing, GPIO bits |
| `EMERGENCY_STOP` | Pause input observation; report `STATE:STOPPED` |
| `RESUME` | Resume input observation if the MCP23017 is available |
| `CALIBRATE_PINS`, `EMBOSS_LINE`, `EMBOSS_TEST` | Error: unsupported by this monitor-only firmware |

The desktop recognizes these complete telemetry lines:

```text
MODE:MONITOR_ONLY
STATE:RUNNING
STATUS:1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
```

`STATUS` has exactly 16 comma-separated `0`/`1` values, ordered GPA0–GPA7 followed by GPB0–GPB7. Unknown values remain gray. `STATE:STOPPED` pauses observations in the UI; `RESUME` requests another live session.

## Meaning of the controls

The pin grid reports GPIO logic levels. It does not measure coil current, detect pin movement, or prove a physical action occurred. The supplied firmware never drives an MCP pin as an output. `EMERGENCY_STOP` is a firmware command that pauses observation; it is not a physical safety circuit.

The desktop's Calibrate and Emboss controls only send their named commands. Actual actuator routines require separately developed firmware and hardware. Those controls are disabled when monitor-only mode is reported. The demo mode is simulated, labeled, and does not send hardware commands.

No physical board is required for the application test suite. Actual flashing, wiring, electrical behavior, and machine operation must be checked on the intended hardware.
