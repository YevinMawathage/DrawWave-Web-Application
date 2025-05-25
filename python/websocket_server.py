import asyncio
import websockets
import json
import base64
import cv2
import numpy as np
import uuid
from hand_tracking import HandTracker
from canvas import Canvas
import threading
import io
from PIL import Image
from session_db import SessionDB

class WebSocketServer:
    def __init__(self, host="0.0.0.0", port=8765):
        self.host = host
        self.port = port
        self.sessions = {} 
        self.client_sessions = {}  
        self.hand_tracker = HandTracker()
        self.lock = threading.Lock()
        self.session_db = SessionDB()  
        
        

    def create_session(self):
        """Create a new session and return the session ID"""
        session_id = str(uuid.uuid4())[:8] 
        self.sessions[session_id] = {
            "canvas": Canvas(),
            "clients": set(),
            "lock": threading.Lock()
        }
        return session_id

    async def restore_sessions_from_db(self):
        """Restore active sessions from MongoDB on server start"""
        try:
            all_sessions = self.session_db.get_all_active_sessions()
            if all_sessions and isinstance(all_sessions, list):
                print(f"Restoring {len(all_sessions)} sessions from MongoDB")
                for session in all_sessions:
                    session_id = session.get('sessionId')
                    room_id = session.get('roomId')
                    if session_id and session_id not in self.sessions:
                        self.sessions[session_id] = {
                            "canvas": Canvas(),
                            "room_id": room_id,
                            "clients": set(),
                            "lock": threading.Lock()
                        }
                        
                        if session.get('canvasData'):
                            try:
                                canvas_data = f"data:image/png;base64,{session.get('canvasData')}"
                                # TODO: 
                            except Exception as e:
                                print(f"Error restoring canvas for session {session_id}: {e}")
                                
                        print(f"Restored session {session_id} with room {room_id}")
        except Exception as e:
            print(f"Error restoring sessions from DB: {e}")

    async def broadcast_to_session(self, session_id, message, exclude=None):
        """Broadcast a message to all clients in a session except the excluded one"""
        if session_id not in self.sessions:
            return

        for client in self.sessions[session_id]["clients"]:
            if client != exclude:
                try:
                    await client.send(message)
                except Exception as e:
                    print(f"Error sending message to client: {str(e)}")
                    pass

    async def handle_client(self, websocket):
        session_id = None
        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    message_type = data.get("type")
                    
                    if websocket in self.client_sessions:
                        session_id = self.client_sessions[websocket]

                    if message_type == "create_session":
                        try:
                            user_name = data.get("user_name")
                            room_id = data.get("room_id")
                            session_id = data.get("session_id")
                            
                            if not user_name or not room_id or not session_id:
                                print(f"Error: Missing required fields for create_session: user_name={user_name}, room_id={room_id}, session_id={session_id}")
                                await websocket.send(json.dumps({
                                    "type": "error",
                                    "success": False,
                                    "message": "Missing required fields for session creation. Please try again."
                                }))
                                continue
    
                            if session_id not in self.sessions:
                                self.sessions[session_id] = {
                                    "canvas": Canvas(),
                                    "room_id": room_id,
                                    "clients": set(),
                                    "lock": threading.Lock()
                                }
                                print(f"Created new session in memory: {session_id} with room {room_id}")
                            else:
                                print(f"Session {session_id} already exists in memory, using existing session")
                            
                            self.sessions[session_id]["clients"].add(websocket)
                            self.client_sessions[websocket] = session_id
    
                            user_created, user_info = self.session_db.create_user(user_name, session_id, room_id)
                            
                            if not user_created:
                                print(f"Warning: Failed to create user in database, but proceeding with in-memory session")

                            try:
                                session_info = self.session_db.get_session(session_id)
                                participant_count = 1  # Default to 1
                                if session_info and "participants" in session_info:
                                    participant_count = session_info["participants"]
                            except Exception as e:
                                print(f"Error getting session info from database: {e}")

                            canvas_base64 = ""
                            try:
                                with self.sessions[session_id]["lock"]:
                                    canvas_image = self.sessions[session_id]["canvas"].get_canvas()
                                    _, buffer = cv2.imencode('.png', canvas_image)
                                    canvas_base64 = base64.b64encode(buffer).decode('utf-8')
                            except Exception as e:
                                print(f"Error getting canvas state: {e}")

                            await websocket.send(json.dumps({
                                "type": "session_created",
                                "session_id": session_id,
                                "room_id": room_id,
                                "canvas": f"data:image/png;base64,{canvas_base64}" if canvas_base64 else None,
                                "participants": len(self.sessions[session_id]["clients"]),
                                "success": True,
                                "message": "Successfully created session"
                            }))
                            
                            print(f"Successfully created session {session_id} with room {room_id}")
                            
                            await self.broadcast_to_session(session_id, json.dumps({
                                "type": "participant_joined",
                                "participants": len(self.sessions[session_id]["clients"])
                            }), exclude=websocket)
                            continue
                            
                        except Exception as e:
                            print(f"Error during session creation: {e}")
                            import traceback
                            traceback.print_exc()
                            
                            try:
                                await websocket.send(json.dumps({
                                    "type": "error",
                                    "success": False,
                                    "message": f"Failed to create session: {str(e)}"
                                }))
                            except:
                                pass
                            continue

                    elif message_type == "join_session":
                        requested_session_id = data.get("session_id")
                        user_name = data.get("user_name")
                        
                        if requested_session_id in self.sessions:
                            session_id = requested_session_id
                            room_id = self.sessions[session_id].get("room_id")
                            print(f"Session {session_id} found in memory with room {room_id}")
                        else:
                            mongo_session = self.session_db.get_session(requested_session_id)
                            if mongo_session:
                                session_id = requested_session_id
                                room_id = mongo_session.get("roomId")
                                
                                print(f"Session {session_id} found in MongoDB with room {room_id}, restoring")
                                
                                canvas = Canvas()
                                
                                if mongo_session.get("canvasData"):
                                    try:
                                        canvas_data = f"data:image/png;base64,{mongo_session.get('canvasData')}"
                                    except Exception as e:
                                        print(f"Error restoring canvas: {e}")
                                
                                self.sessions[session_id] = {
                                    "canvas": canvas,
                                    "room_id": room_id,
                                    "clients": set(),
                                    "lock": threading.Lock()
                                }
                                
                                try:
                                    canvas_data = mongo_session.get("canvasData")
                                    if canvas_data and canvas_data.startswith("data:image/png;base64,"):
                                        base64_data = canvas_data.split(",")[1]
                                        canvas_bytes = base64.b64decode(base64_data)
                                        img = Image.open(io.BytesIO(canvas_bytes))
                                        cv_img = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
                                        self.sessions[session_id]["canvas"].set_canvas(cv_img)
                                        
                                    drawing_data = mongo_session.get("drawingData")
                                    if drawing_data and drawing_data.startswith("data:image/png;base64,"):
                                        self.sessions[session_id]["drawing_layer"] = drawing_data
                                        print(f"Restored drawing layer data for session {session_id}")
                                except Exception as e:
                                    print(f"Error restoring canvas or drawing data: {e}")
                            else:
                                print(f"Session not found: {requested_session_id}")
                                await websocket.send(json.dumps({
                                    "type": "error",
                                    "success": False,
                                    "message": "Session not found or has expired. Please create a new session.",
                                    "errorCode": "session_not_found"
                                }))
                                continue
                        
                        if websocket not in self.sessions[session_id]["clients"]:
                            self.sessions[session_id]["clients"].add(websocket)
                            self.client_sessions[websocket] = session_id
                            print(f"Client joined session {session_id}. Total clients in session: {len(self.sessions[session_id]['clients'])}")
                        else:
                            print(f"Client already in session {session_id}, ensuring connection is valid")
                        
                        canvas_base64 = ""
                        try:
                            with self.sessions[session_id]["lock"]:
                                canvas_image = self.sessions[session_id]["canvas"].get_canvas()
                                _, buffer = cv2.imencode('.png', canvas_image)
                                canvas_base64 = base64.b64encode(buffer).decode('utf-8')
                        except Exception as e:
                            print(f"Error getting canvas state for join_session: {e}")
                            
                        drawing_base64 = ""
                        if "drawing_layer" in self.sessions[session_id]:
                            try:
                                drawing_base64 = self.sessions[session_id]["drawing_layer"]
                            except Exception as e:
                                print(f"Error getting drawing layer for join_session: {e}")
                        
                        self.session_db.create_user(user_name, session_id, room_id)

                        await websocket.send(json.dumps({
                            "type": "session_joined",
                            "session_id": session_id,
                            "room_id": room_id,
                            "canvas": f"data:image/png;base64,{canvas_base64}" if canvas_base64 else None,
                            "drawing": drawing_base64 if drawing_base64 else None,
                            "participants": len(self.sessions[session_id]["clients"]),
                            "success": True,
                            "message": "Successfully joined session"
                        }))

                        await self.broadcast_to_session(session_id, json.dumps({
                            "type": "participant_joined",
                            "participants": len(self.sessions[session_id]["clients"])
                        }), exclude=websocket)
                        continue
                    
                    
                    if not session_id or session_id not in self.sessions:
                        if message_type == "frame":
                            continue
                        else:
                            print(f"Error: No active session for message type {message_type}. Client session mapping: {websocket in self.client_sessions}")
                            await websocket.send(json.dumps({
                                "type": "error",
                                "message": "No active session. Please create or join a session.",
                                "errorCode": "no_active_session"
                            }))
                            continue

                    if message_type == "frame":
                        frame_data = data.get("frame")

                        if not frame_data or ',' not in frame_data:
                            print("Error: Invalid frame data format")
                            await websocket.send(json.dumps({
                                "type": "error",
                                "message": "Invalid frame data format"
                            }))
                            continue


                        try:
                            base64_data = frame_data.replace("data:image/jpeg;base64,", "")
                            
                            try:
                                image_data = base64.b64decode(base64_data)
                                nparr = np.frombuffer(image_data, np.uint8)
                                frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                                
                                if frame is None or frame.size == 0:
                                    continue
                                
                                frame, landmarks, gesture, index_position = self.hand_tracker.process_frame(frame)
                                
                                if landmarks:
                                    if index_position:
                                        await websocket.send(json.dumps({
                                            "type": "hand_position",
                                            "position": {
                                                "x": index_position[0],  
                                                "y": index_position[1]   
                                            },
                                            "mode": gesture
                                        }))
                                    
                                    canvas = self.sessions[session_id]["canvas"]
                                    
                                    with self.sessions[session_id]["lock"]:
                                        self.handle_gesture(canvas, gesture, landmarks, websocket, session_id)
                                    
                                    if gesture in ["drawing", "erase"]:
                                        canvas_state = canvas.get_canvas()
                                        
                                        _, buffer = cv2.imencode('.png', canvas_state)
                                        img_base64 = base64.b64encode(buffer).decode('utf-8')
                                        
                                        canvas_update = json.dumps({
                                            "type": "canvas_update",
                                            "canvas": f"data:image/png;base64,{img_base64}"
                                        })
                                        await self.broadcast_to_session(session_id, canvas_update)
                            except Exception as e:
                                print(f"Error processing frame: {e}")
                                await websocket.send(json.dumps({
                                    "type": "error",
                                    "message": f"Error processing frame: {str(e)}"
                                }))
                        except Exception as e:
                            print(f"Error in frame handling: {e}")
                            await websocket.send(json.dumps({
                                "type": "error",
                                "message": f"Error in frame handling: {str(e)}"
                            }))
                            continue

                    elif message_type == "clear_canvas":
                        if session_id in self.sessions:
                            with self.sessions[session_id]["lock"]:
                                self.sessions[session_id]["canvas"].clear()

                                canvas_image = self.sessions[session_id]["canvas"].get_canvas()
                                _, buffer = cv2.imencode('.png', canvas_image)
                                canvas_base64 = base64.b64encode(buffer).decode('utf-8')
                                canvas_data_url = f"data:image/png;base64,{canvas_base64}"
                                
                                self.session_db.update_canvas_state(session_id, canvas_data_url, is_drawing_layer=False)
                                
                                update_message = json.dumps({
                                    "type": "canvas_update",
                                    "canvas": canvas_data_url
                                })
                                await self.broadcast_to_session(session_id, update_message)

                    elif message_type == "change_color":
                        if session_id in self.sessions:
                            with self.sessions[session_id]["lock"]:
                                color = data.get("color", [0, 0, 0])
                                self.sessions[session_id]["canvas"].change_color(color)
    
                                color_message = json.dumps({
                                    "type": "color_changed",
                                    "color": color
                                })
                                await self.broadcast_to_session(session_id, color_message, exclude=websocket)
                    
                    elif message_type == "mouse_draw":
                        if session_id in self.sessions:
                            start = data.get("start")
                            end = data.get("end")
                            color = data.get("color")
                            
                            if start and end and color:
                                with self.sessions[session_id]["lock"]:
                                    color_hex = color.lstrip('#')
                                    color_rgb = tuple(int(color_hex[i:i+2], 16) for i in (0, 2, 4))
                                    cv_color = (color_rgb[2], color_rgb[1], color_rgb[0])  
                                
                                    start_point = (int(start["x"]), int(start["y"]))
                                    end_point = (int(end["x"]), int(end["y"]))
                                    
                                    canvas = self.sessions[session_id]["canvas"]
                                    canvas.draw_line(start_point, end_point, cv_color)
                                
                                draw_message = json.dumps({
                                    "type": "mouse_draw",
                                    "start": start,
                                    "end": end,
                                    "color": color
                                })
                                await self.broadcast_to_session(session_id, draw_message, exclude=websocket)
                    
                    elif message_type == "drawing_update":
                        if session_id in self.sessions:
                            drawing_data = data.get("drawing", "")
                            
                            if drawing_data and drawing_data.startswith("data:image/png;base64,"):
                                with self.sessions[session_id]["lock"]:
                                    self.sessions[session_id]["drawing_layer"] = drawing_data
                                    
                                    if data.get("isFinal", False):
                                        self.session_db.update_canvas_state(session_id, drawing_data, is_drawing_layer=True)
                                
                                drawing_message = json.dumps({
                                    "type": "drawing_update",
                                    "drawing": drawing_data
                                })
                                await self.broadcast_to_session(session_id, drawing_message, exclude=websocket)
                
                except Exception as e:
                    print(f"Error processing message: {e}")
                    await websocket.send(json.dumps({"type": "error", "message": str(e)}))

        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            if websocket in self.client_sessions:
                session_id = self.client_sessions[websocket]
                if session_id in self.sessions:
                    self.sessions[session_id]["clients"].remove(websocket)

                    remaining_clients = len(self.sessions[session_id]["clients"])
                    if remaining_clients > 0:
                        asyncio.create_task(self.broadcast_to_session(session_id, json.dumps({
                            "type": "participant_left",
                            "participants": remaining_clients
                        })))
                    else:
                        
                        print(f"Last client left session {session_id}, keeping session in memory for reconnections")
                      

                del self.client_sessions[websocket]

    def handle_gesture(self, canvas, gesture, landmarks, websocket=None, session_id=None):
        index_tip = landmarks.landmark[8]
        gesture_points = []
        
        session_data = self.sessions.get(session_id, {})
        prev_gesture = session_data.get("prev_gesture", "idle")
        
        is_gesture_transition = gesture != prev_gesture
        
        if gesture == "drawing":
            point = (index_tip.x, index_tip.y)
            
            if is_gesture_transition:
                canvas.reset_previous_points()
                
                if websocket and session_id:
                    asyncio.create_task(websocket.send(json.dumps({
                        "type": "gesture_start",
                        "gesture": "drawing"
                    })))
            
            canvas.draw(point)
            gesture_points.append({"x": point[0], "y": point[1]})
            
            if websocket and session_id:
                asyncio.create_task(websocket.send(json.dumps({
                    "type": "gesture_point",
                    "gesture": "drawing",
                    "point": {"x": point[0], "y": point[1]}
                })))

        elif gesture == "erase":
            middle_tip = landmarks.landmark[12]
            midpoint = ((index_tip.x + middle_tip.x) / 2, (index_tip.y + middle_tip.y) / 2)
            
            if is_gesture_transition:
                canvas.reset_previous_points()
                
                if websocket and session_id:
                    asyncio.create_task(websocket.send(json.dumps({
                        "type": "gesture_start",
                        "gesture": "erase"
                    })))
            
            canvas.erase(midpoint)
            gesture_points.append({"x": midpoint[0], "y": midpoint[1]})
            
            if websocket and session_id:
                asyncio.create_task(websocket.send(json.dumps({
                    "type": "gesture_point",
                    "gesture": "erase",
                    "point": {"x": midpoint[0], "y": midpoint[1]}
                })))

        elif gesture == "undo":
            if websocket and session_id:
                if prev_gesture in ["drawing", "erase"]:
                    print(f"Completing gesture: {prev_gesture} -> {gesture}")
                    asyncio.create_task(websocket.send(json.dumps({
                        "type": "gesture_complete",
                        "previous": prev_gesture
                    })))
                
                print(f"Sending undo gesture action")
                asyncio.create_task(websocket.send(json.dumps({
                    "type": "gesture_action",
                    "action": "undo"
                })))
                
                undo_message = json.dumps({
                    "type": "gesture_action",
                    "action": "undo"
                })
                asyncio.create_task(self.broadcast_to_session(session_id, undo_message, exclude=websocket))
        
            canvas.reset_previous_points()
    
        elif gesture == "idle":
            if prev_gesture in ["drawing", "erase"] and websocket and session_id:
                print(f"Completing gesture: {prev_gesture} -> {gesture}")
                asyncio.create_task(websocket.send(json.dumps({
                    "type": "gesture_complete",
                    "previous": prev_gesture
                })))
            
            canvas.reset_previous_points()
        
        if session_id in self.sessions:
            self.sessions[session_id]["prev_gesture"] = gesture
            
        return gesture_points

    async def start_server(self):
        await self.restore_sessions_from_db()
        
        async with websockets.serve(self.handle_client, self.host, self.port):
            print(f"WebSocket server started at ws://{self.host}:{self.port}")
            await asyncio.Future()  

def run_server():
    server = WebSocketServer()
    asyncio.run(server.start_server())

if __name__ == "__main__":
    run_server() 