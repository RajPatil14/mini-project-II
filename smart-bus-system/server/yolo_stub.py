import cv2
import numpy as np
from ultralytics import YOLO
import sys
import os
import json


# Load YOLO model - try medium model for better accuracy, fallback to small
model_paths = [
    os.path.join(os.path.dirname(__file__), '..', 'yolov8m.pt'),  # medium model (better accuracy)
    os.path.join(os.path.dirname(__file__), '..', 'yolov8l.pt'),  # large model (best accuracy)
    os.path.join(os.path.dirname(__file__), '..', 'yolov8s.pt'),  # small model (fallback)
]

model = None
for model_path in model_paths:
    if os.path.exists(model_path):
        try:
            model = YOLO(model_path)
            print(f"Loaded model: {os.path.basename(model_path)}", file=sys.stderr)
            break
        except Exception as e:
            print(f"Failed to load {model_path}: {e}", file=sys.stderr)
            continue

if model is None:
    print("ERROR: No YOLO model found!", file=sys.stderr)
    sys.exit(1)

def count_persons(img, conf_threshold=0.72, min_area=500, nms_threshold=0.5, crowded=False):
    """Count ONLY persons (cls=0) in image using YOLOv8 with filters tuned for crowded scenes."""

    if img is None:
        return 0

    # Preprocessing for better detection
    # Convert to grayscale and back to RGB for contrast enhancement
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Apply CLAHE (Contrast Limited Adaptive Histogram Equalization)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    gray = clahe.apply(gray)
    # Convert back to BGR
    img_enhanced = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)

    # Resize image to standard size for consistent detection
    img_resized = cv2.resize(img_enhanced, (640, 640))

    # Run YOLO with tuned parameters for crowded scenes
    results = model(img_resized, verbose=False, conf=conf_threshold, iou=nms_threshold)

    count = 0
    # Keep only strong, distinct person boxes
    valid_detections = []


    for r in results:
        if r.boxes is not None:
            for box in r.boxes:
                if int(box.cls[0]) == 0:  # person class only
                    # Get confidence and box coordinates
                    conf = float(box.conf[0])
                    x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()

                    # Calculate box area to filter small/noisy detections
                    area = (x2 - x1) * (y2 - y1)

                    # Additional filters for accuracy
                    width = x2 - x1
                    height = y2 - y1
                    aspect_ratio = width / height if height > 0 else 0

                    # Person-only strict criteria (reduce false positives)
                    # - area threshold (reduces tiny blobs)
                    # - confidence threshold
                    # - human aspect range (tolerant for camera angle)
                    if (area >= min_area and
                        0.25 <= aspect_ratio <= 4.0 and
                        width >= 18 and height >= 42 and
                        conf >= conf_threshold):


                        # Check if this detection overlaps significantly with previous ones
                        overlap = False
                        for vx1, vy1, vx2, vy2 in valid_detections:
                            # Calculate IoU (Intersection over Union)
                            ix1 = max(x1, vx1)
                            iy1 = max(y1, vy1)
                            ix2 = min(x2, vx2)
                            iy2 = min(y2, vy2)

                            if ix2 > ix1 and iy2 > iy1:
                                intersection = (ix2 - ix1) * (iy2 - iy1)
                                union = area + (vx2 - vx1) * (vy2 - vy1) - intersection
                                iou = intersection / union if union > 0 else 0
                                if iou > 0.5:  # stricter duplicate suppression

                                    overlap = True
                                    break

                        if not overlap:
                            valid_detections.append((x1, y1, x2, y2))
                            count += 1

    return count

def main():
    if len(sys.argv) != 5:
        print(json.dumps({"counts": [], "final": 0}))
        return

    image_paths = sys.argv[1:5]
    print(f"Processing files: {len([p for p in image_paths if os.path.exists(p)])}", file=sys.stderr)

    counts = []

    for img_path in image_paths:
        if not os.path.exists(img_path):
            print(f"Missing: {img_path}", file=sys.stderr)
            counts.append(0)
            continue

        with open(img_path, 'rb') as f:
            img_bytes = f.read()
        np_arr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        if img is None:
            print(f"Decode failed: {img_path}", file=sys.stderr)
            counts.append(0)
            continue

        count = count_persons(img, conf_threshold=0.72, min_area=500, nms_threshold=0.5)

        print(f"Detected in {os.path.basename(img_path)}: {count}", file=sys.stderr)
        counts.append(int(count))

    # Robust aggregation: median avoids outlier false positives.
    sorted_counts = sorted(counts)
    n = len(sorted_counts)
    if n == 0:
        final = 0
    else:
        mid = n // 2
        if n % 2 == 1:
            final = sorted_counts[mid]
        else:
            final = int(round((sorted_counts[mid - 1] + sorted_counts[mid]) / 2.0))

    print(f"COUNTS: {counts} FINAL(MEDIAN): {final}", file=sys.stderr)
    print(json.dumps({"counts": counts, "final": final}))

if __name__ == '__main__':
    main()

