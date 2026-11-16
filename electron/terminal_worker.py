"""Windows ConPTY host. stdin/stdout contain JSON protocol messages only."""
import argparse
import codecs
import ctypes
from ctypes import wintypes
import json
import os
import queue
import sys
import threading

MAX_INPUT = 65536
MAX_REQUEST = 1024 * 1024


def valid_size(cols, rows):
    if isinstance(cols, bool) or isinstance(rows, bool):
        raise ValueError("Terminal dimensions must be integers.")
    if not isinstance(cols, int) or not isinstance(rows, int) or not 2 <= cols <= 1000 or not 2 <= rows <= 500:
        raise ValueError("Terminal size must be 2–1000 columns and 2–500 rows.")
    return cols, rows


class COORD(ctypes.Structure):
    _fields_ = [("X", ctypes.c_short), ("Y", ctypes.c_short)]


class STARTUPINFOW(ctypes.Structure):
    _fields_ = [("cb", wintypes.DWORD), ("lpReserved", wintypes.LPWSTR),
                ("lpDesktop", wintypes.LPWSTR), ("lpTitle", wintypes.LPWSTR),
                ("dwX", wintypes.DWORD), ("dwY", wintypes.DWORD),
                ("dwXSize", wintypes.DWORD), ("dwYSize", wintypes.DWORD),
                ("dwXCountChars", wintypes.DWORD), ("dwYCountChars", wintypes.DWORD),
                ("dwFillAttribute", wintypes.DWORD), ("dwFlags", wintypes.DWORD),
                ("wShowWindow", wintypes.WORD), ("cbReserved2", wintypes.WORD),
                ("lpReserved2", ctypes.POINTER(ctypes.c_ubyte)),
                ("hStdInput", wintypes.HANDLE), ("hStdOutput", wintypes.HANDLE),
                ("hStdError", wintypes.HANDLE)]


class STARTUPINFOEXW(ctypes.Structure):
    _fields_ = [("StartupInfo", STARTUPINFOW), ("lpAttributeList", ctypes.c_void_p)]


class PROCESS_INFORMATION(ctypes.Structure):
    _fields_ = [("hProcess", wintypes.HANDLE), ("hThread", wintypes.HANDLE),
                ("dwProcessId", wintypes.DWORD), ("dwThreadId", wintypes.DWORD)]


