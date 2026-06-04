import argparse
import base64
import json
import sys
import time
from collections import deque
from pathlib import Path


IMAGE_EXTENSIONS = {".apng", ".avif", ".bmp", ".gif", ".jpg", ".jpeg", ".png", ".webp"}
VIDEO_EXTENSIONS = {".avi", ".m4v", ".mkv", ".mov", ".mp4", ".mpeg", ".mpg", ".webm", ".wmv"}
WINDOW_NAME = "Pink Ward Inference"
TRACKING_IOU_THRESHOLD = 0.5
TRACKING_HISTORY_FRAMES = 3
INFERENCE_IMAGE_SIZE = 640
STREAM_PREVIEW_FPS = 24


def build_parser():
    parser = argparse.ArgumentParser(description="Run YOLO inference for Pink Ward.")
    parser.add_argument("--model", required=True, help="Path to YOLO model weights.")
    parser.add_argument("--source", required=True, help="Path to an image, video, or directory.")
    parser.add_argument("--output-dir", required=True, help="Directory where annotated outputs should be written.")
    parser.add_argument("--conf", type=float, default=0.25, help="Confidence threshold.")
    parser.add_argument("--display", action="store_true", help="Show annotated output in an OpenCV window while running.")
    parser.add_argument("--stream-json", action="store_true", help="Stream annotated preview frames as JSON lines.")
    parser.add_argument("--enable-tracker", action="store_true", help="Use YOLO tracking instead of plain prediction.")
    return parser


def require_existing_path(path_value, label):
    path = Path(path_value).expanduser().resolve()

    if not path.exists():
        raise FileNotFoundError(f"{label} was not found: {path}")

    return path


def summarize_source(source):
    if source.is_dir():
        files = [entry for entry in source.rglob("*") if entry.is_file()]
        image_count = sum(1 for entry in files if entry.suffix.lower() in IMAGE_EXTENSIONS)
        video_count = sum(1 for entry in files if entry.suffix.lower() in VIDEO_EXTENSIONS)
        return {
            "kind": "directory",
            "fileCount": image_count + video_count,
            "imageCount": image_count,
            "videoCount": video_count,
        }

    extension = source.suffix.lower()
    return {
        "kind": "video" if extension in VIDEO_EXTENSIONS else "image",
        "fileCount": 1,
        "imageCount": 1 if extension in IMAGE_EXTENSIONS else 0,
        "videoCount": 1 if extension in VIDEO_EXTENSIONS else 0,
    }


def collect_output_files(output_dir):
    if not output_dir.exists():
        return []

    return [
        str(path)
        for path in sorted(output_dir.rglob("*"))
        if path.is_file()
    ]


def collect_output_file_details(output_dir):
    return [
        {
            "path": str(path),
            "name": path.name,
            "size": path.stat().st_size,
            "lastModified": int(path.stat().st_mtime * 1000),
        }
        for path in sorted(output_dir.rglob("*"))
        if path.is_file()
    ]


def choose_device():
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda:0"
    except Exception:
        pass

    return "cpu"


def is_cuda_device(device):
    return str(device).lower().startswith("cuda") or str(device).isdigit()


def configure_torch_for_device(device):
    if not is_cuda_device(device):
        return

    try:
        import torch

        torch.backends.cudnn.benchmark = True
        torch.set_float32_matmul_precision("high")
    except Exception:
        pass


def prepare_model_for_device(model, device):
    configure_torch_for_device(device)

    try:
        model.to(device)
    except Exception:
        pass

    try:
        model.fuse()
    except Exception:
        pass

    return model


def run_model_inference(model, source, confidence, device, enable_tracker=False, persist_tracker=False, save=False, output_dir=None):
    inference_kwargs = {
        "source": source,
        "conf": confidence,
        "device": device,
        "verbose": False,
        "half": is_cuda_device(device),
        "imgsz": INFERENCE_IMAGE_SIZE,
    }

    if save and output_dir is not None:
        inference_kwargs.update({
            "save": True,
            "project": str(output_dir.parent),
            "name": output_dir.name,
            "exist_ok": True,
        })

    if enable_tracker:
        return model.track(
            persist=bool(persist_tracker),
            show=False,
            show_labels=False,
            show_conf=False,
            show_boxes=False,
            **inference_kwargs,
        )

    return model.predict(**inference_kwargs)


