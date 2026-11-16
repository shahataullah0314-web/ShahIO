"""Line-oriented JSON bridge to pyserial; stdout is reserved for protocol data."""

import json
import re
import sys
import threading


ALLOWED_BAUD_RATES = frozenset((9600, 19200, 38400, 57600, 115200, 230400))
MAX_COMMAND_LENGTH = 120
MAX_SERIAL_LINE = 4096
MAX_REQUEST_LINE = 8192


class LineFramer:
    """Frame fragmented UTF-8 serial bytes, dropping oversized lines entirely."""

    def __init__(self, limit=MAX_SERIAL_LINE):
        self.limit = limit
        self.pending = bytearray()
        self.discarding = False

    def feed(self, chunk):
        events = []
        for byte in chunk:
            if byte == 10:
                if not self.discarding:
                    line = bytes(self.pending).removesuffix(b"\r")
                    events.append({"event": "line", "line": line.decode("utf-8", "replace")})
                self.pending.clear()
                self.discarding = False
            elif not self.discarding:
                if len(self.pending) == self.limit:
                    self.pending.clear()
                    self.discarding = True
                    events.append({"event": "notice", "message": "Serial line exceeded 4096 bytes and was discarded."})
                else:
                    self.pending.append(byte)
        return events


class SerialBridge:
    def __init__(self, serial_module, list_ports, emit):
        self.serial_module = serial_module
        self.list_ports = list_ports
        self.emit = emit
        self._lock = threading.Lock()
        self._port = None
        self._reader = None
        self._stop = None

    @staticmethod
    def _validate_port(port):
        if not isinstance(port, str) or not re.fullmatch(r"COM[1-9][0-9]*", port, re.ASCII):
            raise ValueError("Select a Windows COM port, such as COM3.")
        return port

    @staticmethod
    def _validate_baud(baud):
        if isinstance(baud, bool) or not isinstance(baud, int) or baud not in ALLOWED_BAUD_RATES:
            raise ValueError("Unsupported baud rate.")
        return baud

    @staticmethod
    def _validate_command(command):
        if not isinstance(command, str) or not 1 <= len(command) <= MAX_COMMAND_LENGTH:
            raise ValueError("Command must contain 1 to 120 printable ASCII characters.")
        if any(ord(char) < 32 or ord(char) > 126 for char in command):
            raise ValueError("Command must contain printable ASCII characters without line breaks.")
        return command

    def _is_current(self, port):
        with self._lock:
            return self._port is port

    def _detach(self, expected=None):
        with self._lock:
            if expected is not None and self._port is not expected:
                return None
            if self._port is None:
                return None
            connection = (self._port, self._reader, self._stop)
            self._port = self._reader = self._stop = None
            connection[2].set()
            return connection

    def _finish_close(self, connection):
        if connection is None:
            return
        port, reader, _stop = connection
        try:
            port.close()
        except Exception as error:
            self.emit({"event": "error", "message": "Closing serial port: " + str(error)})
        if reader is not None and reader is not threading.current_thread():
            reader.join(timeout=1.5)
        self.emit({"event": "closed", "port": port.port})

    def close(self):
        self._finish_close(self._detach())
        return {"closed": True}

    def _read(self, port, stop):
        framer = LineFramer()
        try:
            while not stop.is_set():
                chunk = port.read(256)
                if not self._is_current(port) or stop.is_set():
                    break
                for event in framer.feed(chunk):
                    if stop.is_set() or not self._is_current(port):
                        break
                    self.emit(event)
        except Exception as error:
            connection = self._detach(port)
            if connection is not None:
                self.emit({"event": "error", "message": "Serial disconnected: " + str(error)})
                self._finish_close(connection)

    def open(self, port_name, baud):
        self._validate_port(port_name)
        self._validate_baud(baud)
        self.close()
        port = self.serial_module.Serial(
            port=port_name, baudrate=baud, timeout=0.1, write_timeout=1
        )
        stop = threading.Event()
        reader = threading.Thread(target=self._read, args=(port, stop), name="serial-reader", daemon=True)
        with self._lock:
            self._port, self._reader, self._stop = port, reader, stop
        reader.start()
        return {"port": port_name, "baud": baud}

    def write(self, command):
        self._validate_command(command)
        with self._lock:
            port = self._port
        if port is None or not port.is_open:
            raise ValueError("No serial port connected.")
        payload = command.encode("ascii") + b"\n"
        try:
            offset = 0
            while offset < len(payload):
                written = port.write(payload[offset:])
                if not written:
                    raise OSError("Serial write made no progress.")
                offset += written
        except Exception as error:
            connection = self._detach(port)
            if connection is not None:
                self.emit({"event": "error", "message": "Serial write failed: " + str(error)})
                self._finish_close(connection)
            raise
        return {"sent": command}

    def handle(self, request):
        if not isinstance(request, dict):
            return {"id": None, "ok": False, "error": "Request must be a JSON object."}
        request_id = request.get("id")
        try:
            action = request.get("action")
            if action == "list":
                data = [
                    {
                        "path": item.device,
                        "manufacturer": getattr(item, "manufacturer", None),
                        "serialNumber": getattr(item, "serial_number", None),
                        "description": getattr(item, "description", None),
                    }
                    for item in self.list_ports()
                    if re.fullmatch(r"COM[1-9][0-9]*", item.device, re.ASCII)
                ]
            elif action == "open":
                data = self.open(request.get("port"), request.get("baud", 9600))
            elif action == "close" or action == "shutdown":
                data = self.close()
            elif action == "write":
                data = self.write(request.get("command"))
            else:
                raise ValueError("Unknown serial action.")
            return {"id": request_id, "ok": True, "data": data}
        except Exception as error:
            return {"id": request_id, "ok": False, "error": str(error)}


def main():
    output_lock = threading.Lock()

    def emit(value):
        with output_lock:
            sys.stdout.write(json.dumps(value, ensure_ascii=True) + "\n")
            sys.stdout.flush()

    try:
        import serial
        from serial.tools import list_ports
    except ImportError as error:
        emit({"event": "error", "message": "pyserial is unavailable in this Python installation: " + str(error)})
        return 1

    bridge = SerialBridge(serial, list_ports.comports, emit)
    try:
        while True:
            raw = sys.stdin.buffer.readline(MAX_REQUEST_LINE + 1)
            if not raw:
                break
            if len(raw) > MAX_REQUEST_LINE:
                while raw and not raw.endswith(b"\n"):
                    raw = sys.stdin.buffer.readline(MAX_REQUEST_LINE + 1)
                emit({"id": None, "ok": False, "error": "Request exceeded 8192 bytes."})
                continue
            try:
                request = json.loads(raw)
            except (ValueError, UnicodeDecodeError):
                emit({"id": None, "ok": False, "error": "Invalid JSON request."})
                continue
            emit(bridge.handle(request))
            if isinstance(request, dict) and request.get("action") == "shutdown":
                break
    finally:
        bridge.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
