import json
from pathlib import Path

import cv2 as cv


STORE_PATH = Path.home() / "AppData" / "Roaming" / "pink-ward" / "pink-ward-projects.json"


def create_writer(path, fps, size):
    for codec in ("avc1", "H264"):
        writer = cv.VideoWriter(str(path), cv.VideoWriter_fourcc(*codec), fps, size)

        if writer.isOpened():
            return writer

        writer.release()

    raise RuntimeError(f"Could not create playable MP4: {path}")


def transcode_to_playable_mp4(source):
    source = Path(source)

    if not source.exists():
        return None

    playable_path = source.with_name(f"{source.stem}-playable.mp4")

    if playable_path.exists() and playable_path.stat().st_size > 0:
        return playable_path

    capture = cv.VideoCapture(str(source))

    if not capture.isOpened():
        return None

    fps = capture.get(cv.CAP_PROP_FPS) or 30
    width = int(capture.get(cv.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(capture.get(cv.CAP_PROP_FRAME_HEIGHT) or 0)

    if width <= 0 or height <= 0:
        capture.release()
        return None

    temp_path = playable_path.with_suffix(".tmp.mp4")
    writer = create_writer(temp_path, fps, (width, height))

    try:
        while True:
            ok, frame = capture.read()

            if not ok:
                break

            writer.write(frame)
    finally:
        capture.release()
        writer.release()

    if temp_path.exists() and temp_path.stat().st_size > 0:
        temp_path.replace(playable_path)
        return playable_path

    return None


def main():
    store = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    repaired = 0
    resized = 0

    for project in store.get("projects", []):
        inference_items = project.get("data", {}).get("inference", [])

        for item in inference_items:
            files = item.get("files") or []

            if not files:
                continue

            file_record = files[0]
            current_path = Path(file_record.get("absolutePath") or "")

            if current_path.suffix.lower() == ".mp4" and "-playable" not in current_path.stem:
                playable_path = transcode_to_playable_mp4(current_path)

                if playable_path:
                    current_path = playable_path
                    file_record["absolutePath"] = str(playable_path)
                    file_record["name"] = playable_path.name
                    file_record["relativePath"] = playable_path.name
                    repaired += 1

            if current_path.exists():
                stat = current_path.stat()
                file_record["size"] = stat.st_size
                file_record["lastModified"] = int(stat.st_mtime * 1000)
                resized += 1

    STORE_PATH.write_text(json.dumps(store, indent=2), encoding="utf-8")
    print(f"repaired={repaired} resized={resized}")


if __name__ == "__main__":
    main()