def output_image_path(source_path, output_dir):
    extension = source_path.suffix.lower()

    if extension not in IMAGE_EXTENSIONS:
        extension = ".jpg"

    return output_dir / f"{source_path.stem}{extension}"


def output_video_path(source_path, output_dir):
    return output_dir / f"{source_path.stem}-detected.mp4"


def create_video_writer(cv, source_path, output_dir, fps, size):
    output_path = output_video_path(source_path, output_dir)
    codec_options = ("avc1", "H264", "mp4v")

    for codec in codec_options:
        writer = cv.VideoWriter(str(output_path), cv.VideoWriter_fourcc(*codec), fps, size)

        if writer.isOpened():
            return writer, output_path, codec

        writer.release()

    raise RuntimeError(f"Could not create output video: {output_path}")


def is_window_closed(cv):
    try:
        return cv.getWindowProperty(WINDOW_NAME, cv.WND_PROP_VISIBLE) < 1
    except cv.error:
        return True


def wait_for_image_window(cv):
    while True:
        key = cv.waitKey(50) & 0xFF

        if key in (ord("q"), 27):
            return

        if is_window_closed(cv):
            return


def emit_event(event):
    print(json.dumps(event), flush=True)


def stream_frame(cv, frame, result_count, detection_count):
    success, encoded = cv.imencode(".jpg", frame, [int(cv.IMWRITE_JPEG_QUALITY), 78])

    if not success:
        return

    emit_event({
        "event": "frame",
        "dataUrl": f"data:image/jpeg;base64,{base64.b64encode(encoded).decode('ascii')}",
        "resultCount": result_count,
        "detectionCount": detection_count,
    })


def stream_progress(result_count, total_frames, detection_count, device=None, status=None):
    progress = result_count / total_frames if total_frames > 0 else 0
    payload = {
        "event": "progress",
        "progress": max(0, min(progress, 1)),
        "resultCount": result_count,
        "totalFrames": total_frames,
        "detectionCount": detection_count,
    }

    if device:
        payload["device"] = device

    if status:
        payload["status"] = status

    emit_event(payload)


def extract_detections(result):
    boxes = getattr(result, "boxes", None)

    if boxes is None or len(boxes) == 0:
        return []

    xyxy_values = boxes.xyxy.detach().cpu().tolist()
    class_values = boxes.cls.detach().cpu().tolist() if getattr(boxes, "cls", None) is not None else []
    detections = []

    for index, coords in enumerate(xyxy_values):
        detection_class = int(class_values[index]) if index < len(class_values) else -1
        detections.append({
            "class": detection_class,
            "box": tuple(float(value) for value in coords),
        })

    return detections


def count_new_track_ids(result, seen_track_ids):
    boxes = getattr(result, "boxes", None)

    if boxes is None or len(boxes) == 0 or getattr(boxes, "id", None) is None:
        return 0

    new_count = 0
    track_ids = boxes.id.detach().cpu().tolist()

    for track_id in track_ids:
        if track_id is None:
            continue

        normalized_track_id = int(track_id)

        if normalized_track_id not in seen_track_ids:
            seen_track_ids.add(normalized_track_id)
            new_count += 1

    return new_count


def resolve_class_name(result, class_id):
    names = getattr(result, "names", None)

    if isinstance(names, dict):
        return str(names.get(class_id, "Detection"))

    if isinstance(names, (list, tuple)) and 0 <= class_id < len(names):
        return str(names[class_id])

    return "Detection"


def dedupe_tracked_detections(tracked_detections, overlap_threshold=0.35):
    if not tracked_detections:
        return []

    best_by_track_id = {}
    for detection in tracked_detections:
        track_id = detection.get("trackId")
        if track_id is None:
            continue

        current_best = best_by_track_id.get(track_id)
        if current_best is None or float(detection.get("confidence", 0.0)) > float(current_best.get("confidence", 0.0)):
            best_by_track_id[track_id] = detection

    ordered = sorted(best_by_track_id.values(), key=lambda entry: float(entry.get("confidence", 0.0)), reverse=True)
    kept = []

    for candidate in ordered:
        candidate_box = candidate.get("box")

        if not candidate_box:
            continue

        is_overlap = any(
            intersection_over_union(candidate_box, existing.get("box")) >= overlap_threshold
            for existing in kept
            if existing.get("box")
        )

        if not is_overlap:
            kept.append(candidate)

    return kept


