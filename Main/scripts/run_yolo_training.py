import argparse
import hashlib
import json
import math
import shutil
import sys
from pathlib import Path


IMAGE_EXTENSIONS = {".apng", ".avif", ".bmp", ".gif", ".jpg", ".jpeg", ".png", ".webp"}
LABEL_EXTENSION = ".txt"
DEFAULT_VALIDATION_SPLIT = 20


def build_parser():
    parser = argparse.ArgumentParser(description="Run YOLO training for Pink Ward.")
    parser.add_argument("--payload-json", required=True, help="Path to JSON payload created by the desktop app.")
    parser.add_argument("--result-json", default="", help="Optional path to write the final training result JSON.")
    parser.add_argument("--progress-json", default="", help="Optional path to write live training progress JSON.")
    return parser


def safe_key(file_path):
    normalized = str(file_path).replace("\\", "/").strip()
    if not normalized:
        return ""
    return Path(normalized).with_suffix("").as_posix().lower()


def parse_metric_number(value):
    raw = str(value or "").strip().replace("%", "")
    if not raw:
        return None
    try:
        parsed = float(raw)
        return parsed if math.isfinite(parsed) else None
    except (TypeError, ValueError):
        return None


def normalize_header(header):
    return (
        str(header or "")
        .strip()
        .lower()
        .replace(" ", "")
        .replace("_", "")
        .replace("-", "")
        .replace("(", "")
        .replace(")", "")
    )


def parse_results_csv(results_csv_path):
    import csv

    csv_path = Path(results_csv_path)
    if not csv_path.exists():
        return None

    rows = []
    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle)
        for row in reader:
            if any(str(entry or "").strip() for entry in row):
                rows.append(row)

    if len(rows) < 2:
        return None

    headers = [normalize_header(entry) for entry in rows[0]]
    data_rows = rows[1:]
    last_values = data_rows[-1]

    def find_metric_from_row(values, predicate, prefer_validation=True):
        matching_indexes = [
            index
            for index, header in enumerate(headers)
            if predicate(header)
        ]

        if prefer_validation:
            matching_indexes.sort(key=lambda index: "val" in headers[index], reverse=True)

        for index in matching_indexes:
            if index >= len(values):
                continue
            parsed = parse_metric_number(values[index])
            if parsed is not None:
                return parsed
        return None

    def get_row_metrics(values):
        return {
            "precision": find_metric_from_row(values, lambda header: "precision" in header),
            "recall": find_metric_from_row(values, lambda header: "recall" in header),
            "map50": find_metric_from_row(values, lambda header: "map50" in header and "95" not in header),
            "map5095": find_metric_from_row(values, lambda header: "map50" in header and "95" in header),
            "boxLoss": find_metric_from_row(values, lambda header: "boxloss" in header),
            "classLoss": find_metric_from_row(values, lambda header: "classloss" in header or "clsloss" in header),
            "epoch": find_metric_from_row(values, lambda header: header == "epoch" or header.endswith("/epoch"), False),
            "fitness": find_metric_from_row(values, lambda header: header == "fitness", False),
        }

    def get_row_fitness(metrics):
        if metrics.get("fitness") is not None:
            return metrics["fitness"]

        map50 = metrics.get("map50")
        map5095 = metrics.get("map5095")
        if map50 is not None and map5095 is not None:
            return (0.9 * map5095) + (0.1 * map50)
        if map5095 is not None:
            return map5095
        if map50 is not None:
            return map50
        return float("-inf")

    scored_rows = []
    for row_index, values in enumerate(data_rows):
        metrics = get_row_metrics(values)
        scored_rows.append({
            "metrics": metrics,
            "score": get_row_fitness(metrics),
            "row_index": row_index,
        })

    best_row = None
    for row in scored_rows:
        if best_row is None or row["score"] > best_row["score"]:
            best_row = row

    final_metrics = get_row_metrics(last_values)
    selected_metrics = best_row["metrics"] if best_row and best_row["score"] != float("-inf") else final_metrics

    metric_values = [
        selected_metrics.get("precision"),
        selected_metrics.get("recall"),
        selected_metrics.get("map50"),
        selected_metrics.get("map5095"),
        selected_metrics.get("boxLoss"),
        selected_metrics.get("classLoss"),
    ]
    if all(metric is None for metric in metric_values):
        return None

    first_row_epoch = scored_rows[0]["metrics"].get("epoch") if scored_rows else None
    has_zero_based_epochs = first_row_epoch is not None and round(first_row_epoch) == 0

    def row_index_to_epoch(row_index):
        if row_index is None:
            return None
        normalized_row = max(0, round(row_index))
        return normalized_row if has_zero_based_epochs else normalized_row + 1

    final_epoch = final_metrics.get("epoch")
    if final_epoch is not None:
        final_epoch = max(0, round(final_epoch))
    epochs_trained = final_epoch + 1 if final_epoch is not None and has_zero_based_epochs else final_epoch
    if epochs_trained is None:
        epochs_trained = len(data_rows)

    selected_epoch = selected_metrics.get("epoch")
    if selected_epoch is not None:
        selected_epoch = round(selected_epoch)
    elif best_row:
        selected_epoch = row_index_to_epoch(best_row["row_index"])

    return {
        "precision": selected_metrics.get("precision"),
        "recall": selected_metrics.get("recall"),
        "map50": selected_metrics.get("map50"),
        "map5095": selected_metrics.get("map5095"),
        "boxLoss": selected_metrics.get("boxLoss"),
        "classLoss": selected_metrics.get("classLoss"),
        "bestEpoch": selected_epoch,
        "epochsTrained": epochs_trained,
        "metricSource": "best",
    }


