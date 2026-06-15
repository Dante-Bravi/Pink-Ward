import argparse
import json
import math
import re
import sys
import time
from pathlib import Path


def build_parser():
    parser = argparse.ArgumentParser(
        description="Extract video frames and optional YOLO labels for Pink Ward."
    )
    parser.add_argument("--source", required=True, help="Path to the source video.")
    parser.add_argument(
        "--output-dir",
        required=True,
        help="Directory where images and labels should be written.",
    )
    parser.add_argument(
        "--interval-seconds",
        required=True,
        type=float,
        help="Time between extracted frames.",
    )
    parser.add_argument(
        "--name-base",
        default="",
        help="User-assigned Pink Ward name used for generated frame and label filenames.",
    )
    parser.add_argument("--model", default="", help="Optional YOLO model weights.")
    parser.add_argument(
        "--confidence",
        type=float,
        default=0.25,
        help="YOLO confidence threshold.",
    )
    return parser


def require_file(path_value, label):
    file_path = Path(path_value).expanduser().resolve()
    if not file_path.exists() or not file_path.is_file():
        raise FileNotFoundError(f"{label} was not found: {file_path}")
    return file_path


def sanitize_name_base(value, fallback):
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", str(value or ""))
    cleaned = re.sub(r"\s+", " ", cleaned).strip().rstrip(". ")
    return cleaned[:80] or fallback


def choose_device():
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda:0"
    except Exception:
        pass

    return "cpu"


def write_class_names(output_dir, names):
    if isinstance(names, dict):
        ordered_names = [
            str(names[class_id])
            for class_id in sorted(names, key=lambda value: int(value))
        ]
    else:
        ordered_names = [str(name) for name in names]

    classes_path = output_dir / "classes.txt"
    classes_path.write_text("\n".join(ordered_names) + "\n", encoding="utf-8")
    return classes_path


def write_yolo_label(label_path, result):
    boxes = getattr(result, "boxes", None)
    lines = []

    if boxes is not None and len(boxes):
        classes = boxes.cls.detach().cpu().tolist()
        coordinates = boxes.xywhn.detach().cpu().tolist()

        for class_id, coordinate in zip(classes, coordinates):
            x_center, y_center, width, height = coordinate
            lines.append(
                f"{int(class_id)} "
                f"{float(x_center):.8f} {float(y_center):.8f} "
                f"{float(width):.8f} {float(height):.8f}"
            )

    label_path.write_text(
        "\n".join(lines) + ("\n" if lines else ""),
        encoding="utf-8",
    )
    return len(lines)


def main():
    args = build_parser().parse_args()
    started_at = time.time()

    if not math.isfinite(args.interval_seconds) or args.interval_seconds <= 0:
        raise ValueError("Interval seconds must be greater than zero.")

    if not math.isfinite(args.confidence) or not 0 <= args.confidence <= 1:
        raise ValueError("Confidence must be between zero and one.")

    source_path = require_file(args.source, "Source video")
    output_dir = Path(args.output_dir).expanduser().resolve()
    images_dir = output_dir / "images"
    labels_dir = output_dir / "labels"
    images_dir.mkdir(parents=True, exist_ok=True)

    try:
        import cv2 as cv
    except ImportError as error:
        raise RuntimeError(
            "Python could not import OpenCV. Pink Ward's Python runtime is incomplete."
        ) from error

    model = None
    device = "cpu"
    model_path = None

    if args.model:
        model_path = require_file(args.model, "Model weights")
        try:
            from ultralytics import YOLO
        except ImportError as error:
            raise RuntimeError(
                "Python could not import ultralytics. Pink Ward's Python runtime is incomplete."
            ) from error

        model = YOLO(str(model_path))
        device = choose_device()
        labels_dir.mkdir(parents=True, exist_ok=True)
        write_class_names(output_dir, model.names)

    capture = cv.VideoCapture(str(source_path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open source video: {source_path}")

    fps = float(capture.get(cv.CAP_PROP_FPS) or 0)
    total_frames = int(capture.get(cv.CAP_PROP_FRAME_COUNT) or 0)

    if not math.isfinite(fps) or fps <= 0:
        capture.release()
        raise RuntimeError("The source video does not report a valid frame rate.")

    interval_frames = max(1, int(round(args.interval_seconds * fps)))
    name_base = sanitize_name_base(args.name_base, source_path.stem)
    frame_index = 0
    extracted_count = 0
    detection_count = 0

    try:
        while True:
            success, frame = capture.read()
            if not success:
                break

            if frame_index % interval_frames != 0:
                frame_index += 1
                continue

            extracted_count += 1
            timestamp_ms = int(round((frame_index / fps) * 1000))
            file_stem = (
                f"{name_base}-frame-{extracted_count:06d}-at-{timestamp_ms:010d}ms"
            )
            image_path = images_dir / f"{file_stem}.jpg"

            if not cv.imwrite(
                str(image_path),
                frame,
                [int(cv.IMWRITE_JPEG_QUALITY), 95],
            ):
                raise RuntimeError(f"Could not write extracted frame: {image_path}")

            if model is not None:
                results = model.predict(
                    source=frame,
                    conf=args.confidence,
                    device=device,
                    verbose=False,
                    half=str(device).lower().startswith("cuda"),
                    imgsz=640,
                )
                result = results[0]
                detection_count += write_yolo_label(
                    labels_dir / f"{file_stem}.txt",
                    result,
                )

            frame_index += 1
    finally:
        capture.release()

    if extracted_count == 0:
        raise RuntimeError("No frames could be extracted from the source video.")

    duration_seconds = total_frames / fps if total_frames > 0 else frame_index / fps
    print(
        json.dumps(
            {
                "ok": True,
                "sourcePath": str(source_path),
                "nameBase": name_base,
                "outputDir": str(output_dir),
                "modelPath": str(model_path) if model_path else "",
                "frameCount": extracted_count,
                "labelCount": extracted_count if model is not None else 0,
                "detectionCount": detection_count,
                "durationSeconds": round(duration_seconds, 3),
                "processingSeconds": round(time.time() - started_at, 3),
                "device": device,
            }
        ),
        flush=True,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}), flush=True)
        sys.exit(1)
