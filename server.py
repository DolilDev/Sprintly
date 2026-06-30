"""
CAM RUNNER - backend serwera
-----------------------------
Przechwytuje obraz z kamery, wykonuje:
  - detekcję pozy (MediaPipe Pose)
  - segmentację tła (MediaPipe Selfie Segmentation)
i strumieniuje wyniki przez WebSocket (Flask-SocketIO).
"""

import base64
import time
import threading

import cv2
import numpy as np
import mediapipe as mp
from flask import Flask, render_template, jsonify
from flask_socketio import SocketIO

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["SECRET_KEY"] = "cam-runner-secret"
socketio = SocketIO(app, cors_allowed_origins="*")

mp_pose = mp.solutions.pose
mp_selfie = mp.solutions.selfie_segmentation

pose = mp_pose.Pose(
    model_complexity=0,
    smooth_landmarks=True,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5,
)
segmenter = mp_selfie.SelfieSegmentation(model_selection=1)

FRAME_W, FRAME_H = 640, 480

camera_index = 0
camera_lock = threading.Lock()
camera_running = False

# ---------- stan kalibracji / wygładzania pozycji ----------
state = {
    "base_shoulder_x": None,
    "base_hip_y": None,
    "shoulder_x_ema": 0.5,
    "hip_y_ema": 0.5,
    "knee_history": [],
    "last_jump_time": 0.0,
}


def reset_calibration():
    state["base_shoulder_x"] = None
    state["base_hip_y"] = None
    state["knee_history"] = []


def list_cameras():
    """Zwraca listę dostępnych kamer jako [{index, name}]."""
    available = []
    for i in range(8):
        cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)
        if cap.isOpened():
            available.append({"index": i, "name": f"Kamera {i}"})
            cap.release()
    return available


def analyze_pose(landmarks):
    ls, rs = landmarks[11], landmarks[12]
    lh, rh = landmarks[23], landmarks[24]
    lk, rk = landmarks[25], landmarks[26]

    shoulder_x = (ls.x + rs.x) / 2
    hip_y = (lh.y + rh.y) / 2
    shoulder_y = (ls.y + rs.y) / 2
    knee_y = (lk.y + rk.y) / 2

    if state["base_shoulder_x"] is None:
        state["base_shoulder_x"] = shoulder_x
    if state["base_hip_y"] is None:
        state["base_hip_y"] = hip_y

    state["shoulder_x_ema"] = state["shoulder_x_ema"] * 0.7 + shoulder_x * 0.3
    state["hip_y_ema"] = state["hip_y_ema"] * 0.7 + hip_y * 0.3

    dx = state["shoulder_x_ema"] - state["base_shoulder_x"]
    lane = 0
    if dx > 0.09:
        lane = 1
    elif dx < -0.09:
        lane = -1

    torso_h = max(0.05, hip_y - shoulder_y)
    crouching = (state["hip_y_ema"] - state["base_hip_y"]) > torso_h * 0.35

    hip_vel = state["base_hip_y"] - hip_y
    now = time.time()
    jump = False
    if hip_vel > 0.07 and (now - state["last_jump_time"]) > 0.6:
        jump = True
        state["last_jump_time"] = now

    state["knee_history"].append(knee_y)
    if len(state["knee_history"]) > 10:
        state["knee_history"].pop(0)
    amplitude = max(state["knee_history"]) - min(state["knee_history"])
    running = amplitude > 0.02

    return {
        "lane": lane,
        "crouching": bool(crouching),
        "jump": bool(jump),
        "running": bool(running),
    }


def cutout_person(frame_bgr, seg_result):
    mask = seg_result.segmentation_mask
    condition = mask > 0.5
    bgra = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2BGRA)
    bgra[:, :, 3] = (condition * 255).astype(np.uint8)
    return bgra


def encode_png_base64(bgra_image):
    success, buf = cv2.imencode(".png", bgra_image)
    if not success:
        return None
    return base64.b64encode(buf).decode("utf-8")


def camera_loop():
    global camera_running
    with camera_lock:
        cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_W)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_H)

    if not cap.isOpened():
        socketio.emit("error", {"msg": f"Nie można otworzyć kamery {camera_index}"})
        camera_running = False
        return

    print(f"Kamera {camera_index} uruchomiona. Stream startuje...")
    camera_running = True

    while camera_running:
        ok, frame = cap.read()
        if not ok:
            socketio.sleep(0.05)
            continue

        frame = cv2.flip(frame, 1)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        pose_result = pose.process(rgb)
        seg_result = segmenter.process(rgb)

        gesture = {"lane": 0, "crouching": False, "jump": False, "running": False}
        if pose_result.pose_landmarks:
            gesture = analyze_pose(pose_result.pose_landmarks.landmark)

        cutout_b64 = None
        if seg_result.segmentation_mask is not None:
            bgra = cutout_person(frame, seg_result)
            cutout_b64 = encode_png_base64(bgra)

        socketio.emit("frame_update", {"gesture": gesture, "cutout": cutout_b64})
        socketio.sleep(0.03)

    cap.release()
    camera_running = False
    print(f"Kamera {camera_index} zatrzymana.")


# ---------- Endpointy ----------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/cameras")
def api_cameras():
    return jsonify(list_cameras())


@socketio.on("connect")
def on_connect():
    print("Klient połączony.")
    reset_calibration()


@socketio.on("recalibrate")
def on_recalibrate():
    reset_calibration()


@socketio.on("start_camera")
def on_start_camera(data):
    global camera_index, camera_running
    idx = int(data.get("index", 0))
    camera_index = idx
    reset_calibration()
    if not camera_running:
        socketio.start_background_task(camera_loop)
    else:
        # zatrzymaj starą pętlę i poczekaj chwilę, potem uruchom nową
        camera_running = False
        socketio.sleep(0.3)
        socketio.start_background_task(camera_loop)


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=False)
