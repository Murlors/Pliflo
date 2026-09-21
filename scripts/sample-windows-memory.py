"""Sample a test launcher's process tree without third-party Python packages.

Usage: python sample-windows-memory.py <launcher-pid> <output-json>
Read-only. Stops with the launcher or after five minutes. Shared working-set pages
can be counted more than once; private bytes are committed memory, not resident RAM.
"""
import ctypes as ct
from ctypes import wintypes as wt
import json
from pathlib import Path
import sys
import time


class ProcessEntry(ct.Structure):
    _fields_ = [
        ("size", wt.DWORD), ("usage", wt.DWORD), ("pid", wt.DWORD),
        ("heap", ct.c_size_t), ("module", wt.DWORD), ("threads", wt.DWORD),
        ("parent", wt.DWORD), ("priority", wt.LONG), ("flags", wt.DWORD),
        ("exe", wt.WCHAR * 260),
    ]


class Memory(ct.Structure):
    _fields_ = [("cb", wt.DWORD), ("faults", wt.DWORD)] + [
        (name, ct.c_size_t) for name in (
            "peak_working_set", "working_set", "peak_paged", "paged",
            "peak_nonpaged", "nonpaged", "pagefile", "peak_pagefile", "private",
        )
    ]


def main():
    root = int(sys.argv[1])
    output = Path(sys.argv[2])
    kernel = ct.WinDLL("kernel32", use_last_error=True)
    psapi = ct.WinDLL("psapi", use_last_error=True)
    kernel.CreateToolhelp32Snapshot.restype = wt.HANDLE
    kernel.Process32FirstW.argtypes = [wt.HANDLE, ct.POINTER(ProcessEntry)]
    kernel.Process32NextW.argtypes = [wt.HANDLE, ct.POINTER(ProcessEntry)]
    kernel.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
    kernel.OpenProcess.restype = wt.HANDLE
    kernel.CloseHandle.argtypes = [wt.HANDLE]
    psapi.GetProcessMemoryInfo.argtypes = [wt.HANDLE, ct.POINTER(Memory), wt.DWORD]
    peak_rss = peak_private = samples = 0
    by_process = {}
    timeline = []
    last = []
    started = time.monotonic()
    while time.monotonic() - started < 300:
        snapshot = kernel.CreateToolhelp32Snapshot(2, 0)
        if snapshot == ct.c_void_p(-1).value:
            raise ct.WinError(ct.get_last_error())
        entry = ProcessEntry()
        entry.size = ct.sizeof(entry)
        processes = {}
        try:
            ok = kernel.Process32FirstW(snapshot, ct.byref(entry))
            while ok:
                processes[entry.pid] = (entry.parent, entry.exe)
                ok = kernel.Process32NextW(snapshot, ct.byref(entry))
        finally:
            kernel.CloseHandle(snapshot)
        if root not in processes:
            break
        ids = {root}
        while True:
            descendants = ids | {pid for pid, (parent, _) in processes.items() if parent in ids}
            if descendants == ids:
                break
            ids = descendants
        rss = private = 0
        last = []
        for pid in ids:
            handle = kernel.OpenProcess(0x410, False, pid)
            if not handle:
                continue  # A child can exit between the snapshot and this read.
            try:
                memory = Memory()
                memory.cb = ct.sizeof(memory)
                if psapi.GetProcessMemoryInfo(handle, ct.byref(memory), memory.cb):
                    rss += memory.working_set
                    private += memory.private
                    key = f"{pid}:{processes[pid][1]}"
                    by_process[key] = max(by_process.get(key, 0), memory.private)
                    last.append({"process": key, "private": memory.private})
            finally:
                kernel.CloseHandle(handle)
        peak_rss = max(peak_rss, rss)
        peak_private = max(peak_private, private)
        timeline.append({"timeMs": round(time.time()*1000), "workingSet": rss, "private": private,
                         "nativePrivate": sum(p["private"] for p in last if p["process"].endswith(":pliflo.exe"))})
        samples += 1
        time.sleep(0.1)
    if not samples:
        raise RuntimeError("Launcher exited before a memory sample could be collected")
    output.write_text(json.dumps({
        "sampleIntervalMs": 100,
        "samples": samples,
        "timeline": timeline,
        "processPeakPrivateBytes": by_process,
        "lastSample": last,
        "peakSummedWorkingSetBytes": peak_rss,
        "peakSummedPrivateBytes": peak_private,
    }, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
