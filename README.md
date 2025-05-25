# DrawWave - AI Virtual Painter with Web Interface

This project allows you to draw on a virtual canvas using hand gestures. The frontend captures webcam video and sends it to a Python backend, which processes the hand gestures and updates the canvas accordingly.

![DrawWave Application](DrawWave%20-%20Poster%20-%2010898817.jpg)

## Project Structure

- `frontend/`: React web application for video capture and canvas display
- `python/`: Python backend for hand tracking and gesture recognition

## Requirements

### Frontend
- Node.js (v18 or higher recommended)
- pnpm or npm

### Backend
- Python 3.8+
- OpenCV
- MediaPipe
- WebSockets
- Other dependencies listed in `python/requirements.txt`

## Setup and Installation

### Backend Setup

1. Navigate to the python directory:
   ```
   cd python
   ```

2. Install the required Python packages:
   ```
   pip install -r requirements.txt
   ```

3. Start the WebSocket server:
   ```
   python web_main.py
   ```

### Frontend Setup

1. Navigate to the frontend directory:
   ```
   cd frontend
   ```

2. Install dependencies:
   ```
   pnpm install
   ```
   or
   ```
   npm install
   ```

3. Start the development server:
   ```
   pnpm dev
   ```
   or
   ```
   npm run dev
   ```

4. Open your browser and navigate to `http://localhost:5173`

## Usage

1. Ensure both the Python backend and React frontend are running
2. Allow camera access when prompted by your browser
3. Use hand gestures to draw on the canvas:
   - ✏️ **Draw**: Extend only your index finger
   - 🧽 **Erase**: Extend your index and middle fingers
   - ✋ **Stop Drawing**: Show all five fingers

## Gestures

The application uses the following hand gestures:

- **Drawing mode**: Only index finger extended
- **Eraser mode**: Index and middle fingers extended
- **Idle mode**: All fingers extended

## Troubleshooting

- If the connection fails, ensure the Python backend is running
- Check browser console for any errors
- Make sure your camera is accessible and working 