class PseudoConsole:
    def __init__(self, emit, shell, cwd, cols, rows):
        if os.name != "nt":
            raise RuntimeError("The integrated terminal requires Windows 10/11.")
        if shell not in ("powershell", "cmd"):
            raise ValueError("Choose PowerShell or Command Prompt.")
        if not os.path.isdir(cwd):
            raise ValueError("The terminal project folder no longer exists.")
        valid_size(cols, rows)
        self.emit = emit
        self.shell = shell
        self.cwd = os.path.abspath(cwd)
        self.cols, self.rows = cols, rows
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self._configure_api()
        self.hpc = wintypes.HANDLE()
        self.input_read = wintypes.HANDLE()
        self.input_write = wintypes.HANDLE()
        self.output_read = wintypes.HANDLE()
        self.output_write = wintypes.HANDLE()
        self.process = PROCESS_INFORMATION()
        self.closed = threading.Event()
        self.exited = threading.Event()
        self.close_lock = threading.Lock()
        self.input_queue = queue.Queue(maxsize=64)
        self.reader = self.writer = self.waiter = None
        self.exit_code = 0

    def _configure_api(self):
        k = self.kernel
        try:
            k.CreatePseudoConsole.argtypes = [COORD, wintypes.HANDLE, wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
            k.CreatePseudoConsole.restype = ctypes.c_long
            k.ResizePseudoConsole.argtypes = [wintypes.HANDLE, COORD]
            k.ResizePseudoConsole.restype = ctypes.c_long
            k.ClosePseudoConsole.argtypes = [wintypes.HANDLE]
            k.ClosePseudoConsole.restype = None
        except AttributeError as error:
            raise RuntimeError("This Windows version does not provide ConPTY. Windows 10 version 1809 or later is required.") from error
        k.CreatePipe.argtypes = [ctypes.POINTER(wintypes.HANDLE), ctypes.POINTER(wintypes.HANDLE), ctypes.c_void_p, wintypes.DWORD]
        k.CreatePipe.restype = wintypes.BOOL
        k.CloseHandle.argtypes = [wintypes.HANDLE]
        k.CloseHandle.restype = wintypes.BOOL
        k.ReadFile.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
        k.ReadFile.restype = wintypes.BOOL
        k.WriteFile.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
        k.WriteFile.restype = wintypes.BOOL
        k.InitializeProcThreadAttributeList.argtypes = [ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(ctypes.c_size_t)]
        k.InitializeProcThreadAttributeList.restype = wintypes.BOOL
        k.UpdateProcThreadAttribute.argtypes = [ctypes.c_void_p, wintypes.DWORD, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_void_p]
        k.UpdateProcThreadAttribute.restype = wintypes.BOOL
        k.DeleteProcThreadAttributeList.argtypes = [ctypes.c_void_p]
        k.CreateProcessW.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, ctypes.c_void_p, ctypes.c_void_p, wintypes.BOOL, wintypes.DWORD, ctypes.c_void_p, wintypes.LPCWSTR, ctypes.POINTER(STARTUPINFOEXW), ctypes.POINTER(PROCESS_INFORMATION)]
        k.CreateProcessW.restype = wintypes.BOOL
        k.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        k.WaitForSingleObject.restype = wintypes.DWORD
        k.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
        k.GetExitCodeProcess.restype = wintypes.BOOL

    def _check(self, value, name):
        if not value:
            code = ctypes.get_last_error()
            raise OSError(code, name + " failed: " + ctypes.FormatError(code).strip())

    def _close_handle(self, name):
        handle = getattr(self, name, None)
        if handle and handle.value:
            self.kernel.CloseHandle(handle)
            setattr(self, name, wintypes.HANDLE())

    def start(self):
        k = self.kernel
        attributes = None
        try:
            self._check(k.CreatePipe(ctypes.byref(self.input_read), ctypes.byref(self.input_write), None, 65536), "CreatePipe(input)")
            self._check(k.CreatePipe(ctypes.byref(self.output_read), ctypes.byref(self.output_write), None, 65536), "CreatePipe(output)")
            result = k.CreatePseudoConsole(COORD(self.cols, self.rows), self.input_read, self.output_write, 0, ctypes.byref(self.hpc))
            if result < 0:
                raise RuntimeError("CreatePseudoConsole failed (HRESULT 0x%08X). Windows may restrict interactive terminals in this session." % (result & 0xFFFFFFFF))
            # Keep draining output during both process startup and pseudoconsole teardown.
            self.reader = threading.Thread(target=self._read, name="conpty-reader", daemon=True)
            self.reader.start()
            required = ctypes.c_size_t()
            k.InitializeProcThreadAttributeList(None, 1, 0, ctypes.byref(required))
            attributes = ctypes.create_string_buffer(required.value)
            self._check(k.InitializeProcThreadAttributeList(attributes, 1, 0, ctypes.byref(required)), "InitializeProcThreadAttributeList")
            self._check(k.UpdateProcThreadAttribute(attributes, 0, 0x00020016, self.hpc, ctypes.sizeof(wintypes.HANDLE), None, None), "UpdateProcThreadAttribute")
            startup = STARTUPINFOEXW()
            startup.StartupInfo.cb = ctypes.sizeof(STARTUPINFOEXW)
            # The helper has redirected JSON pipes. Explicit NULL standard
            # handles let ConPTY replace them instead of inheriting those pipes.
            startup.StartupInfo.dwFlags = 0x00000100  # STARTF_USESTDHANDLES
            startup.lpAttributeList = ctypes.cast(attributes, ctypes.c_void_p)
            windows = os.environ.get("SystemRoot", r"C:\Windows")
            if self.shell == "powershell":
                executable = os.path.join(windows, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
                command = '"' + executable + '" -NoLogo -NoProfile'
            else:
                executable = os.path.join(windows, "System32", "cmd.exe")
                command = '"' + executable + '" /D /Q'
            if not os.path.isfile(executable):
                raise RuntimeError("The selected Windows shell was not found: " + executable)
            command_buffer = ctypes.create_unicode_buffer(command)
            self._check(k.CreateProcessW(executable, command_buffer, None, None, False, 0x00080000 | 0x00000400, None, self.cwd, ctypes.byref(startup), ctypes.byref(self.process)), "CreateProcessW")
            k.CloseHandle(self.process.hThread)
            self.process.hThread = None
            self._close_handle("input_read")
            self._close_handle("output_write")
            self.writer = threading.Thread(target=self._write_loop, name="conpty-writer", daemon=True)
            self.writer.start()
            self.waiter = threading.Thread(target=self._wait, name="conpty-waiter", daemon=True)
            self.waiter.start()
            return {"shell": self.shell, "cwd": self.cwd, "cols": self.cols, "rows": self.rows}
        except Exception:
            self.close()
            raise
        finally:
            if attributes is not None:
                k.DeleteProcThreadAttributeList(attributes)

    def _read(self):
        decoder = codecs.getincrementaldecoder("utf-8")("replace")
        buffer = ctypes.create_string_buffer(8192)
        count = wintypes.DWORD()
        while True:
            ok = self.kernel.ReadFile(self.output_read, buffer, len(buffer), ctypes.byref(count), None)
            if not ok or not count.value:
                break
            text = decoder.decode(buffer.raw[:count.value])
            if text:
                self.emit({"type": "data", "data": text})
        tail = decoder.decode(b"", final=True)
        if tail:
            self.emit({"type": "data", "data": tail})
        self._close_handle("output_read")

    def _write_loop(self):
        while not self.closed.is_set():
            payload = self.input_queue.get()
            if payload is None:
                break
            offset = 0
            while offset < len(payload) and not self.closed.is_set():
                chunk = payload[offset:offset + 8192]
                buffer = ctypes.create_string_buffer(chunk)
                count = wintypes.DWORD()
                if not self.kernel.WriteFile(self.input_write, buffer, len(chunk), ctypes.byref(count), None) or not count.value:
                    if not self.closed.is_set():
                        self.emit({"type": "error", "message": "The terminal input pipe closed."})
                    return
                offset += count.value

    def write(self, text):
        if not isinstance(text, str) or len(text) > MAX_INPUT:
            raise ValueError("Terminal input must contain at most 65536 characters per message.")
        if self.closed.is_set():
            raise RuntimeError("This terminal session has ended.")
        try:
            self.input_queue.put_nowait(text.encode("utf-8"))
        except queue.Full as error:
            raise RuntimeError("The terminal is busy receiving input. Try a smaller paste.") from error

    def resize(self, cols, rows):
        valid_size(cols, rows)
        if self.closed.is_set():
            raise RuntimeError("This terminal session has ended.")
        result = self.kernel.ResizePseudoConsole(self.hpc, COORD(cols, rows))
        if result < 0:
            raise RuntimeError("The terminal could not be resized.")
        self.cols, self.rows = cols, rows

    def _wait(self):
        handle = self.process.hProcess
        self.kernel.WaitForSingleObject(handle, 0xFFFFFFFF)
        code = wintypes.DWORD()
        self.kernel.GetExitCodeProcess(handle, ctypes.byref(code))
        self.exit_code = code.value
        self.close()
        if self.reader is not None and self.reader is not threading.current_thread():
            self.reader.join(timeout=1.5)
        self.emit({"type": "exit", "code": self.exit_code})
        self.kernel.CloseHandle(handle)
        self.process.hProcess = None
        self.exited.set()

    def close(self):
        with self.close_lock:
            if self.closed.is_set():
                return
            self.closed.set()
            hpc = self.hpc
            self.hpc = wintypes.HANDLE()
        try:
            self.input_queue.put_nowait(None)
        except queue.Full:
            pass
        if hpc and hpc.value:
            # Reader stays alive until this call has flushed the final VT frame.
            self.kernel.ClosePseudoConsole(hpc)
        self._close_handle("input_read")
        self._close_handle("output_write")
        self._close_handle("input_write")
        if self.reader is None or not self.reader.is_alive():
            self._close_handle("output_read")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--shell", choices=("powershell", "cmd"), required=True)
    parser.add_argument("--cwd", required=True)
    parser.add_argument("--cols", type=int, default=100)
    parser.add_argument("--rows", type=int, default=25)
    args = parser.parse_args()
    lock = threading.Lock()

    def emit(message):
        with lock:
            sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
            sys.stdout.flush()

    terminal = None
    try:
        terminal = PseudoConsole(emit, args.shell, args.cwd, args.cols, args.rows)
        state = terminal.start()
        emit({"type": "ready", **state})
        while True:
            raw = sys.stdin.buffer.readline(MAX_REQUEST + 1)
            if not raw:
                break
            if len(raw) > MAX_REQUEST:
                raise ValueError("Terminal protocol message is too large.")
            request = {}
            try:
                request = json.loads(raw)
                if not isinstance(request, dict):
                    raise ValueError("Terminal request must be an object.")
                action = request.get("action")
                if action == "write":
                    terminal.write(request.get("data"))
                elif action == "resize":
                    terminal.resize(request.get("cols"), request.get("rows"))
                elif action == "close":
                    terminal.close()
                else:
                    raise ValueError("Unsupported terminal action.")
                emit({"id": request.get("id"), "ok": True})
                if action == "close":
                    break
            except Exception as error:
                emit({"id": request.get("id") if isinstance(request, dict) else None, "ok": False, "error": str(error)})
    except Exception as error:
        emit({"type": "error", "message": str(error), "fatal": True})
        return 1
    finally:
        if terminal is not None:
            terminal.close()
            if terminal.waiter is not None:
                terminal.waiter.join(timeout=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
