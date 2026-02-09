import cv2

cap = cv2.VideoCapture(1)

if not cap.isOpened():
    print("Error al abrir la cámara")
    exit(-1)

cap.set(cv2.CAP_PROP_FRAME_WIDTH, 2560)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

while True:
    ret, frame = cap.read()
    if ret:
        left = frame[:, :1280]
        cv2.imshow("ZED 2i - Left", left)
        if cv2.waitKey(30) & 0xFF == ord("q"):
            break

cap.release()
cv2.destroyAllWindows()
