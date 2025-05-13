import cv2
import numpy as np
from PIL import Image

class Canvas:
    def __init__(self, width=640, height=480):
        self.width = width
        self.height = height
        self.canvas = np.ones((height, width, 3), dtype=np.uint8) * 255
        self.previous_point_gesture = None
        self.previous_point_erase = None
        self.brush_size = 10
        self.color = (0, 0, 0)
        self.history = []
        self.redo_stack = []
        self.cursor_position = (0, 0)
        self.history_limit = 50  # Added limit to history stack
        
        
    def set_cursor_position(self, x, y):
        self.cursor_position = (int(x * self.width), int(y * self.height))

    def draw_cursor(self):
        cursor_radius = 5
        temp_canvas = self.canvas.copy()  # Draw cursor on a temporary copy
        cv2.circle(temp_canvas, self.cursor_position, cursor_radius, (255, 0, 0), -1)
        return temp_canvas  # Return for display without saving to history



    def draw(self, current_point):
        current_point = (int(current_point[0] * self.width), int(current_point[1] * self.height))

        if self.previous_point_gesture is None:
            self.previous_point_gesture = current_point
            return  # Don't draw on the first point
            
        # Only draw if movement is significant
        if self.previous_point_gesture != current_point:
            cv2.line(self.canvas, self.previous_point_gesture, current_point, self.color, self.brush_size)
            self.previous_point_gesture = current_point

            if not self.history or not np.array_equal(self.history[-1], self.canvas):
                self.history.append(self.canvas.copy())
                self.redo_stack.clear()





    def erase(self, current_point):
        current_point = (int(current_point[0] * self.width), int(current_point[1] * self.height))

        if self.previous_point_erase is None:
            self.previous_point_erase = current_point

        cv2.line(self.canvas, self.previous_point_erase, current_point, (255, 255, 255), self.brush_size + 10)

        self.previous_point_erase = current_point
        if not self.history or not np.array_equal(self.history[-1], self.canvas):
            self.history.append(self.canvas.copy())
            self.redo_stack.clear()
                    
        self.redo_stack.clear()
        
        
        


    def reset_previous_points(self):
        self.previous_point_gesture = None
        self.previous_point_erase = None

    def change_color(self, new_color):
        self.color = tuple(new_color[:3])

    def change_brush_size(self, new_size):
        self.brush_size = new_size

    def save(self, file_path):
        image = Image.fromarray(self.canvas)
        image.save(file_path)

        
    def clear(self):
        self.canvas = np.ones((self.height, self.width, 3), dtype=np.uint8) * 255
        self.history = []
        self.redo_stack = []
        self.reset_previous_points()
        
    def save(self, file_path):
        try:
            image = Image.fromarray(self.canvas)
            image.save(file_path)
            return True
        except Exception as e:
            print(f"Error saving image: {e}")
            return False

    def get_canvas(self):
        return self.canvas
        
    def draw_line(self, start_point, end_point, color=None):
        """
        Draw a line directly between two points with specified coordinates.
        This is used for mouse drawing where we have exact pixel positions.
        
        Args:
            start_point: Tuple of (x, y) coordinates for the start of the line
            end_point: Tuple of (x, y) coordinates for the end of the line
            color: Optional BGR color tuple. If None, uses the current color
        """
        if color is None:
            color = self.color
            
        # Make sure points are within canvas bounds
        x1, y1 = start_point
        x2, y2 = end_point
        
        x1 = max(0, min(int(x1), self.width-1))
        y1 = max(0, min(int(y1), self.height-1))
        x2 = max(0, min(int(x2), self.width-1))
        y2 = max(0, min(int(y2), self.height-1))
        
        # Draw the line
        cv2.line(self.canvas, (x1, y1), (x2, y2), color, self.brush_size)
        
        # Add to history if changed
        if not self.history or not np.array_equal(self.history[-1], self.canvas):
            self.history.append(self.canvas.copy())
            if len(self.history) > self.history_limit:
                self.history.pop(0)  # Remove oldest item if we exceed limit
            self.redo_stack.clear()