def collect_class_ids(label_paths):
    class_ids = set()

    for label_path in label_paths:
        try:
            lines = label_path.read_text(encoding="utf-8", errors="ignore").splitlines()
        except Exception:
            continue

        for line in lines:
            parts = line.strip().split()
            if not parts:
                continue
            try:
                class_id = int(float(parts[0]))
            except (TypeError, ValueError):
                continue
            if class_id >= 0:
                class_ids.add(class_id)

    return sorted(class_ids)


def is_classes_file(entry, file_path):
    name = str(entry.get("relativePath") or entry.get("name") or file_path.name).replace("\\", "/").split("/")[-1].lower()
    return name == "classes.txt"


def collect_class_names(file_records):
    for entry in file_records:
        absolute_path = Path(str(entry.get("absolutePath", "")).strip())
        if not absolute_path.exists() or not absolute_path.is_file():
            continue
        if not is_classes_file(entry, absolute_path):
            continue

        try:
            names = [
                line.strip()
                for line in absolute_path.read_text(encoding="utf-8", errors="ignore").splitlines()
                if line.strip()
            ]
        except Exception:
            continue

        if names:
            return names

    return []


def resolve_class_names(class_ids, class_names):
    if class_names:
        return class_names

    ids = class_ids or [0]
    max_class_id = max(ids) if ids else 0
    names = [f"class_{index}" for index in range(max_class_id + 1)]

    return names


def write_classes_txt(dataset_root, names):
    classes_path = dataset_root / "classes.txt"
    classes_path.write_text("\n".join(names) + "\n", encoding="utf-8")
    return classes_path


def write_data_yaml(dataset_root, names):
    data_yaml_path = dataset_root / "data.yaml"
    lines = [
        f'path: "{dataset_root.as_posix()}"',
        "train: images/train",
        "val: images/val",
        "names:",
    ]

    for class_id, class_name in enumerate(names or ["class_0"]):
        lines.append(f"  {class_id}: {json.dumps(str(class_name))}")

    data_yaml_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return data_yaml_path


