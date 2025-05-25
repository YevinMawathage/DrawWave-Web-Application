from PyQt5.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QSpacerItem, QSizePolicy, QFileDialog, QColorDialog
from PyQt5.QtGui import QImage, QPixmap, QFont
from PyQt5.QtCore import QTimer, Qt
import cv2
from canvas import Canvas
from canvas_widget import CanvasWidget
from hand_tracking import HandTracker

class VirtualPainterGUI(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("AI Virtual Painter - Drawing Mode")
        self.setGeometry(100, 100, 1280, 720)
        self.setStyleSheet("""
            QWidget {
                background: qlineargradient(
                    x1:0 y1:0, x2:1 y2:1,
                    stop:0 #f8fafc, stop:1 #dbeafe
                );
            }
        """)
        
        def find_available_camera(max_index=4):
            for idx in range(max_index + 1):
                cap = cv2.VideoCapture(idx)
                if cap.isOpened():
                    cap.release()
                    return idx
            return None
        
        camera_index = find_available_camera()
        if camera_index is not None:
            self.capture = cv2.VideoCapture(camera_index)
        else:
            self.capture = None
            print("No camera found.")
        
        self.color_preview = QLabel()
        self.color_preview.setFixedSize(32, 32)
        self.color_preview.setStyleSheet("""
            QLabel {
                background-color: black;
                border-radius: 16px;
                border: 2px solid #c7d2fe;
            }
        """)    
 
        # Initialize components
        self.hand_tracker = HandTracker()
        self.canvas = Canvas()
        self.mode = "gesture"
        
        # Initialize cursor position for tracking
        self.cursor_x = 0
        self.cursor_y = 0
        self.cursor_visible = False
        self.cursor_mode = "IDLE"
        
        # Main layout
        main_layout = QVBoxLayout()
        main_layout.setContentsMargins(20, 20, 20, 20)
        main_layout.setSpacing(20)
        
        # Top section: Camera and Canvas
        top_section = QHBoxLayout()
        top_section.setSpacing(20)
        
        # Camera feed with styled frame
        self.camera_feed_label = QLabel(self)
        self.camera_feed_label.setFixedSize(640, 480)
        self.camera_feed_label.setStyleSheet("""
            QLabel {
                background: #ffffff;
                border-radius: 10px;
                border: 2px solid #c7d2fe;
            }
        """)
        top_section.addWidget(self.camera_feed_label)
        
        # Canvas widget with styled frame
        self.canvas_widget = CanvasWidget(self.canvas)
        self.canvas_widget.setFixedSize(640, 480)
        self.canvas_widget.setStyleSheet("""
            QWidget {
                background: #ffffff;
                border-radius: 10px;
                border: 2px solid #c7d2fe;
            }
        """)
        top_section.addWidget(self.canvas_widget)
        
        main_layout.addLayout(top_section)
        
        # Bottom control panel
        control_panel = QHBoxLayout()
        control_panel.setContentsMargins(0, 10, 0, 0)
        control_panel.setSpacing(20)
        
        # Mode buttons
        self.mouse_btn = QPushButton("Mouse Drawing")
        self.gesture_btn = QPushButton("Gesture Drawing")
        self.back_btn = QPushButton("Back to Start")
        
        self.clear_btn = QPushButton("Clear Canvas")
        self.save_btn = QPushButton("Save Drawing")
        self.color_btn = QPushButton("Color Picker")
        
        # Style buttons to match start screen
        button_style = """
            QPushButton {
                background-color: #6366f1;
                color: white;
                border-radius: 24px;
                padding: 12px 24px;
                font-size: 14px;
                min-width: 120px;
            }
            QPushButton:hover {
                background-color: #818cf8;
            }
            QPushButton:pressed {
                background-color: #4f46e5;
            }
        """
        
        for btn in [self.mouse_btn, self.gesture_btn, self.back_btn, 
                   self.clear_btn, self.save_btn, self.color_btn]:
            btn.setStyleSheet(button_style)
            btn.setFont(QFont("Segoe UI", 12, QFont.Bold))
            btn.setCursor(Qt.PointingHandCursor)
        
        # Add stretch to center buttons
        control_panel.addStretch()
        control_panel.addWidget(self.mouse_btn)
        control_panel.addWidget(self.gesture_btn)
        control_panel.addWidget(self.clear_btn)
        control_panel.addWidget(self.save_btn)
        control_panel.addWidget(self.color_btn)
        control_panel.addWidget(self.color_preview)
        control_panel.addWidget(self.back_btn)
        control_panel.addStretch()
        
        main_layout.addLayout(control_panel)
        
     
        self.setLayout(main_layout)
        
    
        self.mouse_btn.clicked.connect(self.enable_mouse_mode)
        self.gesture_btn.clicked.connect(self.enable_gesture_mode)
        self.clear_btn.clicked.connect(self.clear_canvas)
        self.save_btn.clicked.connect(self.save_canvas)
        self.color_btn.clicked.connect(self.pick_color)
        self.back_btn.clicked.connect(self.back_button_click)
        
        
        
        
        
        
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.update_camera_feed)
        self.timer.start(40)
    
  
    def update_camera_feed(self):
        if self.mode != "gesture":
            return  
        
        if not self.capture or not self.capture.isOpened():
            return
        
        ret, frame = self.capture.read()
        if not ret:
            print("❌ Could not access the webcam.")
            return
        
        frame = cv2.flip(frame, 1)  
        frame, result = self.hand_tracker.detect_hands(frame)

       
        if result.multi_hand_landmarks:
            landmarks = result.multi_hand_landmarks[0]
            gesture = self.hand_tracker.recognize_gesture(landmarks)
            
           
            index_tip = landmarks.landmark[8]
            
           
            self.cursor_x = int(index_tip.x * self.canvas.width)
            self.cursor_y = int(index_tip.y * self.canvas.height)
            self.cursor_visible = True
            
            
            if gesture == "drawing":
                self.cursor_mode = "DRAW"
            elif gesture == "erase":
                self.cursor_mode = "ERASE"
            elif gesture == "clear":
                self.cursor_mode = "CLEAR"
            else:
                self.cursor_mode = "IDLE"
            
        
            print(f"Cursor position: ({self.cursor_x}, {self.cursor_y}) Mode: {self.cursor_mode}")
            
         
            self.handle_gesture(gesture, landmarks)
        else:
           
            self.cursor_visible = False
        
        
        self.canvas_widget.set_cursor(self.cursor_x, self.cursor_y, self.cursor_visible, self.cursor_mode)
        
 
        self.canvas_widget.update()

        
        height, width, channel = frame.shape
        bytes_per_line = 3 * width
        q_img = QImage(frame.data, width, height, bytes_per_line, QImage.Format_BGR888)
        pixmap = QPixmap.fromImage(q_img)
        self.camera_feed_label.setPixmap(pixmap)
            
            
            
            

    def handle_gesture(self, gesture, landmarks, smoothed_tip=None):
        index_tip = landmarks.landmark[8]

        if gesture == "drawing":
           
            self.canvas.draw((index_tip.x, index_tip.y))

        elif gesture == "erase":
            
            middle_tip = landmarks.landmark[12]
            midpoint = ((index_tip.x + middle_tip.x) / 2, (index_tip.y + middle_tip.y) / 2)
            self.canvas.erase(midpoint)

        elif gesture == "idle":
            self.canvas.reset_previous_points()
            

        
    def back_button_click(self):
        self.close()  
        from start_screen import StartScreen
        self.start_screen = StartScreen() 
        self.start_screen.show()


    def enable_mouse_mode(self):
        self.mode = "mouse"
        self.capture.release()  
        print("[MODE] Mouse Drawing Enabled")

    def enable_gesture_mode(self):
        self.mode = "gesture"
        self.capture = cv2.VideoCapture(0) 
        print("[MODE] Gesture Drawing Enabled")

    def clear_canvas(self):
        self.canvas.clear()
        self.canvas_widget.update()

    def save_canvas(self):
        options = QFileDialog.Options()
        fileName, _ = QFileDialog.getSaveFileName(
            self, 
            "Save Drawing", 
            "", 
            "PNG Files (*.png)", 
            options=options
        )
        if fileName:
            if not fileName.endswith('.png'):
                fileName += '.png'
            self.canvas.save(fileName)

    def pick_color(self):
        """Handle color selection with preview"""
        color = QColorDialog.getColor()
        if color.isValid():
            
            r, g, b = color.red(), color.green(), color.blue()
            self.canvas.change_color((b, g, r))
            
           
            self.color_preview.setStyleSheet(f"""
                QLabel {{
                    background-color: {color.name()};
                    border-radius: 16px;
                    border: 2px solid #c7d2fe;
                }}
            """)
            
           

            
            
            
            
            
            
            
            
            