def choose_single_tracked_detection(tracked_detections, preferred_track_id=None):
    if not tracked_detections:
        return None

    if preferred_track_id is not None:
        preferred_matches = [detection for detection in tracked_detections if detection.get("trackId") == preferred_track_id]
        if preferred_matches:
            return max(preferred_matches, key=lambda entry: float(entry.get("confidence", 0.0)))

    return max(tracked_detections, key=lambda entry: float(entry.get("confidence", 0.0)))


def plot_tracked_only(cv, result, base_frame=None, preferred_track_id=None):
    boxes = getattr(result, "boxes", None)
    if base_frame is None:
        base_frame = getattr(result, "orig_img", None)

    if base_frame is None:
        return result.plot(font_size=5, line_width=1)

    annotated = base_frame.copy()

    if boxes is None or len(boxes) == 0 or getattr(boxes, "id", None) is None:
        return annotated, None

    xyxy_values = boxes.xyxy.detach().cpu().tolist()
    confidence_values = boxes.conf.detach().cpu().tolist() if getattr(boxes, "conf", None) is not None else []
    class_values = boxes.cls.detach().cpu().tolist() if getattr(boxes, "cls", None) is not None else []
    track_id_values = boxes.id.detach().cpu().tolist()

    tracked_detections = []

    for index, coords in enumerate(xyxy_values):
        track_id = track_id_values[index] if index < len(track_id_values) else None
        if track_id is None:
            continue

        tracked_detections.append({
            "trackId": int(track_id),
            "box": tuple(float(value) for value in coords),
            "classId": int(class_values[index]) if index < len(class_values) else -1,
            "confidence": float(confidence_values[index]) if index < len(confidence_values) else 0.0,
        })

    filtered = dedupe_tracked_detections(tracked_detections)
    primary_detection = choose_single_tracked_detection(filtered, preferred_track_id)

    if primary_detection is None:
        return annotated, None

    x1, y1, x2, y2 = [int(round(value)) for value in primary_detection["box"]]
    label = f"id:{primary_detection['trackId']}"

    cv.rectangle(annotated, (x1, y1), (x2, y2), (255, 0, 0), 1)
    text_scale = 0.42
    text_thickness = 1
    (text_width, text_height), baseline = cv.getTextSize(label, cv.FONT_HERSHEY_SIMPLEX, text_scale, text_thickness)
    text_top = max(0, y1 - text_height - baseline - 6)
    cv.rectangle(annotated, (x1, text_top), (x1 + text_width + 6, text_top + text_height + baseline + 4), (255, 0, 0), -1)
    cv.putText(
        annotated,
        label,
        (x1 + 3, text_top + text_height + 1),
        cv.FONT_HERSHEY_SIMPLEX,
        text_scale,
        (255, 255, 255),
        text_thickness,
        cv.LINE_AA,
    )

    return annotated, primary_detection["trackId"]


def intersection_over_union(first_box, second_box):
    first_x1, first_y1, first_x2, first_y2 = first_box
    second_x1, second_y1, second_x2, second_y2 = second_box

    intersection_x1 = max(first_x1, second_x1)
    intersection_y1 = max(first_y1, second_y1)
    intersection_x2 = min(first_x2, second_x2)
    intersection_y2 = min(first_y2, second_y2)

    intersection_width = max(0.0, intersection_x2 - intersection_x1)
    intersection_height = max(0.0, intersection_y2 - intersection_y1)
    intersection_area = intersection_width * intersection_height

    first_area = max(0.0, first_x2 - first_x1) * max(0.0, first_y2 - first_y1)
    second_area = max(0.0, second_x2 - second_x1) * max(0.0, second_y2 - second_y1)
    union_area = first_area + second_area - intersection_area

    if union_area <= 0:
        return 0.0

    return intersection_area / union_area


def count_new_detections(detections, recent_frames):
    new_detection_count = 0
    previous_detections = [
        previous_detection
        for frame_detections in recent_frames
        for previous_detection in frame_detections
    ]

    for detection in detections:
        matched_recent_detection = any(
            detection["class"] == previous_detection["class"]
            and intersection_over_union(detection["box"], previous_detection["box"]) >= TRACKING_IOU_THRESHOLD
            for previous_detection in previous_detections
        )

        if not matched_recent_detection:
            new_detection_count += 1

    return new_detection_count


