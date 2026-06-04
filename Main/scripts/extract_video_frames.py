import argparse
import json
import math
from pathlib import Path

import cv2 as cv


def parse_args():
    parser = argparse.ArgumentParser(description="Extract video frames at a fixed seconds interval.")
    parser.add_argument("--source", required=True, help="Absolute path to source video.")
    parser.add_argument("--output-dir", required=True, help="Absolute path to output directory.")
    parser.add_argument("--interval-seconds", required=True, type=float, help="Frame extraction interval in seconds.")
    parser.add_argument("--model", default="", help="Optional model weights path used to generate YOLO labels.")
    parser.add_argument("--confidence", default=0.25, type=float, help="Confidence threshold for label generation.")
    return parser.parse_args()


def get_model_class_names(yolo_model):
    names = getattr(yolo_model, "names", None)

    if isinstance(names, dict):
        normalized = []
        for class_id in sorted(names):
            try:
                index = int(class_id)
            except (TypeError, ValueError):
                continue
            if index < 0:
                continue
            while len(normalized) <= index:
                normalized.append(f"class_{len(normalized)}")
            normalized[index] = str(names[class_id])
        return normalized

    if isinstance(names, (list, tuple)):
        return [str(name) for name in names]

    return []


def main():
    args = parse_args()
    source = Path(args.source).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    interval_seconds = float(args.interval_seconds)
    model_path = str(args.model or "").strip()
    confidence = float(args.confidence)

    if interval_seconds <= 0:
        raise ValueError("Interval seconds must be greater than zero.")

    if not source.exists():
        raise FileNotFoundError(f"Source video was not found: {source}")

    images_dir = output_dir / "images"
    labels_dir = output_dir / "labels"
    images_dir.mkdir(parents=True, exist_ok=True)
    labels_dir.mkdir(parents=True, exist_ok=True)
    classes_path = output_dir / "classes.txt"
    capture = cv.VideoCapture(str(source))

    if not capture.isOpened():
        raise RuntimeError(f"Could not open video: {source}")

    fps = float(capture.get(cv.CAP_PROP_FPS) or 0.0)
    if not math.isfinite(fps) or fps <= 0:
        fps = 30.0

    frame_step = max(1, int(round(interval_seconds * fps)))
    frame_index = 0
    saved_count = 0
    labeled_count = 0
    duration_seconds = float(capture.get(cv.CAP_PROP_FRAME_COUNT) or 0.0) / fps
    yolo_model = None
    class_names = []

    if model_path:
        try:
            from ultralytics import YOLO
        except ImportError as error:
            raise RuntimeError(
                "Python could not import ultralytics. Install it with: pip install ultralytics"
            ) from error

        yolo_model = YOLO(model_path)
        class_names = get_model_class_names(yolo_model)

    classes_path.write_text("\n".join(class_names) + ("\n" if class_names else ""), encoding="utf-8")

    while True:
        ok, frame = capture.read()
        if not ok:
            break

        if frame_index % frame_step == 0:
            timestamp_seconds = frame_index / fps
            file_name = f"frame-{saved_count + 1:06d}-{timestamp_seconds:09.3f}s.jpg"
            output_path = images_dir / file_name
            cv.imwrite(str(output_path), frame)

            if yolo_model is not None:
                label_path = labels_dir / f"{output_path.stem}.txt"
                predictions = yolo_model.predict(
                    source=frame,
                    conf=confidence,
                    verbose=False,
                )
                result = predictions[0]
                boxes = getattr(result, "boxes", None)
                lines = []

                if boxes is not None and len(boxes) > 0:
                    xywhn_values = boxes.xywhn.detach().cpu().tolist()
                    class_values = boxes.cls.detach().cpu().tolist() if getattr(boxes, "cls", None) is not None else []

                    for index, xywhn in enumerate(xywhn_values):
                        class_id = int(class_values[index]) if index < len(class_values) else 0
                        lines.append(
                            f"{class_id} "
                            f"{float(xywhn[0]):.6f} "
                            f"{float(xywhn[1]):.6f} "
                            f"{float(xywhn[2]):.6f} "
                            f"{float(xywhn[3]):.6f}"
                        )

                label_path.write_text("\n".join(lines), encoding="utf-8")
                labeled_count += 1

            saved_count += 1

        frame_index += 1

    capture.release()
    print(
        json.dumps(
            {
                "ok": True,
                "savedCount": saved_count,
                "frameStep": frame_step,
                "fps": fps,
                "durationSeconds": max(duration_seconds, 0.0),
                "outputDir": str(output_dir),
                "labeledCount": labeled_count,
            }
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        raise
