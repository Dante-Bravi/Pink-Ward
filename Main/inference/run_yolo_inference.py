import base64
import base64
import argparse
import json
import sys
import time
from pathlib import Path


IMAGE_EXTENSIONS = {".apng", ".avif", ".bmp", ".gif", ".jpg", ".jpeg", ".png", ".webp"}
VIDEO_EXTENSIONS = {".avi", ".m4v", ".mkv", ".mov", ".mp4", ".mpeg", ".mpg", ".webm", ".wmv"}
INFERENCE_IMAGE_SIZE = 640


def build_parser():
    parser = argparse.ArgumentParser(description="Run YOLO inference for Pink Ward.")
    parser.add_argument("--model", required=True, help="Path to YOLO model weights.")
    parser.add_argument("--source", required=True, help="Path to an image, video, or directory.")
    parser.add_argument("--output-dir", required=True, help="Directory where annotated outputs should be written.")
    parser.add_argument("--conf", type=float, default=0.25, help="Confidence threshold.")
    parser.add_argument("--display", action="store_true", help="Compatibility flag for caller.")
    parser.add_argument("--stream-json", action="store_true", help="Emit JSON progress events.")
    parser.add_argument("--enable-tracker", action="store_true", help="Use YOLO tracking mode.")
    parser.add_argument("--tracker", default="botsort.yaml", help="Tracker config used when tracking is enabled.")
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


def extract_tracker_ids(result):
    boxes = getattr(result, "boxes", None)
    if boxes is None:
        return []

    raw_ids = getattr(boxes, "id", None)
    if raw_ids is None:
        return []

    try:
        values = raw_ids.tolist()
    except Exception:
        try:
            values = raw_ids.cpu().tolist()
        except Exception:
            return []

    if not isinstance(values, list):
        values = [values]

    tracker_ids = []
    for value in values:
        if value is None:
            continue
        try:
            tracker_ids.append(int(value))
        except (TypeError, ValueError):
            continue

    return tracker_ids


def is_cuda_device(device):
    return str(device).lower().startswith("cuda") or str(device).isdigit()


def choose_device():
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda:0"
    except Exception:
        pass

    return "cpu"


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
            return writer, output_path

        writer.release()

    raise RuntimeError(f"Could not create output video: {output_path}")


def run_model_once(model, frame_or_path, confidence, device, enable_tracker=False, tracker_config="botsort.yaml"):
    kwargs = {
        "source": frame_or_path,
        "conf": confidence,
        "device": device,
        "verbose": False,
        "half": is_cuda_device(device),
        "imgsz": INFERENCE_IMAGE_SIZE,
    }

    if enable_tracker:
        kwargs["persist"] = True
        kwargs["show"] = False
        if tracker_config:
            kwargs["tracker"] = tracker_config
        return model.track(**kwargs)

    return model.predict(**kwargs)


def run_image(model, source_path, output_dir, confidence, device, enable_tracker=False, tracker_config="botsort.yaml", stream_json=False):
    import cv2 as cv

    results = run_model_once(model, str(source_path), confidence, device, enable_tracker, tracker_config)
    result = results[0]
    annotated = result.plot(font_size=5, line_width=1)
    out_path = output_image_path(source_path, output_dir)
    cv.imwrite(str(out_path), annotated)

    boxes = getattr(result, "boxes", None)
    detection_count = len(boxes) if boxes is not None else 0

    if stream_json:
        stream_frame(cv, annotated, 1, detection_count)
        emit_event({
            "event": "progress",
            "progress": 1,
            "resultCount": 1,
            "totalFrames": 1,
            "detectionCount": detection_count,
        })

    return {
        "detectionCount": detection_count,
        "resultCount": 1,
    }


