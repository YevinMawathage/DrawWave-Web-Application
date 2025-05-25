import unittest
import json
import sys
import os

class MockWebSocketServer:
    def __init__(self):
        self.sessions = {}
        self.client_sessions = {}
        
    def create_session(self, host_name):
        """Create a new session and return the session ID"""
        session_id = f"test-session-{len(self.sessions) + 1}"
        self.sessions[session_id] = {
            "canvas": "base64encodedcanvasdata",
            "clients": {host_name},
            "drawing_layers": [],
            "host": host_name
        }
        return session_id
    
    def join_session(self, session_id, user_name):
        """Join an existing session"""
        if session_id not in self.sessions:
            return None
            
        self.sessions[session_id]["clients"].add(user_name)
        self.client_sessions[user_name] = session_id
        
        return {
            "session_id": session_id,
            "canvas_data": self.sessions[session_id]["canvas"],
            "drawing_layers": self.sessions[session_id]["drawing_layers"],
            "host": user_name == self.sessions[session_id]["host"]
        }
    
    def add_drawing_layer(self, session_id, layer_id, data):
        """Add a drawing layer to a session"""
        if session_id not in self.sessions:
            return False
            
        self.sessions[session_id]["drawing_layers"].append({
            "layer_id": layer_id,
            "data": data,
            "zIndex": len(self.sessions[session_id]["drawing_layers"])
        })
        return True
    
    def get_session_data(self, session_id):
        """Get all data for a session"""
        if session_id not in self.sessions:
            return None
        return self.sessions[session_id]

class TestWebSocketServer(unittest.TestCase):
    def setUp(self):
        self.server = MockWebSocketServer()

    def test_create_session(self):
        """Test creating a new session"""
        # Create a session
        session_id = self.server.create_session("Test User")
        
        # Verify session was created
        self.assertIn(session_id, self.server.sessions)
        self.assertIn("Test User", self.server.sessions[session_id]["clients"])
        self.assertEqual(self.server.sessions[session_id]["host"], "Test User")

    def test_join_session(self):
        """Test joining an existing session"""
        # First create a session
        session_id = self.server.create_session("Host User")
        
        # Join the session with a second user
        join_result = self.server.join_session(session_id, "Join User")
        
        # Verify join was successful
        self.assertIsNotNone(join_result)
        self.assertEqual(join_result["session_id"], session_id)
        self.assertEqual(join_result["host"], False)
        
        # Verify client was added to the session
        self.assertIn("Join User", self.server.sessions[session_id]["clients"])

    def test_drawing_update_synchronization(self):
        """Test that drawing updates are synchronized in a session"""
        # Create a session with host
        session_id = self.server.create_session("Drawing Host")
        
        # Join with a second client
        self.server.join_session(session_id, "Drawing Viewer")
        
        # Add drawing layer data
        layer_added = self.server.add_drawing_layer(
            session_id, 
            "layer1", 
            "base64drawingdata"
        )
        
        # Verify drawing layer was added
        self.assertTrue(layer_added)
        self.assertEqual(len(self.server.sessions[session_id]["drawing_layers"]), 1)
        self.assertEqual(self.server.sessions[session_id]["drawing_layers"][0]["layer_id"], "layer1")

    def test_session_persistence(self):
        """Test that session data persists and can be retrieved after a client disconnects and reconnects"""
        # Create a session
        session_id = self.server.create_session("Persistence Host")
        
        # Add multiple drawing layers
        self.server.add_drawing_layer(session_id, "background", "backgrounddata")
        self.server.add_drawing_layer(session_id, "user-layer", "userlayerdata")
        
        # Simulate a client disconnection by removing from clients
        self.server.sessions[session_id]["clients"].remove("Persistence Host")
        
        # Now simulate the client rejoining
        rejoin_data = self.server.join_session(session_id, "Persistence Host")
        
        # Verify the session data was properly maintained
        self.assertIsNotNone(rejoin_data)
        self.assertEqual(rejoin_data["session_id"], session_id)
        
        # There should be a canvas_data and drawing_layers field in the response
        self.assertIn("canvas_data", rejoin_data)
        self.assertIn("drawing_layers", rejoin_data)
        
        # Verify that all drawing layers are included
        layers = rejoin_data["drawing_layers"]
        self.assertEqual(len(layers), 2)
        self.assertTrue(any(layer["layer_id"] == "background" for layer in layers))
        self.assertTrue(any(layer["layer_id"] == "user-layer" for layer in layers))

    def test_multiple_drawing_layers(self):
        """Test handling multiple drawing layers in a session"""
        # Create a session
        session_id = self.server.create_session("Multi-layer Host")
        
        # Add multiple drawing layers
        self.server.add_drawing_layer(session_id, "background", "backgrounddata")
        self.server.add_drawing_layer(session_id, "midground", "midgrounddata")
        self.server.add_drawing_layer(session_id, "foreground", "foregrounddata")
        
        # Get the session data
        session_data = self.server.get_session_data(session_id)
        
        # Verify all layers are present with correct ordering
        self.assertEqual(len(session_data["drawing_layers"]), 3)
        self.assertEqual(session_data["drawing_layers"][0]["layer_id"], "background")
        self.assertEqual(session_data["drawing_layers"][0]["zIndex"], 0)
        self.assertEqual(session_data["drawing_layers"][1]["layer_id"], "midground")
        self.assertEqual(session_data["drawing_layers"][1]["zIndex"], 1)
        self.assertEqual(session_data["drawing_layers"][2]["layer_id"], "foreground")
        self.assertEqual(session_data["drawing_layers"][2]["zIndex"], 2)

if __name__ == '__main__':
    unittest.main()