def run_image_display(model, source_path, output_dir, confidence, device, stream_json=False, enable_tracker=False):
    import cv2 as cv

    results = run_model_inference(model, str(source_path), confidence, device, enable_tracker=enable_tracker)
    result = results[0]
    annotated = result.plot(font_size=5, line_width=1)
    output_path = output_image_path(source_path, output_dir)
    cv.imwrite(str(output_path), annotated)
    boxes = getattr(result, "boxes", None)
    detection_count = len(boxes) if boxes is not None else 0

    if stream_json:
      stream_frame(cv, annotated, 1, detection_count)
    else:
      cv.namedWindow(WINDOW_NAME, cv.WINDOW_NORMAL)
      cv.imshow(WINDOW_NAME, annotated)
      wait_for_image_window(cv)
      cv.destroyAllWindows()

    return {
        "detectionCount": detection_count,
        "resultCount": 1,
    }


def run_video_display(model, source_path, output_dir, confidence, device, stream_json=False, enable_tracker=False):
    import cv2 as cv

    metadata_capture = cv.VideoCapture(str(source_path))

    if not metadata_capture.isOpened():
        raise RuntimeError(f"Could not open video: {source_path}")

    fps = metadata_capture.get(cv.CAP_PROP_FPS)
    if fps <= 0:
        fps = 30

    width = int(metadata_capture.get(cv.CAP_PROP_FRAME_WIDTH))
    height = int(metadata_capture.get(cv.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(metadata_capture.get(cv.CAP_PROP_FRAME_COUNT) or 0)
    metadata_capture.release()

    writer = None
    output_codec = ""
    output_path = output_video_path(source_path, output_dir)
    if width > 0 and height > 0:
        writer, output_path, output_codec = create_video_writer(cv, source_path, output_dir, fps, (width, height))
    capture = cv.VideoCapture(str(source_path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video: {source_path}")

    detection_count = 0
    result_count = 0
    skipped_frame_count = 0
    last_progress_at = 0
    recent_detection_frames = deque(maxlen=TRACKING_HISTORY_FRAMES)
    seen_track_ids = set()
    primary_track_id = None

    if not stream_json:
      cv.namedWindow(WINDOW_NAME, cv.WINDOW_NORMAL)
    else:
      stream_progress(0, total_frames, detection_count, device, "Model loaded. Rendering video frames.")

    try:
        if enable_tracker:
            def iter_frame_results():
                while capture.isOpened():
                    success, frame = capture.read()
                    if not success:
                        break

                    inference_frame = frame.copy()
                    yield frame, model.track(
                        source=inference_frame,
                        conf=confidence,
                        device=device,
                        verbose=False,
                        half=is_cuda_device(device),
                        imgsz=INFERENCE_IMAGE_SIZE,
                        persist=True,
                        show=False,
                        save=False,
                        show_labels=False,
                        show_conf=False,
                        show_boxes=False,
                        iou=0.45,
                    )

            result_iterator = iter_frame_results()
        else:
            def iter_frame_results():
                while capture.isOpened():
                    success, frame = capture.read()

                    if not success:
                        break

                    yield run_model_inference(
                        model,
                        frame,
                        confidence,
                        device,
                        enable_tracker=False,
                        persist_tracker=False,
                    )

            result_iterator = iter_frame_results()

        for incoming in result_iterator:
            frame = None
            if enable_tracker:
                frame, tracked_result = incoming
                result = tracked_result[0] if isinstance(tracked_result, (list, tuple)) else tracked_result
            else:
                result = incoming[0] if isinstance(incoming, (list, tuple)) else incoming

            if enable_tracker:
                detection_count += count_new_track_ids(result, seen_track_ids)
            else:
                detections = extract_detections(result)
                detection_count += count_new_detections(detections, recent_detection_frames)
                recent_detection_frames.append(detections)

            result_count += 1

            if not stream_json and is_window_closed(cv):
                break

            if enable_tracker:
                annotated, primary_track_id = plot_tracked_only(cv, result, base_frame=frame, preferred_track_id=primary_track_id)
            else:
                annotated = result.plot(font_size=5, line_width=1)
            if writer is None:
                frame_height, frame_width = annotated.shape[:2]
                writer, output_path, output_codec = create_video_writer(cv, source_path, output_dir, fps, (frame_width, frame_height))
            writer.write(annotated)

            if stream_json:
                now = time.perf_counter()

                if now - last_progress_at >= 0.2:
                    stream_progress(result_count, total_frames, detection_count)
                    last_progress_at = now

                continue

            cv.imshow(WINDOW_NAME, annotated)
            key = cv.waitKey(1) & 0xFF

            if key in (ord("q"), 27) or is_window_closed(cv):
                break
    finally:
        capture.release()
        if writer is not None:
            writer.release()
        cv.destroyAllWindows()

    if stream_json:
        stream_progress(result_count, total_frames or result_count, detection_count)

    return {
        "detectionCount": detection_count,
        "resultCount": result_count,
        "skippedFrameCount": skipped_frame_count,
        "outputCodec": output_codec,
    }


def run_directory_display(model, source_path, output_dir, confidence, device, stream_json=False, enable_tracker=False):
    import cv2 as cv

    supported_files = [
        path
        for path in sorted(source_path.rglob("*"))
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    ]
    detection_count = 0
    result_count = 0
    if not stream_json:
        cv.namedWindow(WINDOW_NAME, cv.WINDOW_NORMAL)

    for image_path in supported_files:
        results = run_model_inference(model, str(image_path), confidence, device, enable_tracker=enable_tracker)
        result = results[0]
        boxes = getattr(result, "boxes", None)

        if boxes is not None:
            detection_count += len(boxes)

        result_count += 1
        annotated = result.plot(font_size=5, line_width=1)
        relative_path = image_path.relative_to(source_path)
        output_path = output_dir / relative_path
        output_path.parent.mkdir(parents=True, exist_ok=True)
        cv.imwrite(str(output_path), annotated)

        if stream_json:
            stream_frame(cv, annotated, result_count, detection_count)
            continue

        cv.imshow(WINDOW_NAME, annotated)

        key = cv.waitKey(0) & 0xFF

        if key in (ord("q"), 27) or is_window_closed(cv):
            break

    cv.destroyAllWindows()
    return {
        "detectionCount": detection_count,
        "resultCount": result_count,
    }


def run_display_inference(model, source_path, output_dir, confidence, device, stream_json=False, enable_tracker=False):
    if source_path.is_dir():
        return run_directory_display(model, source_path, output_dir, confidence, device, stream_json, enable_tracker)

    if source_path.suffix.lower() in VIDEO_EXTENSIONS:
        return run_video_display(model, source_path, output_dir, confidence, device, stream_json, enable_tracker)

    return run_image_display(model, source_path, output_dir, confidence, device, stream_json, enable_tracker)


def run_saved_inference(model, source_path, output_dir, confidence, device, enable_tracker=False):
    results = run_model_inference(
        model,
        str(source_path),
        confidence,
        device,
        enable_tracker=enable_tracker,
        persist_tracker=enable_tracker,
        save=True,
        output_dir=output_dir,
    )
    detection_count = 0
    result_count = 0

    for result in results:
        result_count += 1
        boxes = getattr(result, "boxes", None)

        if boxes is not None:
            detection_count += len(boxes)

    return {
        "detectionCount": detection_count,
        "resultCount": result_count,
    }


def main():
    args = build_parser().parse_args()
    start_time = time.time()
    model_path = require_existing_path(args.model, "Model weights")
    source_path = require_existing_path(args.source, "Inference source")
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        from ultralytics import YOLO
    except ImportError as error:
        raise RuntimeError(
            "Python could not import ultralytics. Install it with: pip install ultralytics"
        ) from error

    device = choose_device()
    model = prepare_model_for_device(YOLO(str(model_path)), device)
    run_summary = run_display_inference(
        model,
        source_path,
        output_dir,
        args.conf,
        device,
        args.stream_json,
        args.enable_tracker,
    ) if args.display else run_saved_inference(
        model,
        source_path,
        output_dir,
        args.conf,
        device,
        args.enable_tracker,
    )

    payload = {
        "ok": True,
        "modelPath": str(model_path),
        "sourcePath": str(source_path),
        "outputDir": str(output_dir),
        "outputFiles": collect_output_files(output_dir),
        "outputFileDetails": collect_output_file_details(output_dir),
        "detectionCount": run_summary["detectionCount"],
        "resultCount": run_summary["resultCount"],
        "skippedFrameCount": run_summary.get("skippedFrameCount", 0),
        "device": device,
        "source": summarize_source(source_path),
        "durationSeconds": round(time.time() - start_time, 3),
    }
    print(json.dumps(payload), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}), flush=True)
        sys.exit(1)
