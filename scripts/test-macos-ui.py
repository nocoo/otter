#!/usr/bin/env python3
"""Run the production Debug app against private fixtures and a real loopback HTTP server."""
import argparse
import gzip
import hashlib
import html
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import shutil
import signal
import subprocess
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit
from uuid import uuid4

REPOSITORY = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, default=REPOSITORY / "build/macos/Build/Products/Debug/Otter.app")
    parser.add_argument("--no-capture", action="store_true", help="Exercise native input without producing screenshots.")
    args = parser.parse_args()
    if not (args.app / "Contents/MacOS/Otter").is_file():
        raise SystemExit("Build the Debug app first: bash scripts/build-macos.sh Debug")
    identifier = uuid4().hex
    root = REPOSITORY / "build/macos-native" / (time.strftime("%Y%m%d-%H%M%S") + "-" + identifier[:8])
    root.mkdir(parents=True, mode=0o700)
    uploads = []
    saved = {}
    server_errors = []
    upload_lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, _format, *_args):
            pass

        def send_json(self, value, status=200):
            response = json.dumps(value).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)

        def do_GET(self):
            try:
                assert self.headers.get("Authorization") == "Bearer otk_native_fixture_only", "Unexpected fixture credentials"
                path = unquote(urlsplit(self.path).path).rstrip("/")
                with upload_lock:
                    if path == "/api/snapshots":
                        response = {"snapshots": [value["snapshot"] for value in saved.values()], "nextCursor": None, "total": len(saved)}
                    else:
                        assert path.startswith("/api/snapshots/"), "Unexpected API endpoint"
                        response = saved.get(path.removeprefix("/api/snapshots/"))
                self.send_json(response or {"error": "not found"}, 200 if response is not None else 404)
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as error:
                server_errors.append(str(error))
                self.send_error(400, "Fixture request rejected")

        def do_POST(self):
            try:
                assert self.path == "/api/snapshots", "Unexpected API endpoint"
                assert self.headers.get("Authorization") == "Bearer otk_native_fixture_only", "Unexpected fixture credentials"
                assert self.headers.get("Content-Encoding") == "gzip", "Upload must use the real gzip protocol"
                length = int(self.headers["Content-Length"])
                assert 0 < length < 32 * 1024 * 1024, "Unexpected request size"
                raw = gzip.decompress(self.rfile.read(length))
                snapshot = json.loads(raw)
                content_hash = hashlib.sha256(raw).hexdigest()
                with upload_lock:
                    uploads.append(snapshot)
                    number = len(uploads)
                    previous = saved.get(snapshot["id"])
                    if previous and previous["receipt"]["sha256"] != content_hash:
                        self.send_json({"error": "immutable snapshot ID conflict"}, 409)
                        return
                    if previous is None:
                        received_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                        receipt = {"snapshotId": snapshot["id"], "sha256": content_hash, "account": "native-fixture", "receivedAt": received_at}
                        metadata = {
                            "id": snapshot["id"], "hostname": snapshot["machine"]["hostname"],
                            "snapshotAt": int(datetime.fromisoformat(snapshot["createdAt"].replace("Z", "+00:00")).timestamp() * 1000),
                            "uploadedAt": int(time.time() * 1000), "schemaVersion": snapshot["version"],
                            "deviceId": snapshot["workspace"]["deviceId"], "sha256": content_hash,
                            "complete": snapshot["workspace"]["coverage"]["complete"],
                            "collectorCount": len(snapshot["collectors"]),
                            "fileCount": sum(len(collector["files"]) for collector in snapshot["collectors"]),
                            "listCount": sum(len(collector["lists"]) for collector in snapshot["collectors"]),
                        }
                        saved[snapshot["id"]] = {"data": snapshot, "receipt": receipt, "snapshot": metadata}
                    receipt = saved[snapshot["id"]]["receipt"]
                (root / f"upload-{number}.json").write_text(json.dumps(snapshot, ensure_ascii=False, indent=2))
                if (root / "hold-upload").exists():
                    (root / "upload-held.json").write_text(json.dumps({"id": snapshot["id"], "received": True}))
                    deadline = time.monotonic() + 20
                    while (root / "hold-upload").exists() and time.monotonic() < deadline:
                        time.sleep(0.05)
                self.send_json({"success": True, "receipt": receipt})
            except (BrokenPipeError, ConnectionResetError):
                pass  # The cancellation case intentionally closes this connection.
            except Exception as error:
                server_errors.append(str(error))
                self.send_error(400, "Fixture request rejected")

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    fixture_spec = importlib.util.spec_from_file_location("otter_fixture", REPOSITORY / "apps/macos/Fixtures/create.py")
    fixture = importlib.util.module_from_spec(fixture_spec)
    fixture_spec.loader.exec_module(fixture)
    fixture.create_fixture(root, f"http://127.0.0.1:{server.server_port}")

    # A unique bundle ID isolates native window defaults as well as filesystem configuration.
    application = root / "Otter UI Tests.app"
    shutil.copytree(args.app, application, symlinks=True)
    plist_path = application / "Contents/Info.plist"
    with plist_path.open("rb") as stream:
        plist = plistlib.load(stream)
    plist["CFBundleIdentifier"] = "ai.hexly.otter.native." + identifier
    plist["CFBundleName"] = "Otter UI Tests"
    with plist_path.open("wb") as stream:
        plistlib.dump(plist, stream)
    environment = os.environ.copy()
    # Deliberately omit Homebrew, Node, npm and Bun from the inherited launch PATH.
    # The fixture root travels via an explicit app argument, never HOME/CODEX_HOME.
    environment["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
    command = ["-NSTreatUnknownArgumentsAsOpen", "NO", "-NSQuitAlwaysKeepsWindows", "NO", "--automation-root", str(root)]
    if args.no_capture:
        command.append("--automation-no-capture")
    print(f"Native fixture: {root}", flush=True)
    def terminate_fixture():
        executable_prefix = str(application / "Contents") + "/"
        for line in subprocess.check_output(["/bin/ps", "-axo", "pid=,command="], text=True).splitlines():
            pid, launched = line.strip().split(None, 1)
            if launched.startswith(executable_prefix):
                try:
                    os.kill(int(pid), signal.SIGTERM)
                except ProcessLookupError:
                    pass
    try:
        for phase, extra in [("workspace", []), ("recovery", ["--automation-resume"])]:
            log_path = root / f"{phase}.log"
            errors_path = root / f"{phase}.stderr.log"
            # Launch Services delivers the same initial open event as Finder. Running a
            # SwiftUI app executable directly can leave its scenes unpresented on macOS.
            launch = ["/usr/bin/open", "-n", "-F", "-W", "--stdout", str(log_path), "--stderr", str(errors_path),
                      "--env", "PATH=" + environment["PATH"], "--env", "LLVM_PROFILE_FILE=" + str(root / f"{phase}-%p.profraw"),
                      "-a", str(application), "--args"] + command + extra
            process = subprocess.Popen(launch, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=environment)
            try:
                deadline = time.monotonic() + 180
                # Launch Services may send its first activation before SwiftUI has
                # presented a scene. Activate the same fixture once it is ready;
                # native assertions still require a real active/key input window.
                while process.poll() is None:
                    if log_path.exists() and "Scanner and packaged CLI become ready" in log_path.read_text(errors="replace"):
                        subprocess.run(["/usr/bin/open", "-a", str(application)], check=True, timeout=10)
                        break
                    if time.monotonic() >= deadline:
                        raise subprocess.TimeoutExpired(launch, 180)
                    time.sleep(0.1)
                _, launch_error = process.communicate(timeout=max(1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                terminate_fixture(); process.terminate()
                try:
                    process.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill(); process.communicate()
                raise RuntimeError(f"{phase} timed out; see {log_path}")
            report_path = root / "results" / ("verification.json" if phase == "workspace" else "recovery.json")
            report = json.loads(report_path.read_text()) if report_path.exists() else {}
            if process.returncode or report.get("status") != "passed":
                log = "\n".join(path.read_text(errors="replace") for path in [log_path, errors_path] if path.exists())
                raise RuntimeError(f"{phase} failed; see {log_path}\n{launch_error.decode(errors='replace')}\n{log[-6000:]}")
            print(f"Native {phase}: passed", flush=True)
        reports = [json.loads((root / "results" / name).read_text()) for name in ["verification.json", "recovery.json"]]
        assert all(report["status"] == "passed" for report in reports)
        reviewed = json.loads((root / "results/reviewed-snapshot.json").read_text())
        assert not server_errors, server_errors
        assert len(uploads) == 2, "Digest refusal must not produce a third HTTP upload"
        assert uploads[0] == reviewed["snapshot"], "Uploaded JSON must exactly match the reviewed snapshot"
        assert uploads[1] == reviewed["snapshot"], "Cancellation must keep the same selected snapshot"
        assert uploads[0]["machine"]["homeDir"] == str(root / "home"), "CLI must use the explicit fixture root"
        assert "export EDITOR=vim" in json.dumps(uploads[0]), "Upload must retain inputs from before review"
        assert "export EDITOR=nano" not in json.dumps(uploads[0]), "Upload must not silently rescan changed inputs"
        checks = sum(len(report["checks"]) for report in reports) + 7
        captures = [item for report in reports for item in report["captures"]]
        summary = {"status": "passed", "checks": checks, "captures": len(captures), "uploads": len(uploads),
                   "protocol": "real packaged CLI; gzip HTTP; fixed snapshot; digest refusal; cancellation",
                   "app": str(args.app), "fixture": str(root)}
        (root / "results/summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
        cards = "".join(f'<figure><a href="{html.escape(item["file"])}"><img src="{html.escape(item["file"])}" loading="lazy"></a><figcaption>{html.escape(item["file"])}</figcaption></figure>' for item in captures)
        (root / "results/index.html").write_text(
            '<!doctype html><meta charset="utf-8"><title>Otter · 原生自动化验证</title>'
            '<style>body{font:15px/1.6 -apple-system,sans-serif;margin:32px;background:#f1f4f3;color:#213238}'
            'main{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:24px}'
            'figure{margin:0}img{width:100%;border-radius:10px}figcaption{margin:8px 0;color:#587075}</style>'
            f'<h1>Otter Agent Workspace</h1><p>{checks} 项检查通过 · 真实 App、磁盘变更与内置 CLI · 隔离测试数据</p><main>{cards}</main>'
        )
        latest = root.parent / "latest"
        if latest.is_symlink():
            latest.unlink()
        if not latest.exists():
            latest.symlink_to(root.name, target_is_directory=True)
        shutil.rmtree(application)
        print(f"Passed {checks} native/protocol checks; {len(captures)} screenshots: {root / 'results/index.html'}", flush=True)
    finally:
        terminate_fixture()
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