def run_video(model, source_path, output_dir, confidence, device, enable_tracker=False, tracker_config="botsort.yaml", stream_json=False):
    import cv2 as cv

    capture = cv.VideoCapture(str(source_path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video: {source_path}")

    fps = capture.get(cv.CAP_PROP_FPS)
    if fps <= 0:
        fps = 30

    width = int(capture.get(cv.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(capture.get(cv.CAP_PROP_FRAME_HEIGHT) or 0)
    if width <= 0 or height <= 0:
        raise RuntimeError(f"Video dimensions were unavailable: {source_path}")

    total_frames = int(capture.get(cv.CAP_PROP_FRAME_COUNT) or 0)
    writer, _ = create_video_writer(cv, source_path, output_dir, fps, (width, height))

    detection_count = 0
    result_count = 0
    last_progress_at = 0
    seen_tracker_ids = set()
    tracker_moments = []
    active_tracker_start_frames = {}
    tracker_last_seen_frames = {}
    tracker_spans = []
    detection_spans = []
    active_detection_span_start = None
    active_detection_span_last = None

    def close_tracker_span(track_id):
        start_frame = active_tracker_start_frames.pop(track_id, None)
        end_frame = tracker_last_seen_frames.pop(track_id, None)
        if start_frame is None or end_frame is None:
            return
        tracker_spans.append({
            "trackId": int(track_id),
            "startFrameIndex": int(start_frame),
            "endFrameIndex": int(max(start_frame, end_frame)),
        })

    def close_detection_span():
        nonlocal active_detection_span_start, active_detection_span_last
        if active_detection_span_start is None or active_detection_span_last is None:
            active_detection_span_start = None
            active_detection_span_last = None
            return
        detection_spans.append({
            "startFrameIndex": int(active_detection_span_start),
            "endFrameIndex": int(max(active_detection_span_start, active_detection_span_last)),
        })
        active_detection_span_start = None
        active_detection_span_last = None

    try:
        while capture.isOpened():
            ok, frame = capture.read()
            if not ok:
                break

            results = run_model_once(model, frame, confidence, device, enable_tracker, tracker_config)
            result = results[0]
            annotated = result.plot(font_size=5, line_width=1)
            boxes = getattr(result, "boxes", None)
            has_detections = boxes is not None and len(boxes) > 0
            if boxes is not None:
                detection_count += len(boxes)

            tracker_ids = extract_tracker_ids(result) if enable_tracker else []
            if enable_tracker and tracker_ids:
                new_ids = sorted({track_id for track_id in tracker_ids if track_id not in seen_tracker_ids})
                if new_ids:
                    frame_index = result_count + 1
                    tracker_moments.append({
                        "frameIndex": frame_index,
                        "timeSeconds": round(frame_index / fps, 3) if fps > 0 else 0,
                        "newTrackIds": new_ids,
                        "newTrackCount": len(new_ids),
                    })
                    seen_tracker_ids.update(new_ids)

            frame_index = result_count + 1
            if has_detections:
                if active_detection_span_start is None:
                    active_detection_span_start = frame_index
                active_detection_span_last = frame_index
            else:
                close_detection_span()

            if enable_tracker:
                current_tracker_set = set(int(track_id) for track_id in tracker_ids)
                ended_trackers = [track_id for track_id in active_tracker_start_frames if track_id not in current_tracker_set]
                for track_id in ended_trackers:
                    close_tracker_span(track_id)

                for track_id in current_tracker_set:
                    if track_id not in active_tracker_start_frames:
                        active_tracker_start_frames[track_id] = frame_index
                    tracker_last_seen_frames[track_id] = frame_index

            writer.write(annotated)

            result_count += 1

            if stream_json:
                stream_frame(cv, annotated, result_count, detection_count)
                now = time.perf_counter()
                if now - last_progress_at >= 0.2:
                    progress = (result_count / total_frames) if total_frames > 0 else 0
                    emit_event({
                        "event": "progress",
                        "progress": max(0, min(progress, 1)),
                        "resultCount": result_count,
                        "totalFrames": total_frames,
                        "detectionCount": detection_count,
                    })
                    last_progress_at = now
    finally:
        capture.release()
        writer.release()

    close_detection_span()
    if enable_tracker:
        for track_id in list(active_tracker_start_frames.keys()):
            close_tracker_span(track_id)

    tracker_spans = sorted(tracker_spans, key=lambda span: (span["startFrameIndex"], span["endFrameIndex"], span["trackId"]))
    detection_spans = sorted(detection_spans, key=lambda span: (span["startFrameIndex"], span["endFrameIndex"]))

    def with_time_values(span):
        start_frame = int(span["startFrameIndex"])
        end_frame = int(max(start_frame, int(span["endFrameIndex"])))
        return {
            **span,
            "startTimeSeconds": round((start_frame / fps), 3) if fps > 0 else 0,
            "endTimeSeconds": round((end_frame / fps), 3) if fps > 0 else 0,
        }

    tracker_spans = [with_time_values(span) for span in tracker_spans]
    detection_spans = [with_time_values(span) for span in detection_spans]

    if stream_json:
        emit_event({
            "event": "progress",
            "progress": 1,
            "resultCount": result_count,
            "totalFrames": total_frames if total_frames > 0 else result_count,
            "detectionCount": detection_count,
        })

    return {
        "detectionCount": detection_count,
        "resultCount": result_count,
        "trackingTimeline": {
            "trackerEnabled": bool(enable_tracker),
            "markerType": "new-tracker-id" if enable_tracker else "detection-presence",
            "sourceFps": float(fps),
            "totalFrames": result_count,
            "durationSeconds": round((result_count / fps), 3) if fps > 0 else 0,
            "uniqueTrackCount": len(seen_tracker_ids),
            "importantMoments": tracker_moments,
            "trackSpans": tracker_spans,
            "detectionSpans": detection_spans,
        },
    }


def run_directory(model, source_path, output_dir, confidence, device, enable_tracker=False, tracker_config="botsort.yaml", stream_json=False):
    import cv2 as cv

    images = [
        path
        for path in sorted(source_path.rglob("*"))
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    ]

    detection_count = 0
    result_count = 0

    for index, image_path in enumerate(images):
        results = run_model_once(model, str(image_path), confidence, device, enable_tracker, tracker_config)
        result = results[0]
        annotated = result.plot(font_size=5, line_width=1)
        rel = image_path.relative_to(source_path)
        out_path = output_dir / rel
        out_path.parent.mkdir(parents=True, exist_ok=True)
        cv.imwrite(str(out_path), annotated)

        boxes = getattr(result, "boxes", None)
        if boxes is not None:
            detection_count += len(boxes)

        result_count += 1

        if stream_json:
            stream_frame(cv, annotated, result_count, detection_count)
            progress = (result_count / len(images)) if images else 1
            emit_event({
                "event": "progress",
                "progress": max(0, min(progress, 1)),
                "resultCount": result_count,
                "totalFrames": len(images),
                "detectionCount": detection_count,
            })

    return {
        "detectionCount": detection_count,
        "resultCount": result_count,
    }


def run_inference(model, source_path, output_dir, confidence, device, enable_tracker=False, tracker_config="botsort.yaml", stream_json=False):
    if source_path.is_dir():
        return run_directory(model, source_path, output_dir, confidence, device, enable_tracker, tracker_config, stream_json)

    if source_path.suffix.lower() in VIDEO_EXTENSIONS:
        return run_video(model, source_path, output_dir, confidence, device, enable_tracker, tracker_config, stream_json)

    return run_image(model, source_path, output_dir, confidence, device, enable_tracker, tracker_config, stream_json)


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

    model = YOLO(str(model_path))
    device = choose_device()

    run_summary = run_inference(
        model,
        source_path,
        output_dir,
        args.conf,
        device,
        enable_tracker=args.enable_tracker,
        tracker_config=args.tracker,
        stream_json=args.stream_json,
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
        "trackingTimeline": run_summary.get("trackingTimeline"),
        "trackerEnabled": bool(args.enable_tracker),
        "skippedFrameCount": 0,
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