def map_files_for_training(file_records):
    images = []
    labels = []

    for entry in file_records:
        absolute_path = Path(str(entry.get("absolutePath", "")).strip())
        if not absolute_path.exists() or not absolute_path.is_file():
            continue

        suffix = absolute_path.suffix.lower()
        if suffix in IMAGE_EXTENSIONS:
            images.append((entry, absolute_path))
        elif suffix == LABEL_EXTENSION and not is_classes_file(entry, absolute_path):
            labels.append((entry, absolute_path))

    labels_by_key = {}
    labels_by_basename = {}
    for entry, label_path in labels:
        relative_key = safe_key(entry.get("relativePath") or entry.get("name") or label_path.name)
        base_key = label_path.stem.lower()
        if relative_key and relative_key not in labels_by_key:
            labels_by_key[relative_key] = label_path
        if base_key and base_key not in labels_by_basename:
            labels_by_basename[base_key] = label_path

    pairs = []
    missing_labels = 0
    for entry, image_path in images:
        image_key = safe_key(entry.get("relativePath") or entry.get("name") or image_path.name)
        label_path = labels_by_key.get(image_key)

        if label_path is None:
            label_path = labels_by_basename.get(image_path.stem.lower())

        if label_path is None:
            missing_labels += 1
            continue

        pairs.append((entry, image_path, label_path))

    return pairs, missing_labels, len(images), len(labels)


def normalize_validation_split_percent(value):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = DEFAULT_VALIDATION_SPLIT

    if not math.isfinite(parsed):
        parsed = DEFAULT_VALIDATION_SPLIT

    return max(5.0, min(50.0, parsed))


def get_pair_split_key(pair, fallback_index):
    entry, image_path, label_path = pair
    key = "|".join([
        str(entry.get("absolutePath") or image_path),
        str(entry.get("relativePath") or entry.get("name") or image_path.name),
        str(label_path),
        str(fallback_index),
    ])
    return hashlib.sha256(key.encode("utf-8", errors="ignore")).hexdigest()


def split_pairs_for_training(pairs, validation_split_percent):
    if len(pairs) <= 1:
        return pairs, pairs

    normalized_split = normalize_validation_split_percent(validation_split_percent)
    validation_count = int(round(len(pairs) * (normalized_split / 100.0)))
    validation_count = max(1, min(len(pairs) - 1, validation_count))

    ordered_pairs = [
        pair
        for _, pair in sorted(
            enumerate(pairs),
            key=lambda item: get_pair_split_key(item[1], item[0]),
        )
    ]

    validation_pairs = ordered_pairs[:validation_count]
    training_pairs = ordered_pairs[validation_count:]
    return training_pairs, validation_pairs


def copy_training_split(split_name, pairs, images_dir, labels_dir, progress_callback):
    copied_label_paths = []
    images_dir.mkdir(parents=True, exist_ok=True)
    labels_dir.mkdir(parents=True, exist_ok=True)

    for index, (_, image_path, label_path) in enumerate(pairs):
        stem = f"{index:06d}_{image_path.stem}"
        image_target = images_dir / f"{stem}{image_path.suffix.lower()}"
        label_target = labels_dir / f"{stem}.txt"
        shutil.copy2(image_path, image_target)
        shutil.copy2(label_path, label_target)
        copied_label_paths.append(label_target)
        progress_callback(split_name, index + 1)

    return copied_label_paths


