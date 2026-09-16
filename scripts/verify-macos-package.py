#!/usr/bin/env python3
"""Validate the universal app and its ZIP/DMG without opening a user's workspace."""
import filecmp
import json
import os
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess
import tempfile

REPOSITORY = Path(__file__).resolve().parent.parent


def run(*arguments, env=None):
    return subprocess.check_output(arguments, text=True, env=env, timeout=40).strip()


def main():
    application = REPOSITORY / "build/macos/Build/Products/Release/Otter.app"
    output = REPOSITORY / "build/macos-release"
    output.mkdir(parents=True, exist_ok=True)
    with (application / "Contents/Info.plist").open("rb") as stream:
        plist = plistlib.load(stream)
    version = json.loads((REPOSITORY / "package.json").read_text())["version"]
    assert plist["CFBundleShortVersionString"] == version, "Native and CLI versions must agree"
    assert plist.get("CFBundleIconFile") == "Otter", "Built Info.plist must register the Dock/Finder icon"
    assert (application / "Contents/Resources/Otter.icns").is_file(), "Native app icon is required"
    assert (application / "Contents/Resources/ThirdPartyNotices.txt").is_file(), "Dependency licenses must travel with the app"
    executable = application / "Contents/MacOS/Otter"
    framework = application / "Contents/Frameworks/OtterCore.framework/OtterCore"
    for binary in [executable, framework]:
        assert set(run("lipo", "-archs", str(binary)).split()) == {"arm64", "x86_64"}, binary
    assert b"--automation-root" not in executable.read_bytes(), "Fixture automation must be absent in Release"
    for name, architecture in [("arm64", "arm64"), ("x64", "x86_64")]:
        helper = application / f"Contents/Resources/CLI/otter-{name}"
        assert run("lipo", "-archs", str(helper)) == architecture, "Bun helpers must remain separate architecture payloads"
        assert os.access(helper, os.X_OK)
    with tempfile.TemporaryDirectory(prefix="otter package with spaces ") as temporary:
        root = Path(temporary)
        relocated = root / "Moved Otter.app"
        shutil.copytree(application, relocated, symlinks=True)
        architecture = "arm64" if platform.machine() == "arm64" else "x64"
        helper = relocated / f"Contents/Resources/CLI/otter-{architecture}"
        environment = os.environ.copy()
        environment["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
        common = ["--json", "--config-dir", str(root / "config"), "--scan-root", str(root / "fixture-home"),
                  "--output-dir", str(root / "snapshots"), "--api-url", "http://127.0.0.1:1"]
        capabilities = json.loads(run(str(helper), "capabilities", *common, env=environment))
        assert capabilities["protocolVersion"] == 1
        assert capabilities["cliVersion"] == version
        assert capabilities["arch"] == ("arm64" if architecture == "arm64" else "x64")
        assert json.loads(run(str(helper), "snapshot", "list", *common, env=environment)) == []
        status = json.loads(run(str(helper), "config", "status", *common, env=environment))
        assert status["authenticated"] is False
        assert not (root / "config").exists(), "Read-only packaging checks must not create user config"
    archive = output / f"Otter-{version}-macOS-unsigned.zip"
    if archive.exists():
        archive.unlink()
    subprocess.run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(application), str(archive)], check=True)
    disk_image = output / f"Otter-{version}-macOS-unsigned.dmg"
    with tempfile.TemporaryDirectory(prefix="otter disk image ") as temporary:
        root = Path(temporary)
        staging = root / "staging"
        staging.mkdir()
        subprocess.run(["ditto", str(application), str(staging / "Otter.app")], check=True)
        (staging / "Applications").symlink_to("/Applications", target_is_directory=True)
        subprocess.run(["hdiutil", "create", "-volname", f"Otter {version}", "-fs", "HFS+",
                        "-format", "UDZO", "-srcfolder", str(staging), "-ov", str(disk_image)],
                       check=True, timeout=300)
        subprocess.run(["hdiutil", "verify", str(disk_image)], check=True, timeout=120)
        mounted = root / "mounted"
        mounted.mkdir()
        subprocess.run(["hdiutil", "attach", str(disk_image), "-readonly", "-nobrowse", "-noautoopen",
                        "-mountpoint", str(mounted)], check=True, timeout=60)
        try:
            assert (mounted / "Applications").readlink() == Path("/Applications")
            mounted_app = mounted / "Otter.app"
            with (mounted_app / "Contents/Info.plist").open("rb") as stream:
                assert plistlib.load(stream)["CFBundleShortVersionString"] == version
            assert {p.relative_to(application) for p in application.rglob("*")} == {
                p.relative_to(mounted_app) for p in mounted_app.rglob("*")}
            for original in application.rglob("*"):
                packaged = mounted_app / original.relative_to(application)
                if original.is_symlink():
                    assert packaged.is_symlink() and original.readlink() == packaged.readlink()
                elif original.is_file():
                    assert filecmp.cmp(original, packaged, shallow=False), original
                    assert original.stat().st_mode & 0o777 == packaged.stat().st_mode & 0o777
            helper = mounted_app / f"Contents/Resources/CLI/otter-{architecture}"
            capabilities = json.loads(run(str(helper), "capabilities", "--json",
                                          "--config-dir", str(root / "config"),
                                          "--scan-root", str(root / "fixture-home"),
                                          "--output-dir", str(root / "snapshots"), env=environment))
            assert capabilities["cliVersion"] == version
            assert not (root / "config").exists()
        finally:
            detached = subprocess.run(["hdiutil", "detach", str(mounted)], timeout=60)
            if detached.returncode != 0:
                # Spotlight may briefly hold our private, read-only verification mount.
                subprocess.run(["hdiutil", "detach", "-force", str(mounted)], check=True, timeout=60)
    checksums = {path.name: run("shasum", "-a", "256", str(path)).split()[0]
                 for path in [disk_image, archive]}
    (output / "SHA256SUMS.txt").write_text("".join(f"{digest}  {name}\n" for name, digest in checksums.items()))
    report = {"status": "passed", "version": version, "archive": archive.name,
              "diskImage": disk_image.name, "diskImageMounted": True, "sha256": checksums,
              "appArchitectures": ["arm64", "x86_64"], "helperArchitectures": ["arm64", "x64"],
              "executedHelper": platform.machine(), "relocationWithSpaces": True,
              "bundleIconRegistered": True,
              "minimalPath": True, "releaseExcludesAutomation": True, "signedForDistribution": False,
              "limits": ["Only the current host architecture was executed", "Apple signing and notarization are not configured"]}
    (output / "verification.json").write_text(json.dumps(report, indent=2))
    print(f"Verified universal app, relocated CLI and mounted DMG for {version}: {disk_image}")


if __name__ == "__main__":
    main()