def write_progress_json(progress_json_path, payload):
    if not progress_json_path:
        return

    try:
        path = Path(progress_json_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")
    except Exception:
        pass


def configure_training_console():
    try:
        import tqdm as tqdm_module
    except Exception:
        return

    original_tqdm = tqdm_module.tqdm
    if getattr(original_tqdm, "_pink_ward_ascii", False):
        return

    def pink_ward_tqdm(*args, **kwargs):
        kwargs.setdefault("ascii", True)
        return original_tqdm(*args, **kwargs)

    pink_ward_tqdm._pink_ward_ascii = True
    tqdm_module.tqdm = pink_ward_tqdm

    try:
        from ultralytics.utils.tqdm import TQDM
    except Exception:
        return

    if getattr(TQDM._generate_bar, "_pink_ward_ascii", False):
        return

    def pink_ward_generate_bar(self, width=12):
        if self.total is None:
            return "#" * width if self.closed else "-" * width

        fraction = min(1.0, self.n / self.total)
        filled = int(fraction * width)
        partial = 1 if filled < width and fraction * width - filled > 0.5 else 0
        empty = max(0, width - filled - partial)
        return "#" * filled + (">" if partial else "") + "-" * empty

    pink_ward_generate_bar._pink_ward_ascii = True
    TQDM._generate_bar = pink_ward_generate_bar


def train_from_payload(payload, progress_json_path=None):
    configure_training_console()
    from ultralytics import YOLO

    run_id = str(payload.get("runId", "")).strip()
    model_name = str(payload.get("model", "")).strip()
    model_display_name = str(payload.get("modelName", "")).strip()
    run_name = str(payload.get("runName", "training-run")).strip() or "training-run"
    dataset_root = Path(str(payload.get("datasetRoot", "")).strip()).resolve()
    output_root = Path(str(payload.get("outputRoot", "")).strip()).resolve()
    file_records = payload.get("files", [])
    hyperparams = payload.get("hyperparams", {}) if isinstance(payload.get("hyperparams"), dict) else {}

    if not model_name:
        raise ValueError("Model path or model name is required.")
    if not file_records:
        raise ValueError("No training files were provided.")

    total_epochs = max(1, int(hyperparams.get("epochs", 100)))
    validation_split_percent = normalize_validation_split_percent(hyperparams.get("validationSplit", DEFAULT_VALIDATION_SPLIT))

    def publish_progress(progress, status, **extra):
        write_progress_json(progress_json_path, {
            "event": "progress",
            "runId": run_id,
            "progress": max(0.0, min(float(progress), 1.0)),
            "status": status,
            **extra,
        })

    publish_progress(0.01, "Preparing training data...", epoch=0, totalEpochs=total_epochs)

    dataset_train_images_dir = dataset_root / "images" / "train"
    dataset_val_images_dir = dataset_root / "images" / "val"
    dataset_train_labels_dir = dataset_root / "labels" / "train"
    dataset_val_labels_dir = dataset_root / "labels" / "val"
    output_root.mkdir(parents=True, exist_ok=True)

    pairs, missing_labels, total_images, total_labels = map_files_for_training(file_records)
    if not pairs:
        raise ValueError("No valid image-label pairs were found in the selected training data.")

    training_pairs, validation_pairs = split_pairs_for_training(pairs, validation_split_percent)
    copy_total = len(training_pairs) + len(validation_pairs)
    copied_samples = 0

    def publish_copy_progress(split_name, split_count):
        nonlocal copied_samples
        copied_samples += 1
        if copied_samples == copy_total or copied_samples % max(1, copy_total // 20) == 0:
            publish_progress(
                0.01 + min((copied_samples / copy_total) * 0.03, 0.03),
                f"Preparing {split_name} split... {copied_samples}/{copy_total} samples",
                epoch=0,
                totalEpochs=total_epochs,
                validationSplit=validation_split_percent,
            )

    copied_label_paths = []
    copied_label_paths.extend(copy_training_split(
        "training",
        training_pairs,
        dataset_train_images_dir,
        dataset_train_labels_dir,
        publish_copy_progress,
    ))
    copied_label_paths.extend(copy_training_split(
        "validation",
        validation_pairs,
        dataset_val_images_dir,
        dataset_val_labels_dir,
        publish_copy_progress,
    ))

    class_ids = collect_class_ids(copied_label_paths)
    class_names = resolve_class_names(class_ids, collect_class_names(file_records))
    write_classes_txt(dataset_root, class_names)
    data_yaml_path = write_data_yaml(dataset_root, class_names)
    publish_progress(
        0.04,
        f"Starting YOLO training with {len(training_pairs)} train / {len(validation_pairs)} validation samples...",
        epoch=0,
        totalEpochs=total_epochs,
        validationSplit=validation_split_percent,
    )

    train_kwargs = {
        "data": str(data_yaml_path),
        "epochs": total_epochs,
        "imgsz": int(hyperparams.get("imgsz", 640)),
        "workers": int(hyperparams.get("workers", 8)),
        "batch": int(hyperparams.get("batch", 16)),
        "project": str(output_root),
        "name": run_name,
    }

    lr0 = hyperparams.get("lr0", None)
    if lr0 is not None:
        train_kwargs["lr0"] = float(lr0)

    advanced = hyperparams.get("advanced", {})
    if isinstance(advanced, dict):
        for key, value in advanced.items():
            if value is None:
                continue
            train_kwargs[str(key)] = value

    def epoch_progress(epoch):
        return 0.04 + (min(max(epoch, 0), total_epochs) / total_epochs) * 0.95

    def on_train_start(_trainer):
        publish_progress(0.04, f"Training epoch 0/{total_epochs}", epoch=0, totalEpochs=total_epochs)

    def on_train_epoch_end(trainer):
        epoch = min(max(int(getattr(trainer, "epoch", 0)) + 1, 1), total_epochs)
        publish_progress(
            epoch_progress(epoch),
            f"Training epoch {epoch}/{total_epochs}",
            epoch=epoch,
            totalEpochs=total_epochs,
        )

    def on_train_end(_trainer):
        publish_progress(1, "Training complete.", epoch=total_epochs, totalEpochs=total_epochs)

    model = YOLO(model_name)
    try:
        model.add_callback("on_train_start", on_train_start)
        model.add_callback("on_train_epoch_end", on_train_epoch_end)
        model.add_callback("on_train_end", on_train_end)
    except Exception:
        pass

    results = model.train(**train_kwargs)
    publish_progress(1, "Training complete.", epoch=total_epochs, totalEpochs=total_epochs)
    save_dir = Path(getattr(results, "save_dir", output_root / run_name))
    weights_dir = save_dir / "weights"
    best_model_path = weights_dir / "best.pt"
    last_model_path = weights_dir / "last.pt"
    results_csv_path = save_dir / "results.csv"
    if not results_csv_path.exists():
        candidates = sorted(
            output_root.rglob("results.csv"),
            key=lambda candidate: candidate.stat().st_mtime,
            reverse=True,
        )
        if candidates:
            results_csv_path = candidates[0]

    return {
        "ok": True,
        "model": model_name,
        "modelName": model_display_name,
        "runName": run_name,
        "saveDir": str(save_dir),
        "bestModelPath": str(best_model_path) if best_model_path.exists() else "",
        "lastModelPath": str(last_model_path) if last_model_path.exists() else "",
        "resultsCsvPath": str(results_csv_path) if results_csv_path.exists() else "",
        "resultsMetrics": parse_results_csv(results_csv_path) if results_csv_path.exists() else None,
        "pairedSamples": len(pairs),
        "trainSamples": len(training_pairs),
        "valSamples": len(validation_pairs),
        "validationSplit": validation_split_percent,
        "totalImages": total_images,
        "totalLabels": total_labels,
        "missingLabels": missing_labels,
        "classCount": len(class_names) if class_names else 1,
    }


def write_result_json(result_json_path, result):
    if not result_json_path:
        return

    try:
        path = Path(result_json_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(result), encoding="utf-8")
    except Exception:
        pass


def main():
    parser = build_parser()
    args = parser.parse_args()
    result_json_path = Path(args.result_json).expanduser().resolve() if args.result_json else None
    progress_json_path = Path(args.progress_json).expanduser().resolve() if args.progress_json else None

    try:
        payload_path = Path(args.payload_json).expanduser().resolve()
        payload = json.loads(payload_path.read_text(encoding="utf-8"))
        result = train_from_payload(payload, progress_json_path)
        print(json.dumps(result))
        write_result_json(result_json_path, result)
    except Exception as error:
        result = {"ok": False, "error": str(error)}
        print(json.dumps(result))
        write_result_json(result_json_path, result)
        write_progress_json(progress_json_path, {
            "event": "progress",
            "progress": 0,
            "status": str(error),
            "error": str(error),
        })
        sys.exit(1)


if __name__ == "__main__":
    main()
